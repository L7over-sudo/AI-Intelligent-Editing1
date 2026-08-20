import type { LocalJob } from "@stickmotion/queue";

import { getPrisma } from "@stickmotion/db";
import {
  getStoryboardDuration,
  scriptGenerationInputSchema,
  subtitleStyleSchema,
  type Storyboard,
  type ScriptGenerationInput,
  type VideoTemplate,
} from "@stickmotion/shared";

import { LocalStoryboardProvider } from "../services/local-storyboard-provider";
import { applyAutomaticSoundEffects } from "../services/automatic-sound-effects";
import { synchronizeProjectSoundEffects } from "../services/sound-effect-library";
import type { StoryboardProvider } from "../services/storyboard-provider";

function cleanError(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 2_000)
    : "Unknown storyboard generation error";
}

export function buildReadyProjectUpdate(duration: number) {
  return {
    targetDuration: duration,
    status: "READY" as const,
  };
}

export function applyTemplateSoundEffects(
  storyboard: Storyboard,
  videoTemplate: VideoTemplate,
): Storyboard {
  return videoTemplate === "IMPACT_CAPTIONS"
    ? applyAutomaticSoundEffects(storyboard)
    : storyboard;
}

export function createScriptProcessor(
  provider: StoryboardProvider = new LocalStoryboardProvider(),
) {
  return async function processScriptJob(
    localJob: LocalJob<ScriptGenerationInput>,
  ): Promise<{ sceneCount: number }> {
    const input = scriptGenerationInputSchema.parse(localJob.data);
    const prisma = getPrisma();

    await prisma.generationJob.update({
      where: { id: input.jobId },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        progress: 5,
        events: {
          create: { status: "RUNNING", progress: 5, code: "SCRIPT_STARTED" },
        },
      },
    });

    try {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
      });
      if (project.revision !== input.projectRevision) {
        throw new Error("PROJECT_REVISION_STALE");
      }

      await localJob.updateProgress(15);
      const videoTemplate = subtitleStyleSchema.parse(
        project.subtitleStyle,
      ).videoTemplate;
      const request = {
        sourceKind: project.sourceKind as "TOPIC" | "FULL_TEXT",
        aspectRatio: project.aspectRatio,
        language: project.language,
        accentColor: project.accentColor,
        imagePrompt: project.imagePrompt,
        videoTemplate,
      };
      let storyboardSource = await provider.generate({
        sourceText: project.sourceText,
        ...request,
      });
      const firstScene = storyboardSource.scenes[0];
      if (firstScene) {
        const scenes = [...storyboardSource.scenes];
        scenes[0] = {
          ...firstScene,
          animation: { type: "RISE", direction: "UP", intensity: 1 },
          soundEffects: [
            ...firstScene.soundEffects,
            { tag: "water" as const, offsetRatio: 0, gainDb: -4 },
          ].slice(0, 5),
        };
        storyboardSource = { ...storyboardSource, scenes };
      }
      storyboardSource = applyTemplateSoundEffects(
        storyboardSource,
        videoTemplate,
      );
      const storyboard = storyboardSource;
      await localJob.updateProgress(80);
      const duration = Math.ceil(getStoryboardDuration(storyboard));

      await prisma.$transaction(async (tx) => {
        const current = await tx.project.findUniqueOrThrow({
          where: { id: project.id },
          select: { revision: true },
        });
        if (current.revision !== input.projectRevision) {
          throw new Error("PROJECT_REVISION_STALE");
        }

        await tx.scene.deleteMany({ where: { projectId: project.id } });
        await tx.scene.createMany({
          data: storyboard.scenes.map((scene, index) => ({
            projectId: project.id,
            order: index,
            narration: scene.narration,
            subtitle: scene.subtitle,
            estimatedDuration: scene.estimatedDuration,
            visualPrompt: scene.visualPrompt,
            templateElements: scene.templateElements,
            animation: scene.animation,
            transition: scene.transition,
            soundEffects: scene.soundEffects,
          })),
        });
        await tx.project.update({
          where: { id: project.id },
          data: buildReadyProjectUpdate(duration),
        });
      });

      await localJob.updateProgress(90);
      const soundEffectCount = await synchronizeProjectSoundEffects(
        project.id,
        input.projectRevision,
      );
      await prisma.generationJob.update({
        where: { id: input.jobId },
        data: {
          status: "SUCCEEDED",
          progress: 100,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date(),
          output: {
            title: storyboard.title,
            summary: storyboard.summary,
            sceneCount: storyboard.scenes.length,
            duration,
            soundEffectCount,
          },
          events: {
            create: {
              status: "SUCCEEDED",
              progress: 100,
              code: "SCRIPT_SUCCEEDED",
              metadata: { soundEffectCount },
            },
          },
        },
      });

      await localJob.updateProgress(100);
      return { sceneCount: storyboard.scenes.length };
    } catch (error) {
      const message = cleanError(error);
      await prisma.$transaction([
        prisma.generationJob.update({
          where: { id: input.jobId },
          data: {
            status: "FAILED",
            errorCode: "SCRIPT_GENERATION_FAILED",
            errorMessage: message,
            finishedAt: new Date(),
            events: {
              create: {
                status: "FAILED",
                progress: 0,
                code: "SCRIPT_GENERATION_FAILED",
                message,
              },
            },
          },
        }),
        prisma.project.update({
          where: { id: input.projectId },
          data: { status: "FAILED" },
        }),
      ]);
      throw error instanceof Error ? error : new Error(message);
    }
  };
}
