import { getPrisma } from "@stickmotion/db";
import {
  alignSubtitleCueStartsToPcmWav,
  concatenatePcmWav,
  ensureMinimumTrailingSilencePcmWav,
  extendCueTails,
  extendFinalCueToDuration,
  fadeInPcmWav,
  fadeOutPcmWav,
  findQuietestPcmWavPointMs,
  pcmWavOverallRms,
  pcmWavTailRms,
  pcmWavTrailingSilenceMs,
  slicePcmWav,
  splitSubtitleText,
  type SubtitleCueInput,
  wavDurationMs,
} from "@stickmotion/media";
import { LocalObjectStore } from "@stickmotion/storage";
import { z } from "zod";

import { alignNarrationWithLocalWhisper } from "../services/local-whisper-aligner";

const inputSchema = z.object({
  projectId: z.string().min(1),
  sourceJobId: z.string().min(1),
  repairId: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
});

const input = inputSchema.parse({
  projectId: process.argv[2],
  sourceJobId: process.argv[3],
  repairId: process.argv[4],
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
          include: { asset: true },
          orderBy: { createdAt: "desc" },
        },
      },
    },
  },
});

const parts = await Promise.all(
  project.scenes.map(async (scene) => {
    const sourceTrack = scene.voiceTracks.find((track) =>
      track.asset.objectKey.includes(input.sourceJobId),
    );
    if (!sourceTrack) throw new Error(`PREFERRED_VOICE_MISSING:${scene.order}`);
    return {
      scene,
      sourceTrack,
      audio: await objectStore.get(sourceTrack.asset.objectKey),
      cues: [] as SubtitleCueInput[],
    };
  }),
);

const sourceAudio = concatenatePcmWav(
  parts.map((part) => ({ audio: part.audio, pauseAfterMs: 0 })),
);
const sourceDurationMs = wavDurationMs(sourceAudio);
if (!sourceDurationMs) throw new Error("PREFERRED_VOICE_INVALID");
const sceneTexts = parts.map((part) => part.scene.narration.trim());
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
if (cueCursor !== alignedCues.length) {
  throw new Error("PREFERRED_VOICE_CUE_COUNT_MISMATCH");
}

const boundariesMs = [0];
const boundaryRmsRatios: number[] = [];
for (let index = 1; index < cueGroups.length; index += 1) {
  const previous = boundariesMs[index - 1]!;
  const nextStartMs = cueGroups[index]?.[0]?.startMs;
  if (nextStartMs === undefined) {
    throw new Error("PREFERRED_VOICE_BOUNDARY_MISSING");
  }
  let measured = nextStartMs;
  const previousEndMs = cueGroups[index - 1]?.at(-1)?.endMs;
  if (previousEndMs === undefined) {
    throw new Error("PREFERRED_VOICE_BOUNDARY_MISSING");
  }
  if (
    /[\u3002\uFF01\uFF1F.!?]$/u.test(
      parts[index - 1]!.scene.narration.trim(),
    )
  ) {
    const quietest = findQuietestPcmWavPointMs(
      sourceAudio,
      Math.max(previous + 1, Math.min(previousEndMs, nextStartMs) - 120),
      Math.min(
        sourceDurationMs - 1,
        Math.max(previousEndMs, nextStartMs) + 120,
      ),
    );
    if (quietest) {
      measured = quietest.pointMs;
      boundaryRmsRatios[index - 1] =
        quietest.rms / Math.max(1, quietest.overallRms);
    }
  }
  boundariesMs.push(Math.min(sourceDurationMs - 1, Math.max(previous + 1, measured)));
}
boundariesMs.push(sourceDurationMs);

