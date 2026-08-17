import { getPrisma } from "@stickmotion/db";
import {
  concatenatePcmWav,
  extendCueTails,
  extendFinalCueToDuration,
  interSceneNarrationPauseMs,
  splitSubtitleText,
  type SubtitleCueInput,
  wavDurationMs,
} from "@stickmotion/media";
import { LocalObjectStore } from "@stickmotion/storage";
import { z } from "zod";

import { forceAlignSubtitleCues } from "../services/forced-subtitle-alignment";
import {
  alignNarrationBatchesWithLocalWhisper,
  transcribeNarrationBatchesWithLocalWhisper,
} from "../services/local-whisper-aligner";

const input = z
  .object({ projectId: z.string().min(1) })
  .parse({ projectId: process.argv[2] });

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

interface PcmWavView {
  channels: number;
  sampleRate: number;
  blockAlign: number;
  dataOff: number;
  durationMs: number;
  rmsMs(startMs: number, endMs: number): number;
}

function parsePcmWavView(audio: Uint8Array): PcmWavView {
  const buffer = Buffer.from(audio);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const fmtOff = buffer.indexOf(Buffer.from("fmt ")) + 8;
  const channels = view.getUint16(fmtOff, true);
  const sampleRate = view.getUint32(fmtOff + 4, true);
  const blockAlign = view.getUint16(fmtOff + 12, true);
  const dataOff = buffer.indexOf(Buffer.from("data")) + 8;
  const totalFrames = Math.floor((buffer.length - dataOff) / blockAlign);
  return {
    channels,
    sampleRate,
    blockAlign,
    dataOff,
    durationMs: Math.round((totalFrames / sampleRate) * 1_000),
    rmsMs(startMs: number, endMs: number): number {
      let sum = 0;
      let count = 0;
      const start =
        Math.max(0, Math.round((sampleRate * startMs) / 1_000)) * channels;
      const end =
        Math.min(totalFrames, Math.round((sampleRate * endMs) / 1_000)) *
        channels;
      for (let index = start; index < end; index += channels) {
        const value = view.getInt16(dataOff + index * 2, true);
        sum += value * value;
        count += 1;
      }
      return count > 0 ? Math.sqrt(sum / count) : 0;
    },
  };
}

/**
 * Whisper consistently assigns the following word an early start because the
 * TTS pause gets absorbed into the word token. Instead of trusting the DTW
 * boundary or searching for the nearest energy transition, snap every
 * non-first cue forward to the end of the next real silence gap, which is
 * exactly where the next clause starts speaking.
 */
function snapCueStartsToSpeechOnsets(
  audio: Uint8Array,
  cues: readonly SubtitleCueInput[],
): SubtitleCueInput[] {
  const wav = parsePcmWavView(audio);
  const buffer = Buffer.from(audio);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const totalFrames = Math.floor((audio.byteLength - wav.dataOff) / wav.blockAlign);
  let sum = 0;
  let count = 0;
  for (let index = 0; index < totalFrames; index += wav.channels) {
    const value = view.getInt16(wav.dataOff + index * 2, true);
    sum += value * value;
    count += 1;
  }
  const overallRms = Math.sqrt(sum / Math.max(1, count));
  const quietThreshold = Math.max(90, overallRms * 0.055);
  const activeThreshold = Math.max(220, overallRms * 0.12);
  const windowMs = 20;
  const gaps: Array<{ startMs: number; endMs: number }> = [];
  let inGap = false;
  let gapStart = 0;
  for (let atMs = 0; atMs <= wav.durationMs; atMs += windowMs) {
    const quiet =
      wav.rmsMs(atMs, Math.min(wav.durationMs, atMs + windowMs)) <=
      quietThreshold;
    if (quiet && !inGap) {
      inGap = true;
      gapStart = atMs;
    } else if (!quiet && inGap) {
      inGap = false;
      if (atMs - gapStart >= 80) gaps.push({ startMs: gapStart, endMs: atMs });
    }
  }

  const leadingGap = gaps[0];
  let firstSustainedOnsetMs: number | undefined =
    leadingGap && leadingGap.startMs < 150 ? leadingGap.endMs : undefined;
  const firstSearchEndMs = Math.min(
    wav.durationMs - windowMs * 2,
    Math.max(800, (cues[0]?.startMs ?? 0) + 800),
  );
  if (firstSustainedOnsetMs === undefined) {
    for (let atMs = 0; atMs <= firstSearchEndMs; atMs += windowMs) {
      const activeOne = wav.rmsMs(atMs, atMs + windowMs);
      const activeTwo = wav.rmsMs(atMs + windowMs, atMs + windowMs * 2);
      if (activeOne >= activeThreshold && activeTwo >= activeThreshold) {
        firstSustainedOnsetMs = atMs;
        break;
      }
    }
  }

  return cues.map((cue, index) => {
    if (index === 0) {
      return {
        ...cue,
        startMs: Math.max(cue.startMs, firstSustainedOnsetMs ?? 0),
      };
    }
    const nextGap = gaps.find(
      (gap) =>
        gap.endMs >= cue.startMs - 20 && gap.startMs <= cue.startMs + 650,
    );
    if (!nextGap) return cue;
    return {
      ...cue,
      startMs: Math.max(cue.startMs, nextGap.endMs),
    };
  });
}

