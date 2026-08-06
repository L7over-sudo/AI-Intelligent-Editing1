import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LocalJob } from "@stickmotion/queue";
import sharp from "sharp";

import { getPrisma } from "@stickmotion/db";
import {
  alignTextToDuration,
  buildFfmpegRenderCommand,
  cuesToAss,
  type FfmpegRenderPlan,
  type SubtitleCueInput,
} from "@stickmotion/media";
import { renderSvgScene } from "@stickmotion/scene-engine";
import {
  applyTransitionPreference,
  animationSchema,
  formatTextOpening,
  renderGenerationInputSchema,
  subtitleStyleSchema,
  templateElementSchema,
  transitionSchema,
  type RemotionRenderInput,
  type RenderGenerationInput,
} from "@stickmotion/shared";

import { runFfmpeg } from "../services/ffmpeg-runner";
import {
  runRemotion,
  type RemotionRenderer,
} from "../services/remotion-renderer";
import { synchronizeProjectSoundEffects } from "../services/sound-effect-library";
import { findSubtitleTemplate } from "../services/subtitle-template-library";
import {
  createKnowledgeBoardFrame,
  prepareKnowledgeBoardImage,
} from "../services/video-template-frame";
import { LocalObjectStore } from "@stickmotion/storage";

const cleanError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2_000);

function mediaExtension(contentType: string): string {
  if (contentType.includes("mpeg")) return ".mp3";
  if (contentType.includes("mp4") || contentType.includes("m4a")) return ".m4a";
  if (contentType.includes("ogg")) return ".ogg";
  if (contentType.includes("flac")) return ".flac";
  return ".wav";
}

function assetMatchesRevision(
  metadata: unknown,
  projectRevision: number,
  sceneRevision: number,
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const candidate = metadata as Record<string, unknown>;
  return (
    candidate.projectRevision === projectRevision &&
    candidate.sceneRevision === sceneRevision
  );
}

