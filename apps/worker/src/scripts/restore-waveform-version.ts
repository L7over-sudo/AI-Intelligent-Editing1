import { getPrisma } from "@stickmotion/db";
import {
  alignSubtitleCueStartsToPcmWav,
  concatenatePcmWav,
  extendCueTails,
  extendFinalCueToDuration,
  splitSubtitleText,
  type SubtitleCueInput,
  wavDurationMs,
} from "@stickmotion/media";
import { LocalObjectStore } from "@stickmotion/storage";
import { z } from "zod";

import { alignNarrationWithLocalWhisper } from "../services/local-whisper-aligner";

const input = z
  .object({
    projectId: z.string().min(1),
    sourceJobId: z.string().min(1),
    targetTag: z.string().min(1),
  })
  .parse({
    projectId: process.argv[2],
    sourceJobId: process.argv[3],
    targetTag: process.argv[4],
  });

const prisma = getPrisma();
const objectStore = new LocalObjectStore();
const project = await prisma.project.findUniqueOrThrow({
  where: { id: input.projectId },
  include: {
    scenes: {
      orderBy: { order: "asc" },
      include: {
        voiceTracks: {
          orderBy: { createdAt: "desc" },
          include: { asset: true },
        },
      },
    },
  },
});

const sceneTexts = project.scenes.map((scene) => scene.narration.trim());
const sourceParts = await Promise.all(
  project.scenes.map(async (scene) => {
    const track = scene.voiceTracks.find((candidate) =>
      candidate.asset.objectKey.includes(input.sourceJobId),
    );
    if (!track) throw new Error(`RESTORE_SOURCE_MISSING:${scene.order}`);
    return objectStore.get(track.asset.objectKey);
  }),
);
const sourceAudio = concatenatePcmWav(
  sourceParts.map((audio) => ({ audio, pauseAfterMs: 0 })),
);
const alignedCues = await alignNarrationWithLocalWhisper({
  audio: sourceAudio,
  text: sceneTexts.join(""),
  sceneTexts,
  maximumErrorRate: 0.15,
});
const cueGroups: SubtitleCueInput[][] = [];
let cueCursor = 0;
for (const sceneText of sceneTexts) {
  const cueCount = splitSubtitleText(sceneText, null).length;
  cueGroups.push(alignedCues.slice(cueCursor, cueCursor + cueCount));
  cueCursor += cueCount;
}
if (cueCursor !== alignedCues.length) throw new Error("RESTORE_CUE_COUNT_MISMATCH");

const boundariesMs = [0];
for (let index = 1; index < cueGroups.length; index += 1) {
  const measured = cueGroups[index]?.[0]?.startMs;
  if (measured === undefined) throw new Error("RESTORE_BOUNDARY_MISSING");
  boundariesMs.push(Math.max(boundariesMs[index - 1]! + 1, measured));
}

const restored = await Promise.all(
  project.scenes.map(async (scene, index) => {
    const targetTrack = scene.voiceTracks.find((candidate) =>
      candidate.asset.objectKey.includes(input.targetTag),
    );
    if (!targetTrack) throw new Error(`RESTORE_TARGET_MISSING:${scene.order}`);
    const audio = await objectStore.get(targetTrack.asset.objectKey);
    const durationMs = wavDurationMs(audio);
    if (!durationMs) throw new Error(`RESTORE_TARGET_INVALID:${scene.order}`);
    const boundaryMs = boundariesMs[index]!;
    const measuredLocalCues = (cueGroups[index] ?? []).map((cue) => ({
      ...cue,
      startMs: Math.max(0, cue.startMs - boundaryMs),
      endMs: Math.min(
        durationMs,
        Math.max(1, cue.endMs - boundaryMs),
      ),
    }));
    const alignedLocalCues = alignSubtitleCueStartsToPcmWav(
      audio,
      measuredLocalCues,
      { firstSearchRadiusMs: 800 },
    );
    const delayedCues = alignedLocalCues.map((cue) => {
      const startMs = Math.min(durationMs - 1, Math.max(0, cue.startMs + 40));
      return {
        ...cue,
        startMs,
        endMs: Math.min(
          durationMs,
          Math.max(startMs + 1, cue.endMs + 40),
        ),
      };
    });
    const cues = extendFinalCueToDuration(
      extendCueTails(delayedCues, durationMs),
      durationMs,
    );
    return { scene, targetTrack, durationMs, cues };
  }),
);

await prisma.$transaction(async (tx) => {
  for (const part of restored) {
    await tx.voiceTrack.create({
      data: {
        sceneId: part.scene.id,
        assetId: part.targetTrack.assetId,
        model: part.targetTrack.model,
        voice: part.targetTrack.voice,
        instructions: `${part.targetTrack.instructions ?? ""};restored`,
        durationMs: part.durationMs,
        aiGenerated: part.targetTrack.aiGenerated,
      },
    });
    await tx.scene.update({
      where: { id: part.scene.id },
      data: { estimatedDuration: Math.max(0.1, part.durationMs / 1_000) },
    });
    await tx.subtitleCue.deleteMany({ where: { sceneId: part.scene.id } });
    await tx.subtitleCue.createMany({
      data: part.cues.map((cue, order) => ({
        sceneId: part.scene.id,
        order,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        translation: cue.translation ?? null,
        highlighted: cue.highlighted ?? [],
      })),
    });
  }
});

console.log(
  JSON.stringify({
    restoredScenes: restored.length,
    restoredCues: restored.reduce((sum, part) => sum + part.cues.length, 0),
    durationMs: restored.reduce((sum, part) => sum + part.durationMs, 0),
  }),
);