const sceneTexts = project.scenes.map((scene) => scene.narration.trim());
const parts = await Promise.all(
  project.scenes.map(async (scene) => {
    const track = scene.voiceTracks[0];
    if (!track?.asset) {
      throw new Error(`ALIGN_VOICE_TRACK_MISSING:${scene.order}`);
    }
    const audio = await objectStore.get(track.asset.objectKey);
    const durationMs = wavDurationMs(audio);
    if (!durationMs || durationMs <= 0) {
      throw new Error(`ALIGN_VOICE_INVALID:${scene.order}`);
    }
    return { scene, track, audio, durationMs };
  }),
);

// The alignment audio must match the render timeline exactly, including the
// punctuation pauses inserted between scenes, so Whisper times line up with
// the final narration track.
const sourceAudio = concatenatePcmWav(
  parts.map((part, index) => ({
    audio: part.audio,
    pauseAfterMs:
      index < parts.length - 1
        ? interSceneNarrationPauseMs(project.scenes[index]!.narration)
        : 0,
  })),
);

let alignedCues: SubtitleCueInput[];
try {
  const results = await alignNarrationBatchesWithLocalWhisper([
    {
      audio: sourceAudio,
      text: sceneTexts.join(""),
      sceneTexts,
      maximumErrorRate: 0.15,
    },
  ]);
  const first = results[0];
  if (!first) throw new Error("ALIGN_RESULT_REQUIRED");
  alignedCues = first;
} catch (fullDocumentError) {
  // A difficult full-document recognition may cross Whisper segment
  // boundaries. Fall back to isolated scenes, mirroring the render timeline
  // offsets.
  console.warn(
    `[align] full-document alignment failed, falling back per scene: ${
      fullDocumentError instanceof Error
        ? fullDocumentError.message
        : String(fullDocumentError)
    }`,
  );
  const transcriptions = await transcribeNarrationBatchesWithLocalWhisper(
    parts.map((part) => part.audio),
  );
  const fallbackCues: SubtitleCueInput[] = [];
  let offsetMs = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    try {
      const cues = forceAlignSubtitleCues(
        sceneTexts[index]!,
        transcriptions[index] ?? [],
        undefined,
        0.15,
      );
      fallbackCues.push(
        ...cues.map((cue) => ({
          ...cue,
          startMs: cue.startMs + offsetMs,
          endMs: cue.endMs + offsetMs,
        })),
      );
    } catch {
      // Keep the previous heuristic for this scene rather than failing all.
    }
    offsetMs +=
      part.durationMs +
      (index < parts.length - 1
        ? interSceneNarrationPauseMs(project.scenes[index]!.narration)
        : 0);
  }
  alignedCues = fallbackCues;
}

const cueGroups: SubtitleCueInput[][] = [];
let cueCursor = 0;
for (const sceneText of sceneTexts) {
  const cueCount = splitSubtitleText(sceneText, null).length;
  cueGroups.push(alignedCues.slice(cueCursor, cueCursor + cueCount));
  cueCursor += cueCount;
}
if (cueCursor !== alignedCues.length) {
  throw new Error("ALIGN_CUE_COUNT_MISMATCH");
}

const boundariesMs = [0];
for (let index = 1; index < cueGroups.length; index += 1) {
  const measured = cueGroups[index]?.[0]?.startMs;
  if (measured === undefined) throw new Error("ALIGN_BOUNDARY_MISSING");
  boundariesMs.push(Math.max(boundariesMs[index - 1]! + 1, measured));
}

const aligned = parts.map((part, index) => {
  const boundaryMs = boundariesMs[index]!;
  const measuredLocalCues = (cueGroups[index] ?? []).map((cue) => ({
    ...cue,
    startMs: Math.max(0, cue.startMs - boundaryMs),
    endMs: Math.min(part.durationMs, Math.max(1, cue.endMs - boundaryMs)),
  }));
  const alignedLocalCues = snapCueStartsToSpeechOnsets(
    part.audio,
    measuredLocalCues,
  );
  const delayedCues = alignedLocalCues.map((cue) => {
    const startMs = Math.min(
      part.durationMs - 1,
      Math.max(0, cue.startMs + 40),
    );
    return {
      ...cue,
      startMs,
      endMs: Math.min(
        part.durationMs,
        Math.max(startMs + 1, cue.endMs + 40),
      ),
    };
  });
  const sceneDurationMs =
    part.durationMs +
    (index < parts.length - 1
      ? interSceneNarrationPauseMs(project.scenes[index]!.narration)
      : 0);
  const cues = extendFinalCueToDuration(
    extendCueTails(delayedCues, part.durationMs),
    sceneDurationMs,
  );
  return { scene: part.scene, cues };
});

await prisma.$transaction(async (tx) => {
  for (const part of aligned) {
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
    projectId: project.id,
    alignedScenes: aligned.length,
    alignedCues: aligned.reduce((sum, part) => sum + part.cues.length, 0),
    firstSceneCues: aligned[0]?.cues.map((cue) => ({
      text: cue.text,
      startMs: cue.startMs,
      endMs: cue.endMs,
    })),
  }),
);
