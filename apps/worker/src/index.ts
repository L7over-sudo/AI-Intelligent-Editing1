import path from "node:path";

import { config as loadEnv } from "dotenv";

import { z } from "zod";

import { getPrisma } from "@stickmotion/db";
import type { LocalJob } from "@stickmotion/queue";
import {
  jianyingDraftGenerationInputSchema,
  renderGenerationInputSchema,
  sceneImageGenerationInputSchema,
  scriptGenerationInputSchema,
  voiceGenerationInputSchema,
  type JianyingDraftGenerationInput,
  type RenderGenerationInput,
  type SceneImageGenerationInput,
  type ScriptGenerationInput,
  type VoiceGenerationInput,
} from "@stickmotion/shared";

import { createJianyingDraftProcessor } from "./processors/jianying-draft";
import { createRenderProcessor } from "./processors/render";
import { createSceneImageProcessor } from "./processors/scene-image";
import { createScriptProcessor } from "./processors/script";
import { createVoiceProcessor } from "./processors/voice";
import { startSettingsServer } from "./settings-server";

const workspaceEnvPath = path.resolve(process.cwd(), "../..", ".env");

function reloadRuntimeEnvironment(): void {
  loadEnv({ path: workspaceEnvPath, override: true, quiet: true });
}

reloadRuntimeEnvironment();
startSettingsServer();

const storedSceneImageInputSchema = z
  .object({ sceneIds: z.array(z.string().min(1)).min(1).max(500) })
  .strict();

const storedVoiceInputSchema = z
  .object({ sceneId: z.string().min(1) })
  .strict();
const voiceProcessor = createVoiceProcessor();

const storedRenderInputSchema = z
  .object({
    watermark: z.string().max(80),
    introTitle: z.boolean(),
    outro: z.boolean(),
  })
  .strict();
const storedJianyingDraftInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE") }).strict(),
  z
    .object({
      action: z.literal("INSTALL"),
      draftJobId: z.string().min(1),
    })
    .strict(),
]);

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const cleanError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2_000);

async function claimNextJob() {
  const prisma = getPrisma();
  const candidate = await prisma.generationJob.findFirst({
    where: {
      status: { in: ["QUEUED", "RETRYING"] },
      queuedAt: { lte: new Date() },
    },
    orderBy: [{ queuedAt: "asc" }, { createdAt: "asc" }],
  });
  if (!candidate) return undefined;

  const claimed = await prisma.generationJob.updateMany({
    where: { id: candidate.id, status: candidate.status },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      attempt: { increment: 1 },
    },
  });
  return claimed.count === 1 ? candidate : undefined;
}

async function retryOrFail(jobId: string, error: unknown): Promise<void> {
  const prisma = getPrisma();
  const current = await prisma.generationJob.findUniqueOrThrow({
    where: { id: jobId },
  });
  const canRetry = current.attempt < current.maxAttempts;
  const message = cleanError(error);
  const retryAt = new Date(
    Date.now() +
      Math.min(30_000, 1_000 * 2 ** Math.max(0, current.attempt - 1)),
  );
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: canRetry ? "RETRYING" : "FAILED",
      errorCode: canRetry ? "LOCAL_WORKER_RETRY" : "LOCAL_WORKER_FAILED",
      errorMessage: message,
      queuedAt: canRetry ? retryAt : current.queuedAt,
      startedAt: null,
      finishedAt: canRetry ? null : new Date(),
      events: {
        create: {
          status: canRetry ? "RETRYING" : "FAILED",
          progress: current.progress,
          code: canRetry ? "LOCAL_WORKER_RETRY" : "LOCAL_WORKER_FAILED",
          message,
        },
      },
    },
  });
}

function makeLocalJob<T>(
  data: T,
  record: { id: string; attempt: number; maxAttempts: number },
): LocalJob<T> {
  return {
    data,
    attemptsMade: record.attempt,
    opts: { attempts: record.maxAttempts },
    updateProgress: async (progress) => {
      await getPrisma().generationJob.update({
        where: { id: record.id },
        data: { progress: Math.max(0, Math.min(100, Math.round(progress))) },
      });
    },
  };
}

