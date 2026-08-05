import type { LocalJob } from "@stickmotion/queue";

import { getPrisma } from "@stickmotion/db";
import {
  estimateNarrationDuration,
  getStoryboardDuration,
  scriptGenerationInputSchema,
  splitFirstSentence,
  storyboardSchema,
  type ScriptGenerationInput,
  type Storyboard,
  type StoryboardScene,
} from "@stickmotion/shared";

import { LocalStoryboardProvider } from "../services/local-storyboard-provider";
import { synchronizeProjectSoundEffects } from "../services/sound-effect-library";
import type { StoryboardProvider } from "../services/storyboard-provider";

function cleanError(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 2_000)
    : "Unknown storyboard generation error";
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
      const request = {
        sourceKind: project.sourceKind as "TOPIC" | "FULL_TEXT",
        aspectRatio: project.aspectRatio,
        language: project.language,
        accentColor: project.accentColor,
        imagePrompt: project.imagePrompt,
      };
      let storyboardSource: Storyboard;
      if (project.useTextOpeningTemplate) {
        const { firstSentence, remainingText } = splitFirstSentence(
          project.sourceText,
        );
        if (!firstSentence) throw new Error("SOURCE_TEXT_EMPTY");

        const generated = remainingText
          ? await provider.generate({
              sourceText: remainingText,
              ...request,
            })
          : {
              title: Array.from(firstSentence).slice(0, 36).join(""),
              summary: Array.from(firstSentence).slice(0, 160).join(""),
              scenes: [] as StoryboardScene[],
            };

        const openingScene: StoryboardScene = {
          narration: firstSentence,
          subtitle: firstSentence,
          estimatedDuration: Math.max(
            2.5,
            Math.round(estimateNarrationDuration(firstSentence) * 10) / 10,
          ),
          visualPrompt: "",
          templateElements: [],
          animation: { type: "NONE", direction: "NONE", intensity: 0 },
          transition: { type: "CUT", duration: 0 },
          soundEffects: [{ tag: "water", offsetRatio: 0, gainDb: -4 }],
          isTextOpening: true,
        };
        storyboardSource = storyboardSchema.parse({
          title: generated.title || "未命名视频",
          summary: generated.summary || firstSentence,
          scenes: [openingScene, ...generated.scenes],
        });
      } else {
        storyboardSource = await provider.generate({
          sourceText: project.sourceText,
          ...request,
        });
      }
      const firstGeneratedIndex = storyboardSource.scenes.findIndex(
        (scene) => !scene.isTextOpening,
      );
      if (firstGeneratedIndex >= 0) {
        const scenes = [...storyboardSource.scenes];
        scenes[firstGeneratedIndex] = {
          ...scenes[firstGeneratedIndex]!,
          animation: { type: "RISE", direction: "UP", intensity: 1 },
        };
        storyboardSource = { ...storyboardSource, scenes };
      }
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
            isTextOpening: scene.isTextOpening ?? false,
          })),
        });
        await tx.project.update({
          where: { id: project.id },
          data: {
            title: storyboard.title,
            targetDuration: duration,
            status: "READY",
          },
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
