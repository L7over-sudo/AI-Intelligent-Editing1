import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LocalJob } from "@stickmotion/queue";
import sharp from "sharp";

import { getPrisma } from "@stickmotion/db";
import {
  alignTextToDuration,
  buildFfmpegRenderCommand,
  concatenatePcmWav,
  cuesToAss,
  interSceneNarrationPauseMs,
  pcmWavTrailingSilenceMs,
  slicePcmWav,
  type FfmpegRenderPlan,
  type SubtitleCueInput,
  wavDurationMs,
} from "@stickmotion/media";
import { renderSvgScene } from "@stickmotion/scene-engine";
import {
  applyTransitionPreference,
  renderGenerationInputSchema,
  subtitleStyleSchema,
  templateElementSchema,
  transitionSchema,
  type RemotionRenderInput,
  type RenderGenerationInput,
} from "@stickmotion/shared";

function firstSentenceOf(text: string): string {
  const firstLine = text
    .trim()
    .split(/\r?\n/u)
    .find((line) => line.trim());
  const source = (firstLine ?? text).trim();
  return source.split(/[。！？!?]/u)[0]?.trim() || source;
}

import { runFfmpeg } from "../services/ffmpeg-runner";
import { probeMediaInfo } from "../services/media-probe";
import {
  runRemotion,
  type RemotionRenderer,
} from "../services/remotion-renderer";
import { synchronizeProjectSoundEffects } from "../services/sound-effect-library";
import { generateProjectCoversAfterRender } from "../services/project-cover-generator";
import { allowsTemplateSafeFfmpegFallback } from "../services/render-fallback-policy";
import { findSubtitleTemplate } from "../services/subtitle-template-library";
import {
  createKnowledgeBoardFrame,
  prepareKnowledgeBoardImage,
} from "../services/video-template-frame";
import { LocalObjectStore } from "@stickmotion/storage";
import { createMonotonicProgressReporter } from "../services/monotonic-progress";
import { prepareStoredSubtitleCues } from "../services/subtitle-timing";
import { resolveContinuousNarrationMetadata } from "../services/continuous-narration-asset";
import { resolveRenderAnimation } from "./render-animation";

const cleanError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2_000);

export const RENDER_FPS = 30;

function mediaExtension(contentType: string): string {
  if (contentType.includes("mpeg")) return ".mp3";
  if (contentType.includes("mp4") || contentType.includes("m4a")) return ".m4a";
  if (contentType.includes("ogg")) return ".ogg";
  if (contentType.includes("flac")) return ".flac";
  return ".wav";
}

