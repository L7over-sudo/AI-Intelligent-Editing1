import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getPrisma } from "@stickmotion/db";
import {
  alignTextToDuration,
  interSceneNarrationPauseMs,
  type SubtitleCueInput,
} from "@stickmotion/media";
import { subtitleStyleSchema } from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import {
  type JianyingDraftInput,
  type JianyingDraftScene,
} from "./jianying-draft";
import { probeMediaInfo } from "./media-probe";
import { findSubtitleTemplate } from "./subtitle-template-library";
import { resolveContinuousNarrationMetadata } from "./continuous-narration-asset";
import { prepareStoredSubtitleCues } from "./subtitle-timing";
import {
  createKnowledgeBoardFrame,
  prepareKnowledgeBoardImage,
} from "./video-template-frame";

function firstSentenceOf(text: string): string {
  const firstLine = text
    .trim()
    .split(/\r?\n/u)
    .find((line) => line.trim());
  const source = (firstLine ?? text).trim();
  return source.split(/[。！？!?]/u)[0]?.trim() || source;
}

function mediaExtension(contentType: string): string {
  if (contentType.includes("mpeg")) return ".mp3";
  if (contentType.includes("wav")) return ".wav";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  return ".bin";
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

async function probeBytes(
  workspace: string,
  fileName: string,
  bytes: Uint8Array,
) {
  const filePath = path.join(workspace, fileName);
  await writeFile(filePath, bytes);
  return probeMediaInfo(filePath);
}

export async function collectJianyingDraftInput(
  projectId: string,
  projectRevision: number,
  objectStore = new LocalObjectStore(),
): Promise<JianyingDraftInput> {
  const prisma = getPrisma();
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      scenes: {
        orderBy: { order: "asc" },
        include: {
          sceneAssets: {
            where: { role: "VISUAL" },
            orderBy: { order: "desc" },
            include: { asset: true },
          },
          voiceTracks: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { asset: true },
          },
          soundPlacements: { include: { asset: true } },
          subtitleCues: { orderBy: { order: "asc" } },
        },
      },
      renderOutputs: {
        where: { projectRevision },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { asset: true },
      },
      assets: {
        where: { kind: { in: ["BGM", "NARRATION_MIX"] } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (project.revision !== projectRevision) {
    throw new Error("PROJECT_REVISION_STALE");
  }
  const render = project.renderOutputs[0];
  if (!render) throw new Error("CURRENT_RENDER_REQUIRED");

  const subtitleStyle = subtitleStyleSchema.parse(project.subtitleStyle);
  const subtitleTemplate = await findSubtitleTemplate(
    subtitleStyle.templateId,
  );
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
  const continuousNarrationMetadata =
    continuousNarrationAsset?.metadata;
  const resolvedSubtitleStyle = subtitleTemplate?.style;
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
  const draftSubtitleStyle = {
    fontSize: resolvedSubtitleStyle?.fontSize ?? subtitleStyle.fontSize,
    primaryColor:
      resolvedSubtitleStyle?.primaryColor ??
      (knowledgeBoard ? "#FFFFFF" : "#FFFFFF"),
    accentColor: project.accentColor,
    outline: resolvedSubtitleStyle
      ? resolvedSubtitleStyle.outlineWidth > 0
      : knowledgeBoard
        ? true
        : subtitleStyle.outline,
    outlineColor:
      resolvedSubtitleStyle?.outlineColor ??
      "#000000",
    shadow:
      resolvedSubtitleStyle?.shadow ??
      (knowledgeBoard ? false : subtitleStyle.shadow),
    position:
      resolvedSubtitleStyle?.position ??
      (knowledgeBoard ? "BOTTOM" : subtitleStyle.position),
    keywordHighlight: subtitleStyle.keywordHighlight,
  } as const;
  const workspace = await mkdtemp(
    path.join(tmpdir(), "stickmotion-draft-probe-"),
  );

  try {
    const subtitleCues: SubtitleCueInput[] = [];
    const scenes: JianyingDraftScene[] = [];
    let timelineMs = 0;

    for (const [index, scene] of project.scenes.entries()) {
      const voiceTrack = scene.voiceTracks[0];
      const voiceAsset = voiceTrack?.asset;
      const continuousSceneDurationMs =
        continuousNarrationMetadata?.sceneDurationsMs[index];
      const baseSceneDurationMs = continuousSceneDurationMs
        ? continuousSceneDurationMs
        : Math.max(
            300,
            voiceTrack?.durationMs && voiceTrack.durationMs > 0
              ? voiceTrack.durationMs
              : Math.round(scene.estimatedDuration * 1_000),
          );
      const endPauseMs =
        continuousSceneDurationMs === undefined &&
        project.includeNarration &&
        voiceTrack !== undefined &&
        index < project.scenes.length - 1
          ? interSceneNarrationPauseMs(scene.narration)
          : 0;
      const sceneDurationMs = baseSceneDurationMs + endPauseMs;

      const imageAsset =
        scene.sceneAssets.find((link) =>
          assetMatchesRevision(
            link.asset.metadata,
            project.revision,
            scene.revision,
          ),
        )?.asset ?? scene.sceneAssets[0]?.asset;
      if (!imageAsset) throw new Error("SCENE_IMAGE_REQUIRED");

      const fileNumber = String(index + 1).padStart(3, "0");
      const imageExtension = mediaExtension(imageAsset.contentType);
      const rawImageBytes = await objectStore.get(imageAsset.objectKey);
      let imageBytes: Uint8Array = rawImageBytes;
      let imageWidth: number;
      let imageHeight: number;
      if (knowledgeBoard) {
        imageBytes = await createKnowledgeBoardFrame({
          source: await prepareKnowledgeBoardImage(rawImageBytes),
          width: render.width,
          height: render.height,
          headerText,
          mainTitle,
          leftVerticalText,
          rightVerticalText,
          sourceIsPrepared: true,
        });
        imageWidth = render.width;
        imageHeight = render.height;
      } else {
        const imageProbe = await probeBytes(
          workspace,
          `image-${fileNumber}${imageExtension}`,
          imageBytes,
        );
        if (!imageProbe.width || !imageProbe.height) {
          throw new Error("SCENE_IMAGE_DIMENSIONS_REQUIRED");
        }
        imageWidth = imageProbe.width;
        imageHeight = imageProbe.height;
      }

      const draftScene: JianyingDraftScene = {
        image: {
          bytes: imageBytes,
          fileName: `scene-${fileNumber}${imageExtension}`,
          durationMs: sceneDurationMs,
          width: imageWidth,
          height: imageHeight,
        },
        durationMs: sceneDurationMs,
        // 对齐优先：暂不挂转场，图片/字幕/配音三轨完全等长且不重叠。
        transition: { type: "CUT", durationMs: 0 },
      };

      if (project.includeNarration && voiceAsset) {
        const voiceBytes = await objectStore.get(voiceAsset.objectKey);
        draftScene.voice = {
          bytes: voiceBytes,
          fileName: `voice-${fileNumber}${mediaExtension(voiceAsset.contentType)}`,
          durationMs:
            voiceTrack?.durationMs && voiceTrack.durationMs > 0
              ? voiceTrack.durationMs
              : sceneDurationMs,
        };
      }

      let localSubtitleCues: SubtitleCueInput[] = [];
      if (project.includeSubtitles) {
        const storedCues: SubtitleCueInput[] = scene.subtitleCues.map(
          (cue) => ({
            startMs: cue.startMs,
            endMs: Math.max(cue.startMs + 1, cue.endMs),
            text: cue.text,
            ...(Array.isArray(cue.highlighted)
              ? {
                  highlighted: cue.highlighted.filter(
                    (value): value is string => typeof value === "string",
                  ),
                }
              : {}),
          }),
        );
        localSubtitleCues =
          storedCues.length > 0
            ? prepareStoredSubtitleCues(storedCues, sceneDurationMs)
            : alignTextToDuration(scene.subtitle, sceneDurationMs, null);
      }

      if (project.includeSoundEffects && scene.soundPlacements.length > 0) {
        const soundEffects: NonNullable<JianyingDraftScene["soundEffects"]> = [];
        for (const [soundIndex, placement] of scene.soundPlacements.entries()) {
          const sfxBytes = await objectStore.get(placement.asset.objectKey);
          const sfxProbe = await probeBytes(
            workspace,
            `sfx-${fileNumber}-${soundIndex}${mediaExtension(placement.asset.contentType)}`,
            sfxBytes,
          );
          soundEffects.push({
            bytes: sfxBytes,
            fileName: `sfx-${fileNumber}-${soundIndex}${mediaExtension(placement.asset.contentType)}`,
            durationMs: sfxProbe.durationMs ?? 500,
            offsetMs: placement.offsetMs,
            gainDb: placement.gainDb,
          });
        }
        draftScene.soundEffects = soundEffects;
      }

      for (const cue of localSubtitleCues) {
        subtitleCues.push({
          ...cue,
          startMs: timelineMs + cue.startMs,
          endMs: Math.min(render.durationMs, timelineMs + cue.endMs),
        });
      }
      timelineMs += sceneDurationMs;
      scenes.push(draftScene);
    }

    const backgroundMusicAsset = project.assets.find(
      (asset) => asset.kind === "BGM",
    );
    let backgroundMusic: JianyingDraftInput["backgroundMusic"];
    if (backgroundMusicAsset) {
      const musicBytes = await objectStore.get(backgroundMusicAsset.objectKey);
      const musicProbe = await probeBytes(
        workspace,
        `music${mediaExtension(backgroundMusicAsset.contentType)}`,
        musicBytes,
      );
      backgroundMusic = {
        bytes: musicBytes,
        fileName: `background-music${mediaExtension(backgroundMusicAsset.contentType)}`,
        durationMs: musicProbe.durationMs ?? render.durationMs,
        volume: project.backgroundMusicVolume,
      };
    }

    return {
      projectId: project.id,
      projectRevision: project.revision,
      title: project.title,
      width: render.width,
      height: render.height,
      durationMs: render.durationMs,
      scenes,
      ...(backgroundMusic ? { backgroundMusic } : {}),
      subtitleCues: subtitleCues.filter((cue) => cue.endMs > cue.startMs),
      subtitleStyle: draftSubtitleStyle,
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
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
