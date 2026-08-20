import { readFile } from "node:fs/promises";

import { getPrisma } from "@stickmotion/db";
import { splitSubtitleText } from "@stickmotion/media";
import { continuousNarrationAssetMetadataSchema } from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";
import { z } from "zod";

import { voiceTextForScene } from "../processors/voice";
import { alignNarrationWithLocalWhisper } from "../services/local-whisper-aligner";

const [projectId, alignmentAudioPath] = process.argv
  .slice(2)
  .filter((value) => value !== "--" && value.length > 0);
const input = z
  .object({
    projectId: z.string().min(1),
    alignmentAudioPath: z.string().min(1).optional(),
  })
  .parse({
    projectId,
    alignmentAudioPath,
  });

const prisma = getPrisma();
const objectStore = new LocalObjectStore();
const project = await prisma.project.findUniqueOrThrow({
  where: { id: input.projectId },
  include: {
    scenes: {
      orderBy: { order: "asc" },
      include: { subtitleCues: { orderBy: { order: "asc" } } },
    },
    assets: {
      where: { kind: "NARRATION_MIX" },
      orderBy: { createdAt: "desc" },
    },
  },
});

const sceneIds = project.scenes.map((scene) => scene.id);
const narrationAsset = project.assets
  .map((asset) => ({
    asset,
    metadata: continuousNarrationAssetMetadataSchema.safeParse(asset.metadata),
  }))
  .find(
    ({ metadata }) =>
      metadata.success &&
      metadata.data.projectRevision === project.revision &&
      metadata.data.sceneIds.length === sceneIds.length &&
      metadata.data.sceneIds.every((sceneId, index) => sceneId === sceneIds[index]),
  );
if (!narrationAsset?.metadata.success) {
  throw new Error("CONTINUOUS_NARRATION_ASSET_REQUIRED");
}

const sceneTexts = project.scenes.map((scene) => voiceTextForScene(scene));
const alignmentAudio = input.alignmentAudioPath
  ? await readFile(input.alignmentAudioPath)
  : await objectStore.get(narrationAsset.asset.objectKey);
const actualCues = await alignNarrationWithLocalWhisper({
  audio: alignmentAudio,
  text: sceneTexts.join(""),
  sceneTexts,
  maximumErrorRate: 0.15,
});

let cueCursor = 0;
const cueGroups = project.scenes.map((scene, index) => {
  const cueCount = splitSubtitleText(sceneTexts[index] ?? "", null).length;
  const cueGroup = actualCues.slice(cueCursor, cueCursor + cueCount);
  if (cueGroup.length !== cueCount) {
    throw new Error(`ALIGNED_CUES_REQUIRED:${scene.order}`);
  }
  cueCursor += cueCount;
  return { scene, cues: cueGroup };
});
if (cueCursor !== actualCues.length) {
  throw new Error(`ALIGNED_CUE_COUNT_MISMATCH:${cueCursor}:${actualCues.length}`);
}

const totalDurationMs = narrationAsset.metadata.data.durationMs;
const boundaryStarts = cueGroups.map((group, index) =>
  index === 0
    ? 0
    : Math.min(
        totalDurationMs - 1,
        Math.max(0, Math.round(group.cues[0]!.startMs)),
      ),
);
const aligned = cueGroups.map((group, index) => {
  const boundaryStartMs = boundaryStarts[index]!;
  const boundaryEndMs =
    boundaryStarts[index + 1] === undefined
      ? totalDurationMs
      : boundaryStarts[index + 1]!;
  const durationMs = boundaryEndMs - boundaryStartMs;
  if (durationMs <= 0) {
    throw new Error(`SCENE_DURATION_INVALID:${group.scene.order}`);
  }

  const starts: number[] = [];
  for (const cue of group.cues) {
    const candidate = Math.min(
      durationMs - 1,
      Math.max(0, Math.round(cue.startMs - boundaryStartMs)),
    );
    starts.push(
      starts.length === 0
        ? candidate
        : Math.min(durationMs - 1, Math.max(starts.at(-1)! + 1, candidate)),
    );
  }
  const cues = group.cues.map((cue, cueIndex) => {
    const startMs = starts[cueIndex]!;
    return {
      startMs,
      endMs: Math.min(
        durationMs,
        Math.max(startMs + 1, starts[cueIndex + 1] ?? durationMs),
      ),
      text: cue.text,
    };
  });
  return { scene: group.scene, durationMs, cues };
});

const updatedNarrationMetadata = continuousNarrationAssetMetadataSchema.parse({
  ...narrationAsset.metadata.data,
  sceneDurationsMs: aligned.map((part) => part.durationMs),
});

await prisma.$transaction(async (tx) => {
  await tx.asset.update({
    where: { id: narrationAsset.asset.id },
    data: { metadata: updatedNarrationMetadata },
  });
  for (const part of aligned) {
    await tx.subtitleCue.deleteMany({ where: { sceneId: part.scene.id } });
    await tx.subtitleCue.createMany({
      data: part.cues.map((cue, order) => ({
        sceneId: part.scene.id,
        order,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        highlighted: [],
      })),
    });
    await tx.scene.update({
      where: { id: part.scene.id },
      data: { estimatedDuration: part.durationMs / 1_000 },
    });
  }
});

console.log(
  JSON.stringify({
    projectId: project.id,
    scenes: aligned.length,
    cueCount: cueCursor,
    alignmentSource: input.alignmentAudioPath ?? narrationAsset.asset.objectKey,
    samples: aligned
      .flatMap((part) =>
        part.cues.map((cue) => ({
          order: part.scene.order,
          startMs: cue.startMs,
          text: cue.text,
        })),
      )
      .filter(
        (cue) =>
          cue.text.includes("每次找人办事") ||
          (cue.order === 10 && cue.startMs < 5_000),
      ),
  }),
);