for (let index = 0; index < parts.length; index += 1) {
  const part = parts[index]!;
  const startMs = boundariesMs[index]!;
  const endMs = boundariesMs[index + 1]!;
  part.audio = slicePcmWav(sourceAudio, startMs, endMs);
  const rawDurationMs = wavDurationMs(part.audio) ?? endMs - startMs;
  const localMeasuredCues = (cueGroups[index] ?? []).map((cue) => ({
    ...cue,
    startMs: Math.max(0, cue.startMs - startMs),
    endMs: Math.min(
      rawDurationMs,
      Math.max(1, cue.endMs - startMs),
    ),
  }));
  const acousticallyAlignedCues = alignSubtitleCueStartsToPcmWav(
    part.audio,
    localMeasuredCues,
    { firstSearchRadiusMs: 800, firstCueStrategy: "acoustic" },
  );
  part.cues = acousticallyAlignedCues.map((cue) => {
    const cueStartMs = Math.min(
      rawDurationMs - 1,
      Math.max(0, cue.startMs + 40),
    );
    return {
      ...cue,
      startMs: cueStartMs,
      endMs: Math.min(
        rawDurationMs,
        Math.max(cueStartMs + 1, cue.endMs + 40),
      ),
    };
  });
}

let repairedBoundaries = 0;
let fadedBoundaries = 0;
const insertionRmsRatios: number[] = [];
for (let index = 0; index < parts.length; index += 1) {
  const part = parts[index]!;
  if (!/[\u3002\uFF01\uFF1F.!?]$/u.test(part.scene.narration.trim())) {
    continue;
  }
  if ((pcmWavTrailingSilenceMs(part.audio) ?? 120) >= 110) continue;
  const next = parts[index + 1];
  const insertionRmsRatio =
    (pcmWavTailRms(part.audio, 20) ?? 0) /
    Math.max(1, pcmWavOverallRms(part.audio) ?? 0);
  insertionRmsRatios.push(insertionRmsRatio);
  if (next) {
    part.audio = fadeOutPcmWav(part.audio, 12);
    next.audio = fadeInPcmWav(next.audio, 12);
    fadedBoundaries += 1;
  }
  part.audio = ensureMinimumTrailingSilencePcmWav(part.audio, 120);
  repairedBoundaries += 1;
}

const stored = await Promise.all(
  parts.map(async (part) => {
    const durationMs = wavDurationMs(part.audio);
    if (!durationMs) throw new Error(`PREFERRED_VOICE_INVALID:${part.scene.order}`);
    const cues = extendFinalCueToDuration(
      extendCueTails(part.cues, durationMs),
      durationMs,
    );
    const objectKey =
      `projects/${project.id}/revisions/${project.revision}/` +
      `scenes/${part.scene.id}/voice-${input.repairId}.wav`;
    const storedAudio = await objectStore.put(objectKey, part.audio, "audio/wav");
    return { ...part, cues, durationMs, storedAudio };
  }),
);

await prisma.$transaction(async (tx) => {
  for (const part of stored) {
    const asset = await tx.asset.upsert({
      where: {
        bucket_objectKey: {
          bucket: part.storedAudio.bucket,
          objectKey: part.storedAudio.objectKey,
        },
      },
      update: { byteSize: part.storedAudio.byteSize },
      create: {
        projectId: project.id,
        kind: "VOICE",
        bucket: part.storedAudio.bucket,
        objectKey: part.storedAudio.objectKey,
        byteSize: part.storedAudio.byteSize,
        contentType: "audio/wav",
        source: "preferred-voice-boundary-repair",
        license: part.sourceTrack.asset.license,
      },
    });
    await tx.voiceTrack.create({
      data: {
        sceneId: part.scene.id,
        assetId: asset.id,
        model: part.sourceTrack.model,
        voice: part.sourceTrack.voice,
        instructions: `${part.sourceTrack.instructions ?? ""};boundary-repaired`,
        durationMs: part.durationMs,
        aiGenerated: part.sourceTrack.aiGenerated,
      },
    });
    await tx.scene.update({
      where: { id: part.scene.id },
      data: { estimatedDuration: Math.max(0.1, part.durationMs / 1_000) },
    });
    await tx.subtitleCue.deleteMany({ where: { sceneId: part.scene.id } });
    if (part.cues.length > 0) {
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
  }
});

const totalDurationMs = stored.reduce((sum, part) => sum + part.durationMs, 0);
console.log(
  JSON.stringify({
    repairedBoundaries,
    fadedBoundaries,
    maximumBoundaryRmsRatio: Math.max(0, ...boundaryRmsRatios.filter(Number.isFinite)),
    maximumInsertionRmsRatio: Math.max(0, ...insertionRmsRatios),
    scenes: stored.length,
    cues: stored.reduce((sum, part) => sum + part.cues.length, 0),
    totalDurationMs,
  }),
);
