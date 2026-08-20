import path from "node:path";

import { config as loadEnv } from "dotenv";

import { z } from "zod";

import { getPrisma, type Prisma } from "@stickmotion/db";
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
import { getLocalRetryPolicy } from "./services/local-retry-policy";
import {
  mediaJobTypes,
  parseWorkerRole,
  voiceClaimAvailable,
} from "./worker-role";

const workspaceEnvPath = path.resolve(process.cwd(), "../..", ".env");

function reloadRuntimeEnvironment(): void {
  loadEnv({ path: workspaceEnvPath, override: true, quiet: true });
}

reloadRuntimeEnvironment();

const workerRole = parseWorkerRole(process.env.WORKER_ROLE);
const nonVoiceMediaJobTypes = mediaJobTypes.filter(
  (type): type is Exclude<(typeof mediaJobTypes)[number], "VOICE"> =>
    type !== "VOICE",
);

function roleTypeFilter(voiceBusy: boolean): Prisma.GenerationJobWhereInput {
  if (workerRole === "render") return { type: "RENDER" };
  if (workerRole === "media") {
    return {
      type: { in: voiceBusy ? nonVoiceMediaJobTypes : [...mediaJobTypes] },
    };
  }
  return voiceBusy ? { type: { not: "VOICE" } } : {};
}

if (workerRole !== "media") {
  startSettingsServer();
}

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
  const runningVoiceJobs = await prisma.generationJob.count({
    where: { type: "VOICE", status: "RUNNING" },
  });
  const voiceBusy = !voiceClaimAvailable(runningVoiceJobs);
  const candidate = await prisma.generationJob.findFirst({
    where: {
      status: { in: ["QUEUED", "RETRYING"] },
      queuedAt: { lte: new Date() },
      ...roleTypeFilter(voiceBusy),
    },
    orderBy: [{ queuedAt: "asc" }, { createdAt: "asc" }],
  });
  if (!candidate) return undefined;

  // The two media workers share one local voice-service slot. Keep voice claims
  // single-file even when both workers race on the same SQLite queue. The
  // NOT EXISTS guard is part of the UPDATE so a stale count/findFirst pair
  // cannot let both workers enter synthesis concurrently.
  const claimed = await prisma.$executeRaw`
    UPDATE "GenerationJob"
    SET "status" = 'RUNNING',
        "startedAt" = ${new Date()},
        "attempt" = "attempt" + 1
    WHERE "id" = ${candidate.id}
      AND "status" = ${candidate.status}
      AND (
        "type" <> 'VOICE'
        OR NOT EXISTS (
          SELECT 1
          FROM "GenerationJob" AS runningVoice
          WHERE runningVoice."type" = 'VOICE'
            AND runningVoice."status" = 'RUNNING'
        )
      )
  `;
  return claimed === 1 ? candidate : undefined;
}

async function retryOrFail(jobId: string, error: unknown): Promise<void> {
  const prisma = getPrisma();
  const current = await prisma.generationJob.findUniqueOrThrow({
    where: { id: jobId },
  });
  if (current.status === "CANCELED" || current.status === "CANCEL_REQUESTED") {
    return;
  }
  const message = cleanError(error);
  const retryPolicy = getLocalRetryPolicy({
    jobType: current.type,
    attempt: current.attempt,
    maxAttempts: current.maxAttempts,
    errorMessage: message,
  });
  const retryAt = new Date(Date.now() + retryPolicy.delayMs);
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: retryPolicy.canRetry ? "RETRYING" : "FAILED",
      errorCode: retryPolicy.canRetry
        ? "LOCAL_WORKER_RETRY"
        : "LOCAL_WORKER_FAILED",
      errorMessage: message,
      maxAttempts: retryPolicy.maxAttempts,
      queuedAt: retryPolicy.canRetry ? retryAt : current.queuedAt,
      startedAt: null,
      finishedAt: retryPolicy.canRetry ? null : new Date(),
      events: {
        create: {
          status: retryPolicy.canRetry ? "RETRYING" : "FAILED",
          progress: current.progress,
          code: retryPolicy.canRetry
            ? "LOCAL_WORKER_RETRY"
            : "LOCAL_WORKER_FAILED",
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
    } else if (record.type === "VOICE") {
      const stored = storedVoiceInputSchema.parse(record.input);
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

  console.info(
    `[worker] local SQLite worker is ready (role=${workerRole || "all"})`,
  );
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
