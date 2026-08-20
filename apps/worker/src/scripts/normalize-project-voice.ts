import { getPrisma } from "@stickmotion/db";
import {
  capInternalSilencePcmWav,
  pcmWavLeadingSilenceMs,
  pcmWavTrailingSilenceMs,
  wavDurationMs,
  type SubtitleCueInput,
} from "@stickmotion/media";
import { LocalObjectStore } from "@stickmotion/storage";
import { z } from "zod";

import { normalizeSceneVoiceClip } from "../processors/voice";
import { normalizeCueTempoPcmWav } from "../services/voice-tempo-normalizer";

const [projectId, repairId] = process.argv
  .slice(2)
  .filter((value) => value !== "--");

const input = z
  .object({
    projectId: z.string().min(1),
    repairId: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
  })
  .parse({ projectId, repairId });

const prisma = getPrisma();
const objectStore = new LocalObjectStore();
const project = await prisma.project.findUniqueOrThrow({
  where: { id: input.projectId },
  include: {
    scenes: {
      orderBy: { order: "asc" },
      include: {
        voiceTracks: {
          where: { asset: { source: { not: "voice-timing-normalizer" } } },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { asset: true },
        },
        subtitleCues: { orderBy: { order: "asc" } },
      },
    },
  },
});

const repaired = await Promise.all(
  project.scenes.map(async (scene) => {
    const sourceTrack = scene.voiceTracks[0];
    if (!sourceTrack) throw new Error(`VOICE_TRACK_MISSING:${scene.order}`);
    const sourceAudio = await objectStore.get(sourceTrack.asset.objectKey);
    const sourceDurationMs = wavDurationMs(sourceAudio);
    if (!sourceDurationMs)
      throw new Error(`VOICE_AUDIO_INVALID:${scene.order}`);

    if (scene.subtitleCues.length === 0) {
      throw new Error(`VOICE_CUES_MISSING:${scene.order}`);
    }
    const sourceCues: SubtitleCueInput[] = scene.subtitleCues.map((cue) => ({
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
    const pauseRepairedAudio = capInternalSilencePcmWav(sourceAudio, {
      maximumPauseMs: 160,
      minimumGapMs: 180,
      crossfadeMs: 8,
    });
    // Keep the provider's cue-to-cue rhythm. Acoustic alignment is useful for
    // locating the first onset, but re-detecting every cue boundary can pull
    // adjacent subtitles onto the same onset and make a whole phrase sound
    // unnaturally fast. Shift the cue group once for provider pre-roll and
    // extend the final cue to the measured end of speech.
    const onsetMs = pcmWavLeadingSilenceMs(pauseRepairedAudio) ?? 0;
    const firstCueStartMs = sourceCues[0]?.startMs ?? 0;
    const onsetShiftMs = Math.max(0, onsetMs - firstCueStartMs);
    const pauseRepairedDurationMs = wavDurationMs(pauseRepairedAudio) ?? sourceDurationMs;
    const acousticEndMs = Math.max(
      0,
      pauseRepairedDurationMs - (pcmWavTrailingSilenceMs(pauseRepairedAudio) ?? 0),
    );
    const shiftedCues = sourceCues.map((cue, index) => ({
      ...cue,
      startMs: Math.min(
        pauseRepairedDurationMs - 1,
        Math.max(0, cue.startMs + onsetShiftMs),
      ),
      endMs: Math.min(
        pauseRepairedDurationMs,
        Math.max(
          cue.startMs + onsetShiftMs + 1,
          index === sourceCues.length - 1
            ? Math.max(cue.endMs + onsetShiftMs, acousticEndMs)
            : cue.endMs + onsetShiftMs,
        ),
      ),
    }));
    const tempoNormalized = await normalizeCueTempoPcmWav(
      pauseRepairedAudio,
      shiftedCues,
    );
    const normalized = normalizeSceneVoiceClip(
      tempoNormalized.audio,
      tempoNormalized.cues,
      scene.narration,
      { preserveAcousticTail: true },
    );
    const audio = normalized.audio;
    const durationMs = wavDurationMs(audio);
    if (!durationMs) throw new Error(`VOICE_AUDIO_INVALID:${scene.order}`);
    const objectKey =
      `projects/${project.id}/revisions/${project.revision}/` +
      `scenes/${scene.id}/voice-${input.repairId}.wav`;
    const stored = await objectStore.put(objectKey, audio, "audio/wav");
    return {
      scene,
      sourceTrack,
      stored,
      durationMs,
      sourceDurationMs,
      trimStartMs: normalized.trimStartMs,
      cues: normalized.cues,
    };
  }),
);

await prisma.$transaction(async (tx) => {
  for (const part of repaired) {
    await tx.voiceTrack.deleteMany({
      where: {
        sceneId: part.scene.id,
        asset: { source: "voice-timing-normalizer" },
      },
    });
    const asset = await tx.asset.create({
      data: {
        projectId: project.id,
        kind: "VOICE",
        bucket: part.stored.bucket,
        objectKey: part.stored.objectKey,
        contentType: "audio/wav",
        byteSize: BigInt(part.stored.byteSize),
        source: "voice-timing-normalizer",
        license: part.sourceTrack.asset.license,
        metadata: {
          repairId: input.repairId,
          sourceAssetId: part.sourceTrack.assetId,
          trimStartMs: part.trimStartMs,
        },
      },
    });
    await tx.voiceTrack.create({
      data: {
        sceneId: part.scene.id,
        assetId: asset.id,
        model: part.sourceTrack.model,
        voice: part.sourceTrack.voice,
        instructions: `${part.sourceTrack.instructions ?? ""};timing-normalized`,
        durationMs: part.durationMs,
        aiGenerated: part.sourceTrack.aiGenerated,
      },
    });
    await tx.subtitleCue.deleteMany({ where: { sceneId: part.scene.id } });
    await tx.subtitleCue.createMany({
      data: part.cues.map((cue, order) => ({
        sceneId: part.scene.id,
        order,
        startMs: Math.max(0, Math.round(cue.startMs)),
        endMs: Math.min(
          part.durationMs,
          Math.max(Math.round(cue.startMs) + 1, Math.round(cue.endMs)),
        ),
        text: cue.text,
        ...(cue.translation ? { translation: cue.translation } : {}),
        highlighted: cue.highlighted ?? [],
      })),
    });
    await tx.scene.update({
      where: { id: part.scene.id },
      data: { estimatedDuration: Math.max(0.1, part.durationMs / 1_000) },
    });
  }
});

const beforeMs = repaired.reduce((sum, part) => sum + part.sourceDurationMs, 0);
const afterMs = repaired.reduce((sum, part) => sum + part.durationMs, 0);
console.log(
  JSON.stringify({
    projectId: project.id,
    scenes: repaired.length,
    beforeMs,
    afterMs,
    removedMs: beforeMs - afterMs,
    averageTrimStartMs: Math.round(
      repaired.reduce((sum, part) => sum + part.trimStartMs, 0) /
        Math.max(1, repaired.length),
    ),
  }),
);
