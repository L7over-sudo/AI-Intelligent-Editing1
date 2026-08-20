import { readFile } from "node:fs/promises";

import { getPrisma } from "@stickmotion/db";
import { splitSubtitleText, type SubtitleCueInput } from "@stickmotion/media";
import { continuousNarrationAssetMetadataSchema } from "@stickmotion/shared";
import { z } from "zod";

import { voiceTextForScene } from "../processors/voice";
import { alignNarrationWithLocalWhisper } from "../services/local-whisper-aligner";
import { prepareStoredSubtitleCues } from "../services/subtitle-timing";

const [projectId, audioPath] = process.argv
  .slice(2)
  .filter((value) => value !== "--" && value.length > 0);
const input = z
  .object({ projectId: z.string().min(1), audioPath: z.string().min(1) })
  .parse({ projectId, audioPath });

const prisma = getPrisma();
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
const continuousAsset = project.assets
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
if (!continuousAsset?.metadata.success) {
  throw new Error("CONTINUOUS_NARRATION_ASSET_REQUIRED");
}

const sceneTexts = project.scenes.map((scene) => voiceTextForScene(scene));
const actualCues = await alignNarrationWithLocalWhisper({
  audio: await readFile(input.audioPath),
  text: sceneTexts.join(""),
  sceneTexts,
  maximumErrorRate: 0.15,
});

let globalCueIndex = 0;
let timelineMs = 0;
const rows: Array<{
  sceneOrder: number;
  cueOrder: number;
  text: string;
  displayedStartMs: number;
  actualStartMs: number;
  differenceMs: number;
}> = [];
for (const [sceneIndex, scene] of project.scenes.entries()) {
  const durationMs = continuousAsset.metadata.data.sceneDurationsMs[sceneIndex];
  if (!durationMs) throw new Error(`SCENE_DURATION_REQUIRED:${scene.order}`);
  const expectedCueCount = splitSubtitleText(sceneTexts[sceneIndex] ?? "", null).length;
  if (scene.subtitleCues.length !== expectedCueCount) {
    throw new Error(`STORED_CUE_COUNT_MISMATCH:${scene.order}`);
  }
  const storedCues: SubtitleCueInput[] = scene.subtitleCues.map((cue) => ({
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
    ...(cue.translation ? { translation: cue.translation } : {}),
    ...(Array.isArray(cue.highlighted)
      ? {
          highlighted: cue.highlighted.filter(
            (value): value is string => typeof value === "string",
          ),
        }
      : {}),
  }));
  const displayedCues = prepareStoredSubtitleCues(storedCues, durationMs);
  for (const [cueIndex, cue] of displayedCues.entries()) {
    const actualCue = actualCues[globalCueIndex];
    if (!actualCue) throw new Error(`ACTUAL_CUE_REQUIRED:${globalCueIndex}`);
    const displayedStartMs = timelineMs + cue.startMs;
    const actualStartMs = Math.round(actualCue.startMs);
    rows.push({
      sceneOrder: scene.order,
      cueOrder: cueIndex,
      text: cue.text,
      displayedStartMs,
      actualStartMs,
      differenceMs: displayedStartMs - actualStartMs,
    });
    globalCueIndex += 1;
  }
  timelineMs += durationMs;
}
if (globalCueIndex !== actualCues.length) {
  throw new Error(
    `ACTUAL_CUE_COUNT_MISMATCH:${globalCueIndex}:${actualCues.length}`,
  );
}

const differences = rows.map((row) => row.differenceMs).sort((a, b) => a - b);
const median = differences[Math.floor(differences.length / 2)] ?? 0;
console.log(
  JSON.stringify(
    {
      cueCount: rows.length,
      differenceMs: {
        minimum: differences[0] ?? 0,
        median,
        maximum: differences.at(-1) ?? 0,
      },
      earlyCues: rows.filter((row) => row.differenceMs < -40),
      samples: rows.filter(
        (row) =>
          row.text.includes("每次找人办事") ||
          (row.actualStartMs >= 37_000 && row.actualStartMs <= 41_000),
      ),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