const sentenceEndingPattern = /[。！？!?…][”’"'）)\]】》〉]*$/u;

function trimStoredVoiceTail(audio: Uint8Array, narration: string): Uint8Array {
  const durationMs = wavDurationMs(audio);
  const trailingMs = pcmWavTrailingSilenceMs(audio) ?? 0;
  const maximumTailMs = sentenceEndingPattern.test(narration.trim())
    ? 160
    : 140;
  if (!durationMs || trailingMs <= maximumTailMs) return audio;
  return slicePcmWav(
    audio,
    0,
    Math.max(1, durationMs - (trailingMs - maximumTailMs)),
  );
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
    const progressReporter = createMonotonicProgressReporter(
      2,
      async (progress) => {
        await Promise.all([
          bullJob.updateProgress(progress),
          prisma.generationJob.update({
            where: { id: input.jobId },
            data: { progress },
          }),
        ]);
      },
    );
    const abortController = new AbortController();
    const cancellationPoll = setInterval(() => {
      void prisma.generationJob
        .findUnique({
          where: { id: input.jobId },
          select: { status: true },
        })
        .then((job) => {
          if (
            job?.status === "CANCEL_REQUESTED" ||
            job?.status === "CANCELED"
          ) {
            abortController.abort();
          }
        })
        .catch(() => undefined);
    }, 800);
    const stopCancellationPoll = () => clearInterval(cancellationPoll);
    const throwIfCanceled = () => {
      if (abortController.signal.aborted) throw new Error("RENDER_CANCELED");
    };

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
              subtitleCues: { orderBy: { order: "asc" } },
              soundPlacements: { include: { asset: true } },
              sceneAssets: {
                where: { role: "VISUAL" },
                orderBy: { order: "desc" },
                include: { asset: true },
              },
            },
          },
          assets: {
            where: { kind: { in: ["BGM", "NARRATION_MIX"] } },
            orderBy: { createdAt: "desc" },
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
      const narrationParts: Uint8Array[] = [];
      const sceneIds = project.scenes.map((scene) => scene.id);
      const continuousNarrationAsset = project.assets
        .filter((asset) => asset.kind === "NARRATION_MIX")
        .map((asset) => ({
          asset,
          metadata: resolveContinuousNarrationMetadata(
            asset.metadata,
            project.revision,
            sceneIds,
          ),
        }))
        .find((candidate) => candidate.metadata !== undefined);
      const continuousNarrationMetadata = continuousNarrationAsset?.metadata;
      const useStoredContinuousNarration =
        project.includeNarration &&
        continuousNarrationAsset !== undefined &&
        continuousNarrationMetadata !== undefined;
      let canUseContinuousNarration =
        project.includeNarration && !useStoredContinuousNarration;
      const subtitleCues: SubtitleCueInput[] = [];
      const soundEffects: NonNullable<FfmpegRenderPlan["soundEffects"]> = [];
      const subtitleStyle = subtitleStyleSchema.parse(project.subtitleStyle);
      const subtitleTemplate = await findSubtitleTemplate(
        subtitleStyle.templateId,
      );
      const resolvedSubtitleStyle = subtitleTemplate?.style;
      const subtitleFontSize =
        resolvedSubtitleStyle?.fontSize ?? subtitleStyle.fontSize;
      const knowledgeBoard = subtitleStyle.videoTemplate === "KNOWLEDGE_BOARD";
      const headerText =
        subtitleStyle.headerText ||
        "\u601d\u7ef4\u63d0\u5347|\u8868\u8fbe\u6c9f\u901a|\u804c\u573a\u6210\u957f|\u81ea\u6211\u7a81\u7834";
      const resolvedTemplateText = resolvedSubtitleStyle as
        | {
            leftVerticalText?: string;
            rightVerticalText?: string;
            mainTitle?: string;
          }
        | undefined;
      const leftVerticalText =
        resolvedTemplateText?.leftVerticalText ??
        subtitleStyle.leftVerticalText;
      const rightVerticalText =
        resolvedTemplateText?.rightVerticalText ??
        subtitleStyle.rightVerticalText;
      const templateMainTitle = (
        resolvedTemplateText?.mainTitle ??
        subtitleStyle.mainTitle ??
        ""
      ).trim();
      const mainTitle =
        templateMainTitle ||
        (subtitleStyle.customTitle
          ? project.title.trim()
          : firstSentenceOf(project.sourceText) || project.title.trim());
      let timelineMs = 0;

      for (const [index, scene] of project.scenes.entries()) {
        throwIfCanceled();
        const animation = resolveRenderAnimation(scene.animation, index, {
          knowledgeBoard,
        });
        const transition = applyTransitionPreference(
          transitionSchema.parse(scene.transition),
          subtitleStyle.transitionsEnabled,
          index,
          project.scenes.length,
        );
        const imagePath = path.join(workspace, `scene-${index}.png`);
        let sourceImage: Uint8Array;

        if (project.visualMode === "AI_IMAGE") {
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
              mainTitle,
              leftVerticalText,
              rightVerticalText,
              sourceIsPrepared: true,
            }),
          );
        }

        let voicePath: string | undefined;
        let voiceFile: string | undefined;
        let normalizedVoiceCues: SubtitleCueInput[] | undefined;
        let sceneDurationMs = Math.round(scene.estimatedDuration * 1_000);
        const voiceTrack = scene.voiceTracks[0];
        const voiceAsset = voiceTrack?.asset;
        if (project.includeNarration && voiceAsset) {
          voiceFile = `voice-${index}${mediaExtension(voiceAsset.contentType)}`;
          voicePath = path.join(workspace, voiceFile);
          const storedCues: SubtitleCueInput[] = scene.subtitleCues.map(
            (cue) => ({
              startMs: cue.startMs,
              endMs: Math.max(cue.startMs + 1, cue.endMs),
              text: cue.text,
              ...(cue.translation ? { translation: cue.translation } : {}),
              ...(Array.isArray(cue.highlighted)
                ? {
                    highlighted: cue.highlighted.filter(
                      (value): value is string => typeof value === "string",
                    ),
                  }
                : {}),
            }),
          );
          const continuousSceneDurationMs =
            continuousNarrationMetadata?.sceneDurationsMs[index];
          const storedVoiceAudio = await objectStore.get(voiceAsset.objectKey);
          const voiceAudio = trimStoredVoiceTail(
            storedVoiceAudio,
            scene.narration,
          );
          const trimmedVoiceDurationMs = wavDurationMs(voiceAudio);
          if (continuousSceneDurationMs) {
            sceneDurationMs = continuousSceneDurationMs;
          } else if (trimmedVoiceDurationMs && trimmedVoiceDurationMs > 0) {
            sceneDurationMs = Math.max(300, trimmedVoiceDurationMs);
          } else if (voiceTrack.durationMs && voiceTrack.durationMs > 0) {
            sceneDurationMs = Math.max(300, voiceTrack.durationMs);
          }
          if (!continuousSceneDurationMs && index < project.scenes.length - 1) {
            // TTS clips already end with a short tail, so this only
            // adds room after true sentence endings; comma clause breaks
            // keep their natural flow.
            sceneDurationMs += interSceneNarrationPauseMs(scene.narration);
          }
          normalizedVoiceCues = prepareStoredSubtitleCues(
            storedCues,
            sceneDurationMs,
          );
          await writeFile(voicePath, voiceAudio);
          if (voiceAsset.contentType === "audio/wav") {
            narrationParts.push(voiceAudio);
          } else {
            canUseContinuousNarration = false;
          }
        } else if (project.includeNarration) {
          canUseContinuousNarration = false;
        }
        renderScenes.push({
          imagePath: ffmpegImagePath,
          duration: sceneDurationMs / 1_000,
          animation: animation.type,
          transition,
          ...(voicePath ? { voicePath } : {}),
        });
        const localSubtitleCues = project.includeSubtitles
          ? normalizedVoiceCues && normalizedVoiceCues.length > 0
            ? normalizedVoiceCues
            : alignTextToDuration(scene.subtitle, sceneDurationMs, null)
          : [];
        if (project.includeSubtitles) {
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
          ...(voiceFile ? { voiceFile } : {}),
          subtitleCues: localSubtitleCues,
          soundEffects: localSoundEffects,
        });
        timelineMs += sceneDurationMs;
        progressReporter.report(
          5 + Math.round(((index + 1) / project.scenes.length) * 20),
        );
      }

      let narrationPath: string | undefined;
      let narrationFile: string | undefined;
      if (useStoredContinuousNarration && continuousNarrationAsset) {
        narrationFile = "narration.wav";
        narrationPath = path.join(workspace, narrationFile);
        await writeFile(
          narrationPath,
          await objectStore.get(continuousNarrationAsset.asset.objectKey),
        );
      } else if (
        canUseContinuousNarration &&
        narrationParts.length === project.scenes.length
      ) {
        narrationFile = "narration.wav";
        narrationPath = path.join(workspace, narrationFile);
        await writeFile(
          narrationPath,
          concatenatePcmWav(
            narrationParts.map((audio, partIndex) => ({
              audio,
              pauseAfterMs:
                partIndex < narrationParts.length - 1
                  ? interSceneNarrationPauseMs(
                      project.scenes[partIndex]!.narration,
                    )
                  : 0,
            })),
          ),
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
              fontSize: subtitleFontSize,
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
      const backgroundMusic = project.assets.find(
        (asset) => asset.kind === "BGM",
      );
      if (backgroundMusic) {
        backgroundMusicFile = `background-music${mediaExtension(backgroundMusic.contentType)}`;
        backgroundMusicPath = path.join(workspace, backgroundMusicFile);
        await writeFile(
          backgroundMusicPath,
          await objectStore.get(backgroundMusic.objectKey),
        );

        // Short background music is looped to cover the full video so both
        // the Remotion and FFmpeg render paths always have a track that
        // lasts until the end of the narration.
        const musicInfo = await probeMediaInfo(backgroundMusicPath);
        const musicDurationMs = musicInfo.durationMs ?? timelineMs;
        if (musicDurationMs < timelineMs) {
          const loopedFile = "background-music-looped.mp3";
          const loopedPath = path.join(workspace, loopedFile);
          const loopSeconds = (timelineMs + 1_000) / 1_000;
          await runFfmpeg(
            [
              "-stream_loop",
              "-1",
              "-i",
              backgroundMusicPath,
              "-t",
              loopSeconds.toFixed(3),
              "-ac",
              "2",
              "-ar",
              "48000",
              "-c:a",
              "libmp3lame",
              "-q:a",
              "2",
              "-y",
              loopedPath,
            ],
            () => undefined,
          );
          backgroundMusicFile = loopedFile;
          backgroundMusicPath = loopedPath;
        }
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
      const filterScriptPath = path.join(workspace, "complex-filter.txt");
      const command = buildFfmpegRenderCommand({
        scenes: renderScenes,
        outputPath,
        ...(subtitlePath ? { subtitlePath } : {}),
        ...(narrationPath ? { narrationPath } : {}),
        ...(backgroundMusicPath ? { backgroundMusicPath } : {}),
        narrationVolume: project.narrationVolume,
        backgroundMusicVolume: project.backgroundMusicVolume,
        soundEffects,
        width,
        height,
        fps: RENDER_FPS,
        watermark: input.watermark,
        filterScriptPath,
        ...(process.env.FFMPEG_FONT_FILE
          ? { fontFile: process.env.FFMPEG_FONT_FILE }
          : process.platform === "win32"
            ? { fontFile: "C:\\Windows\\Fonts\\arial.ttf" }
            : {}),
      });
      await writeFile(filterScriptPath, command.filterScript);

      const reportRenderProgress = (ratio: number) => {
        const progress =
          25 + Math.min(70, Math.round(Math.min(1, Math.max(0, ratio)) * 70));
        progressReporter.report(progress);
      };
      const remotionPlan: RemotionRenderInput = {
        width,
        height,
        fps: RENDER_FPS,
        scenes: narrationFile
          ? remotionScenes.map((scene) => ({ ...scene, voiceFile: undefined }))
          : remotionScenes,
        ...(narrationFile ? { narrationFile } : {}),
        ...(backgroundMusicFile ? { backgroundMusicFile } : {}),
        narrationVolume: project.narrationVolume,
        backgroundMusicVolume: project.backgroundMusicVolume,
        videoTemplate: subtitleStyle.videoTemplate,
        headerText,
        subtitleStyle: {
          fontSize: subtitleFontSize,
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
          leftVerticalText,
          rightVerticalText,
          mainTitle,
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
            signal: abortController.signal,
          });
        } catch (error) {
          if (abortController.signal.aborted) throw error;
          if (
            !allowsTemplateSafeFfmpegFallback(
              subtitleStyle.videoTemplate,
              process.env.REMOTION_FALLBACK_TO_FFMPEG,
            )
          ) {
            throw error;
          }
          renderSource = "ffmpeg-fallback";
          await rm(outputPath, { force: true });
          await prisma.generationJob.update({
            where: { id: input.jobId },
            data: {
              events: {
                create: {
                  status: "RUNNING",
                  progress: progressReporter.current(),
                  code: "REMOTION_RENDER_FALLBACK",
                  message: cleanError(error),
                },
              },
            },
          });
          await ffmpegRunner(
            command.args,
            (outTimeMs) =>
              reportRenderProgress(
                outTimeMs / (command.durationSeconds * 1_000),
              ),
            abortController.signal,
          );
        }
      } else {
        renderSource = "ffmpeg";
        await ffmpegRunner(
          command.args,
          (outTimeMs) =>
            reportRenderProgress(outTimeMs / (command.durationSeconds * 1_000)),
          abortController.signal,
        );
      }
      throwIfCanceled();
      progressReporter.report(95);
      await progressReporter.flush();

      const video = await readFile(outputPath);
      const objectKey = `projects/${project.id}/revisions/${project.revision}/renders/${input.jobId}.mp4`;
      const stored = await objectStore.put(objectKey, video, "video/mp4");
      const covers = await generateProjectCoversAfterRender({
        prisma,
        objectStore,
        project,
        projectRevision: input.projectRevision,
      });
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
            output: {
              objectKey,
              width,
              height,
              coverAssetId: covers.portraitAssetId,
              coverLandscapeAssetId: covers.landscapeAssetId,
              coverTitle: covers.copy?.title ?? null,
              coverSubtitle: covers.copy?.subtitle ?? null,
              coverCopyModel: covers.model,
              coverCopySource: covers.source,
            },
            events: {
              create: {
                status: "SUCCEEDED",
                progress: 100,
                code: "RENDER_SUCCEEDED",
                metadata: {
                  coverAssetId: covers.portraitAssetId,
                  coverLandscapeAssetId: covers.landscapeAssetId,
                  coverCopyModel: covers.model,
                  coverCopySource: covers.source,
                },
              },
            },
          },
        });
      });
      await bullJob.updateProgress(100);
      return { objectKey };
    } catch (error) {
      const canceled = abortController.signal.aborted;
      const willRetry =
        bullJob.attemptsMade + 1 <
        (typeof bullJob.opts.attempts === "number" ? bullJob.opts.attempts : 1);
      await prisma.generationJob.update({
        where: { id: input.jobId },
        data: {
          ...(canceled
            ? {
                status: "CANCELED",
                errorCode: "RENDER_CANCELED",
                errorMessage: "渲染已取消",
                finishedAt: new Date(),
              }
            : {
                status: willRetry ? "RETRYING" : "FAILED",
                errorCode: "RENDER_FAILED",
                errorMessage: cleanError(error),
                ...(willRetry ? {} : { finishedAt: new Date() }),
              }),
          events: {
            create: {
              status: canceled ? "CANCELED" : willRetry ? "RETRYING" : "FAILED",
              progress: 0,
              code: canceled ? "RENDER_CANCELED" : "RENDER_FAILED",
              message: canceled ? "渲染已取消" : cleanError(error),
            },
          },
        },
      });
      if (canceled) {
        await rm(path.join(workspace, "output.mp4"), { force: true }).catch(
          () => undefined,
        );
      }
      throw error instanceof Error ? error : new Error(cleanError(error));
    } finally {
      stopCancellationPoll();
      await rm(workspace, { recursive: true, force: true });
      await rm(bundleWorkspace, { recursive: true, force: true });
    }
  };
}