export function createRenderProcessor(
  objectStore = new LocalObjectStore(),
  ffmpegRunner = runFfmpeg,
  remotionRenderer: RemotionRenderer = runRemotion,
) {
  return async function processRenderJob(
    bullJob: LocalJob<RenderGenerationInput>,
  ): Promise<{ objectKey: string }> {
    const input = renderGenerationInputSchema.parse(bullJob.data);
    const prisma = getPrisma();
    const workspace = await mkdtemp(path.join(tmpdir(), "stickmotion-render-"));
    const bundleWorkspace = await mkdtemp(
      path.join(tmpdir(), "stickmotion-remotion-bundle-"),
    );

    await prisma.generationJob.update({
      where: { id: input.jobId },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        progress: 2,
        events: {
          create: { status: "RUNNING", progress: 2, code: "RENDER_STARTED" },
        },
      },
    });

    try {
      await synchronizeProjectSoundEffects(
        input.projectId,
        input.projectRevision,
        objectStore,
        prisma,
      );
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        include: {
          scenes: {
            orderBy: { order: "asc" },
            include: {
              voiceTracks: {
                orderBy: { createdAt: "desc" },
                take: 1,
                include: { asset: true },
              },
              soundPlacements: { include: { asset: true } },
              sceneAssets: {
                where: { role: "VISUAL" },
                orderBy: { order: "desc" },
                include: { asset: true },
              },
            },
          },
          assets: {
            where: { kind: "BGM" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
      if (project.revision !== input.projectRevision) {
        throw new Error("PROJECT_REVISION_STALE");
      }
      if (project.scenes.length === 0)
        throw new Error("RENDER_SCENES_REQUIRED");

      const portrait = project.aspectRatio === "PORTRAIT";
      const width = portrait ? 1080 : 1920;
      const height = portrait ? 1920 : 1080;
      const renderScenes: FfmpegRenderPlan["scenes"] = [];
      const remotionScenes: RemotionRenderInput["scenes"] = [];
      const subtitleCues: SubtitleCueInput[] = [];
      const soundEffects: NonNullable<FfmpegRenderPlan["soundEffects"]> = [];
      const subtitleStyle = subtitleStyleSchema.parse(project.subtitleStyle);
      const subtitleTemplate = await findSubtitleTemplate(
        subtitleStyle.templateId,
      );
      const resolvedSubtitleStyle = subtitleTemplate?.style;
      const knowledgeBoard = subtitleStyle.videoTemplate === "KNOWLEDGE_BOARD";
      const headerText =
        subtitleStyle.headerText ||
        "思维提升 | 表达沟通 | 职场成长 | 自我突破";
      let timelineMs = 0;
      const firstGeneratedSceneId = project.scenes.find(
        (item) => !item.isTextOpening,
      )?.id;

      for (const [index, scene] of project.scenes.entries()) {
        const isFirstGenerated = scene.id === firstGeneratedSceneId;
        const animation = scene.isTextOpening
          ? { type: "NONE" as const, direction: "NONE" as const, intensity: 0 }
          : isFirstGenerated
            ? {
                type: "RISE" as const,
                direction: "UP" as const,
                intensity: 1,
              }
            : animationSchema.parse(scene.animation);
        const transition = scene.isTextOpening
          ? { type: "CUT" as const, duration: 0 }
          : applyTransitionPreference(
              transitionSchema.parse(scene.transition),
              subtitleStyle.transitionsEnabled,
            );
        const imagePath = path.join(workspace, `scene-${index}.png`);
        let sourceImage: Uint8Array;

        if (scene.isTextOpening) {
          sourceImage = await sharp({
            create: {
              width,
              height,
              channels: 3,
              background: "#0B0B0F",
            },
          })
            .png()
            .toBuffer();
        } else if (project.visualMode === "AI_IMAGE") {
          const cached = scene.sceneAssets.find((link) =>
            assetMatchesRevision(
              link.asset.metadata,
              project.revision,
              scene.revision,
            ),
          );
          if (!cached) throw new Error("SCENE_IMAGE_REQUIRED");
          sourceImage = await objectStore.get(cached.asset.objectKey);
        } else {
          const elements = templateElementSchema
            .array()
            .parse(scene.templateElements);
          const svg = renderSvgScene({
            width,
            height,
            accentColor: project.accentColor,

            elements,
          });
          sourceImage = Buffer.from(svg);
        }
        const preparedImage: Uint8Array = knowledgeBoard
          ? await prepareKnowledgeBoardImage(sourceImage)
          : await sharp(sourceImage)
            .rotate()
            .resize(width, height, { fit: "cover", position: "centre" })
            .png()
            .toBuffer();
        await writeFile(imagePath, preparedImage);
        const ffmpegImagePath = knowledgeBoard
          ? path.join(workspace, `scene-${index}-frame.png`)
          : imagePath;
        if (knowledgeBoard) {
          await writeFile(
            ffmpegImagePath,
            await createKnowledgeBoardFrame({
              source: preparedImage,
              width,
              height,
              headerText,
              sourceIsPrepared: true,
            }),
          );
        }

        let voicePath: string | undefined;
        let voiceFile: string | undefined;
        const voiceAsset = scene.voiceTracks[0]?.asset;
        if (project.includeNarration && voiceAsset && !scene.isTextOpening) {
          voiceFile = `voice-${index}${mediaExtension(voiceAsset.contentType)}`;
          voicePath = path.join(workspace, voiceFile);
          await writeFile(
            voicePath,
            await objectStore.get(voiceAsset.objectKey),
          );
        }
        renderScenes.push({
          imagePath: ffmpegImagePath,
          duration: scene.estimatedDuration,
          animation: animation.type,
          transition,
          ...(voicePath ? { voicePath } : {}),
        });
        const sceneDurationMs = Math.round(scene.estimatedDuration * 1_000);
        const formattedOpening = scene.isTextOpening
          ? formatTextOpening(scene.subtitle)
          : undefined;
        const cueText = formattedOpening?.singleLine ?? scene.subtitle;
        const localSubtitleCues =
          project.includeSubtitles || scene.isTextOpening
            ? alignTextToDuration(cueText, sceneDurationMs)
            : [];
        if (project.includeSubtitles || scene.isTextOpening) {
          for (const cue of localSubtitleCues) {
            subtitleCues.push({
              ...cue,
              startMs: timelineMs + cue.startMs,
              endMs: timelineMs + cue.endMs,
            });
          }
        }
        const localSoundEffects: RemotionRenderInput["scenes"][number]["soundEffects"] =
          [];
        for (const [soundIndex, placement] of scene.soundPlacements.entries()) {
          const soundFile = `sfx-${index}-${soundIndex}${mediaExtension(placement.asset.contentType)}`;
          const soundPath = path.join(workspace, soundFile);
          await writeFile(
            soundPath,
            await objectStore.get(placement.asset.objectKey),
          );
          soundEffects.push({
            path: soundPath,
            offsetMs: timelineMs + placement.offsetMs,
            gainDb: placement.gainDb,
          });
          localSoundEffects.push({
            file: soundFile,
            offsetMs: placement.offsetMs,
            gainDb: placement.gainDb,
          });
        }
        remotionScenes.push({
          imageFile: path.basename(imagePath),
          durationMs: sceneDurationMs,
          animation,
          transition,
          isTextOpening: scene.isTextOpening,
          ...(formattedOpening
            ? { openingText: formattedOpening.displayText }
            : {}),
          ...(voiceFile ? { voiceFile } : {}),
          subtitleCues: localSubtitleCues,
          soundEffects: localSoundEffects,
        });
        timelineMs += sceneDurationMs;
        await bullJob.updateProgress(
          5 + Math.round(((index + 1) / project.scenes.length) * 20),
        );
      }

      let subtitlePath: string | undefined;
      if (project.includeSubtitles) {
        subtitlePath = path.join(workspace, "captions.ass");
        await writeFile(
          subtitlePath,
          cuesToAss(
            subtitleCues,
            {
              fontName:
                resolvedSubtitleStyle?.fontFamily ??
                (process.platform === "win32"
                  ? "Microsoft YaHei"
                  : "Noto Sans CJK SC"),
              fontSize:
                resolvedSubtitleStyle?.fontSize ?? subtitleStyle.fontSize,
              primaryColor:
                resolvedSubtitleStyle?.primaryColor ??
                (knowledgeBoard ? "#FFFFFF" : "#FFFFFF"),
              accentColor: project.accentColor,
              outline: resolvedSubtitleStyle
                ? resolvedSubtitleStyle.outlineWidth > 0
                : knowledgeBoard
                  ? true
                  : subtitleStyle.outline,
              ...(knowledgeBoard
                ? { outlineColor: "#000000", outlineWidth: 8 }
                : {}),
              shadow:
                resolvedSubtitleStyle?.shadow ??
                (knowledgeBoard ? false : subtitleStyle.shadow),
              position:
                resolvedSubtitleStyle?.position ??
                (knowledgeBoard ? "BOTTOM" : subtitleStyle.position),
              bilingual: subtitleStyle.mode === "BILINGUAL",
              ...(resolvedSubtitleStyle
                ? {
                    fontWeight: resolvedSubtitleStyle.fontWeight,
                    italic: resolvedSubtitleStyle.italic,
                    backgroundColor: resolvedSubtitleStyle.backgroundColor,
                    outlineColor: resolvedSubtitleStyle.outlineColor,
                    outlineWidth: resolvedSubtitleStyle.outlineWidth,
                    shadowColor: resolvedSubtitleStyle.shadowColor,
                  }
                : {}),
            },
            { width, height },
          ),
          "utf8",
        );
      }

      let backgroundMusicPath: string | undefined;
      let backgroundMusicFile: string | undefined;
      const backgroundMusic = project.assets[0];
      if (backgroundMusic) {
        backgroundMusicFile = `background-music${mediaExtension(backgroundMusic.contentType)}`;
        backgroundMusicPath = path.join(workspace, backgroundMusicFile);
        await writeFile(
          backgroundMusicPath,
          await objectStore.get(backgroundMusic.objectKey),
        );
      }
      await Promise.all([
        writeFile(
          path.join(workspace, "DouyinSansBold.otf"),
          await readFile(
            path.resolve(
              process.cwd(),
              "../../assets/fonts/DouyinSansBold.otf",
            ),
          ),
        ),
        writeFile(
          path.join(workspace, "HarmonyOS_Sans_SC_Light.ttf"),
          await readFile(
            path.resolve(
              process.cwd(),
              "../../assets/fonts/HarmonyOS_Sans_SC_Light.ttf",
            ),
          ),
        ),
      ]);
      const outputPath = path.join(workspace, "output.mp4");
      const command = buildFfmpegRenderCommand({
        scenes: renderScenes,
        outputPath,
        ...(subtitlePath ? { subtitlePath } : {}),
        ...(backgroundMusicPath ? { backgroundMusicPath } : {}),
        soundEffects,
        width,
        height,
        watermark: input.watermark,
        ...(process.env.FFMPEG_FONT_FILE
          ? { fontFile: process.env.FFMPEG_FONT_FILE }
          : process.platform === "win32"
            ? { fontFile: "C:\\Windows\\Fonts\\arial.ttf" }
            : {}),
      });

      const reportRenderProgress = (ratio: number) => {
        const progress =
          25 + Math.min(70, Math.round(Math.min(1, Math.max(0, ratio)) * 70));
        void bullJob.updateProgress(progress);
        void prisma.generationJob.update({
          where: { id: input.jobId },
          data: { progress },
        });
      };
      const remotionPlan: RemotionRenderInput = {
        width,
        height,
        fps: 30,
        scenes: remotionScenes,
        ...(backgroundMusicFile ? { backgroundMusicFile } : {}),
        backgroundMusicVolume: project.includeNarration ? 0.14 : 0.22,
        videoTemplate: subtitleStyle.videoTemplate,
        headerText,
        subtitleStyle: {
          fontSize:
            resolvedSubtitleStyle?.fontSize ?? subtitleStyle.fontSize,
          position:
            resolvedSubtitleStyle?.position ??
            (knowledgeBoard ? "BOTTOM" : subtitleStyle.position),
          outline: resolvedSubtitleStyle
            ? resolvedSubtitleStyle.outlineWidth > 0
            : knowledgeBoard
              ? false
              : subtitleStyle.outline,
          shadow:
            resolvedSubtitleStyle?.shadow ??
            (knowledgeBoard ? false : subtitleStyle.shadow),
          accentColor: project.accentColor,
          ...(resolvedSubtitleStyle
            ? {
                fontFamily: resolvedSubtitleStyle.fontFamily,
                fontWeight: resolvedSubtitleStyle.fontWeight,
                italic: resolvedSubtitleStyle.italic,
                primaryColor: resolvedSubtitleStyle.primaryColor,
                backgroundColor: resolvedSubtitleStyle.backgroundColor,
                outlineColor: resolvedSubtitleStyle.outlineColor,
                outlineWidth: resolvedSubtitleStyle.outlineWidth,
                shadowColor: resolvedSubtitleStyle.shadowColor,
              }
            : {}),
          leftVerticalText:
            (resolvedSubtitleStyle as { leftVerticalText?: string } | undefined)
              ?.leftVerticalText ??
            subtitleStyle.leftVerticalText,
          rightVerticalText:
            (resolvedSubtitleStyle as { rightVerticalText?: string } | undefined)
              ?.rightVerticalText ??
            subtitleStyle.rightVerticalText,
          mainTitle:
            (resolvedSubtitleStyle as { mainTitle?: string } | undefined)
              ?.mainTitle ??
            subtitleStyle.mainTitle,
          ...(knowledgeBoard
            ? {
                primaryColor: "#FFFFFF",
                outlineColor: "#000000",
                outlineWidth: 8,
                outline: true,
                shadow: false,
              }
            : {}),
        },
        watermark: input.watermark,
      };
      const useFfmpegOnly = process.env.RENDER_ENGINE === "ffmpeg";
      let renderSource = "remotion";
      if (!useFfmpegOnly) {
        try {
          await remotionRenderer({
            plan: remotionPlan,
            publicDir: workspace,
            bundleDir: bundleWorkspace,
            outputPath,
            onProgress: reportRenderProgress,
          });
        } catch (error) {
          if (process.env.REMOTION_FALLBACK_TO_FFMPEG === "false") throw error;
          renderSource = "ffmpeg-fallback";
          await rm(outputPath, { force: true });
          await prisma.generationJob.update({
            where: { id: input.jobId },
            data: {
              events: {
                create: {
                  status: "RUNNING",
                  progress: 25,
                  code: "REMOTION_RENDER_FALLBACK",
                  message: cleanError(error),
                },
              },
            },
          });
          await ffmpegRunner(command.args, (outTimeMs) =>
            reportRenderProgress(outTimeMs / (command.durationSeconds * 1_000)),
          );
        }
      } else {
        renderSource = "ffmpeg";
        await ffmpegRunner(command.args, (outTimeMs) =>
          reportRenderProgress(outTimeMs / (command.durationSeconds * 1_000)),
        );
      }
      await bullJob.updateProgress(95);

      const video = await readFile(outputPath);
      const objectKey = `projects/${project.id}/revisions/${project.revision}/renders/${input.jobId}.mp4`;
      const stored = await objectStore.put(objectKey, video, "video/mp4");
      await prisma.$transaction(async (tx) => {
        const asset = await tx.asset.create({
          data: {
            projectId: project.id,
            kind: "VIDEO_FINAL",
            bucket: stored.bucket,
            objectKey: stored.objectKey,
            contentType: "video/mp4",
            byteSize: BigInt(stored.byteSize),
            source: renderSource,
            license: "project-output",
          },
        });
        await tx.renderOutput.create({
          data: {
            projectId: project.id,
            assetId: asset.id,
            projectRevision: project.revision,
            width,
            height,
            durationMs: timelineMs,
          },
        });
        await tx.project.update({
          where: { id: project.id },
          data: { status: "COMPLETED" },
        });
        await tx.generationJob.update({
          where: { id: input.jobId },
          data: {
            status: "SUCCEEDED",
            progress: 100,
            errorCode: null,
            errorMessage: null,
            finishedAt: new Date(),
            output: { objectKey, width, height },
            events: {
              create: {
                status: "SUCCEEDED",
                progress: 100,
                code: "RENDER_SUCCEEDED",
              },
            },
          },
        });
      });
      await bullJob.updateProgress(100);
      return { objectKey };
    } catch (error) {
      const willRetry =
        bullJob.attemptsMade + 1 <
        (typeof bullJob.opts.attempts === "number" ? bullJob.opts.attempts : 1);
      await prisma.generationJob.update({
        where: { id: input.jobId },
        data: {
          status: willRetry ? "RETRYING" : "FAILED",
          errorCode: "RENDER_FAILED",
          errorMessage: cleanError(error),
          ...(willRetry ? {} : { finishedAt: new Date() }),
          events: {
            create: {
              status: willRetry ? "RETRYING" : "FAILED",
              progress: 0,
              code: "RENDER_FAILED",
              message: cleanError(error),
            },
          },
        },
      });
      throw error instanceof Error ? error : new Error(cleanError(error));
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(bundleWorkspace, { recursive: true, force: true });
    }
  };
}