async function processJob(
  record: Awaited<ReturnType<typeof claimNextJob>>,
): Promise<void> {
  reloadRuntimeEnvironment();
  if (!record) return;
  try {
    if (record.type === "SCRIPT") {
      const data: ScriptGenerationInput = scriptGenerationInputSchema.parse({
        jobId: record.id,
        projectId: record.projectId,
        projectRevision: record.projectRevision,
      });
      await createScriptProcessor()(makeLocalJob(data, record));
    } else if (record.type === "SCENE") {
      const stored = storedSceneImageInputSchema.parse(record.input);
      const latestProject = await getPrisma().project.findUnique({
        where: { id: record.projectId },
        select: { revision: true },
      });
      if (!latestProject) throw new Error("PROJECT_NOT_FOUND");
      if (latestProject.revision !== record.projectRevision) {
        await getPrisma().generationJob.update({
          where: { id: record.id },
          data: {
            projectRevision: latestProject.revision,
            errorCode: null,
            errorMessage: null,
            events: {
              create: {
                status: "RUNNING",
                progress: record.progress,
                code: "SCENE_JOB_REBASED",
                message: `画面任务已自动对齐到 REV ${latestProject.revision}`,
              },
            },
          },
        });
      }
      const data: SceneImageGenerationInput =
        sceneImageGenerationInputSchema.parse({
          jobId: record.id,
          projectId: record.projectId,
          projectRevision: latestProject.revision,
          sceneIds: stored.sceneIds,
        });
      await createSceneImageProcessor()(makeLocalJob(data, record));
    } else if (record.type === "VOICE") {      const stored = storedVoiceInputSchema.parse(record.input);
      const data: VoiceGenerationInput = voiceGenerationInputSchema.parse({
        jobId: record.id,
        projectId: record.projectId,
        sceneId: stored.sceneId,
        projectRevision: record.projectRevision,
      });
      await voiceProcessor(makeLocalJob(data, record));
    } else if (record.type === "RENDER") {
      const stored = storedRenderInputSchema.parse(record.input);
      const data: RenderGenerationInput = renderGenerationInputSchema.parse({
        jobId: record.id,
        projectId: record.projectId,
        projectRevision: record.projectRevision,
        ...stored,
      });
      await createRenderProcessor()(makeLocalJob(data, record));
    } else if (record.type === "JIANYING_DRAFT") {
      const stored = storedJianyingDraftInputSchema.parse(record.input);
      const data: JianyingDraftGenerationInput =
        jianyingDraftGenerationInputSchema.parse({
          jobId: record.id,
          projectId: record.projectId,
          projectRevision: record.projectRevision,
          ...stored,
        });
      await createJianyingDraftProcessor()(makeLocalJob(data, record));
    } else {
      throw new Error(`UNSUPPORTED_LOCAL_JOB_TYPE:${record.type}`);
    }
    console.info(`[worker] ${record.type} job ${record.id} completed`);
  } catch (error) {
    console.error(
      `[worker] ${record.type} job ${record.id} failed: ${cleanError(error)}`,
    );
    await retryOrFail(record.id, error);
  }
}

async function start(): Promise<void> {
  const prisma = getPrisma();
  await prisma.generationJob.updateMany({
    where: { status: "RUNNING" },
    data: {
      status: "RETRYING",
      queuedAt: new Date(),
      startedAt: null,
      errorCode: "LOCAL_WORKER_RESTARTED",
      errorMessage: "本地 Worker 重启，任务已重新排队",
    },
  });

  let closing = false;
  const shutdown = (signal: string) => {
    console.info(`[worker] ${signal}; closing after current job`);
    closing = true;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.info("[worker] local SQLite worker is ready");
  while (!closing) {
    const job = await claimNextJob();
    if (job) await processJob(job);
    else await delay(600);
  }
  await prisma.$disconnect();
}

start().catch((error: unknown) => {
  console.error("[worker] startup failed", error);
  process.exitCode = 1;
});
