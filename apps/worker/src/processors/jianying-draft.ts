import path from "node:path";

import { getPrisma } from "@stickmotion/db";
import { alignTextToDuration, type SubtitleCueInput } from "@stickmotion/media";
import type { LocalJob } from "@stickmotion/queue";
import {
  jianyingDraftCreateOutputSchema,
  jianyingDraftGenerationInputSchema,
  subtitleStyleSchema,
  type JianyingDraftGenerationInput,
} from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import { runFfmpeg } from "../services/ffmpeg-runner";
import { createJianyingDraft } from "../services/jianying-draft";
import { installJianyingDraft } from "../services/jianying-draft-install";
import { findSubtitleTemplate } from "../services/subtitle-template-library";

function getStagingRoot(): string {
  return path.resolve(process.cwd(), "../..", "work", "jianying-drafts");
}

export function createJianyingDraftProcessor(
  objectStore = new LocalObjectStore(),
  ffmpegRunner = runFfmpeg,
) {
  return async function processJianyingDraftJob(
    localJob: LocalJob<JianyingDraftGenerationInput>,
  ): Promise<void> {
    const input = jianyingDraftGenerationInputSchema.parse(localJob.data);
    const prisma = getPrisma();
    await prisma.generationJob.update({
      where: { id: input.jobId },
      data: {
        progress: 5,
        events: {
          create: {
            status: "RUNNING",
            progress: 5,
            code:
              input.action === "CREATE"
                ? "JIANYING_DRAFT_CREATE_STARTED"
                : "JIANYING_DRAFT_INSTALL_STARTED",
          },
        },
      },
    });

    if (input.action === "CREATE") {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        include: {
          scenes: { orderBy: { order: "asc" } },
          renderOutputs: {
            where: { projectRevision: input.projectRevision },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { asset: true },
          },
        },
      });
      if (project.revision !== input.projectRevision) {
        throw new Error("PROJECT_REVISION_STALE");
      }
      const render = project.renderOutputs[0];
      if (!render) throw new Error("CURRENT_RENDER_REQUIRED");

      const subtitleCues: SubtitleCueInput[] = [];
      let timelineMs = 0;
      for (const scene of project.scenes) {
        const sceneDurationMs = Math.round(scene.estimatedDuration * 1_000);
        if (project.includeSubtitles) {
          for (const cue of alignTextToDuration(
            scene.subtitle,
            sceneDurationMs,
          )) {
            subtitleCues.push({
              ...cue,
              startMs: timelineMs + cue.startMs,
              endMs: Math.min(render.durationMs, timelineMs + cue.endMs),
            });
          }
        }
        timelineMs += sceneDurationMs;
      }
      const subtitleStyle = subtitleStyleSchema.parse(project.subtitleStyle);
      const subtitleTemplate = await findSubtitleTemplate(
        subtitleStyle.templateId,
      );
      await localJob.updateProgress(25);
      const result = await createJianyingDraft(
        {
          projectId: project.id,
          projectRevision: project.revision,
          title: project.title,
          width: render.width,
          height: render.height,
          durationMs: render.durationMs,
          video: await objectStore.get(render.asset.objectKey),
          subtitleCues: subtitleCues.filter((cue) => cue.endMs > cue.startMs),
          ...(subtitleTemplate
            ? {
                subtitleTemplate: {
                  id: subtitleTemplate.id,
                  name: subtitleTemplate.name,
                  category: subtitleTemplate.category,
                  style: subtitleTemplate.style,
                },
              }
            : {}),
        },
        ffmpegRunner,
        path.join(getStagingRoot(), project.id),
      );
      if (!result) throw new Error("JIANYING_STAGING_ROOT_REQUIRED");

      await prisma.generationJob.update({
        where: { id: input.jobId },
        data: {
          status: "SUCCEEDED",
          progress: 100,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date(),
          output: {
            action: "CREATE",
            draftId: result.draftId,
            stagingPath: result.draftPath,
          },
          events: {
            create: {
              status: "SUCCEEDED",
              progress: 100,
              code: "JIANYING_DRAFT_CREATED",
              metadata: {
                draftId: result.draftId,
                stagingPath: result.draftPath,
              },
            },
          },
        },
      });
      await localJob.updateProgress(100);
      return;
    }

    const sourceJob = await prisma.generationJob.findFirst({
      where: {
        id: input.draftJobId,
        projectId: input.projectId,
        projectRevision: input.projectRevision,
        type: "JIANYING_DRAFT",
        status: "SUCCEEDED",
      },
    });
    if (!sourceJob) throw new Error("JIANYING_SOURCE_DRAFT_NOT_FOUND");
    const source = jianyingDraftCreateOutputSchema.parse(sourceJob.output);
    await localJob.updateProgress(20);
    const installed = await installJianyingDraft({
      stagingRoot: getStagingRoot(),
      stagingPath: source.stagingPath,
    });
    await prisma.generationJob.update({
      where: { id: input.jobId },
      data: {
        status: "SUCCEEDED",
        progress: 100,
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
        output: {
          action: "INSTALL",
          draftId: installed.draftId,
          draftJobId: input.draftJobId,
          installedPath: installed.installedPath,
          stagingRemoved: true,
        },
        events: {
          create: {
            status: "SUCCEEDED",
            progress: 100,
            code: "JIANYING_DRAFT_INSTALLED",
            metadata: {
              draftId: installed.draftId,
              installedPath: installed.installedPath,
              stagingRemoved: true,
            },
          },
        },
      },
    });
    await localJob.updateProgress(100);
  };
}
