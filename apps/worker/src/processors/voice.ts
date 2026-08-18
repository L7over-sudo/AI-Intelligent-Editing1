import type { LocalJob } from "@stickmotion/queue";

import { getPrisma } from "@stickmotion/db";
import {
  alignSubtitleCueStartsToPcmWav,
  alignTextToDuration,
  concatenatePcmWav,
  mutePcmWavBeforeMs,
  pcmWavTrailingSilenceMs,
  slicePcmWav,
  splitSubtitleText,
  wavDurationMs,
  type SubtitleCueInput,
} from "@stickmotion/media";
import {
  continuousNarrationAssetMetadataSchema,
  continuousVoiceGroupForScene,
  joinContinuousNarration,
  localVoiceServiceUrlSchema,
  voiceCloneReferenceMetadataSchema,
  voiceGenerationInputSchema,
  type VoiceGenerationInput,
} from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import {
  synthesizeIndexTTSAudio,
  type IndexTTSAudioRequest,
} from "../services/indextts-audio-provider";
import { alignNarrationWithLocalWhisper } from "../services/local-whisper-aligner";
import { createExactAudioPartitions } from "../services/voice-alignment-batches";
import { cleanVoiceReferenceAudio } from "../services/voice-reference-cleaner";
import { cleanVoiceOutputAudio } from "../services/voice-output-cleaner";

const OBJECT_KEY_SEGMENT = /^[a-zA-Z0-9_-]{1,100}$/u;

export interface VoiceSceneText {
  narration: string;
  subtitle: string;
}

export function voiceTextForScene(scene: VoiceSceneText): string {
  const text = (scene.narration.trim() || scene.subtitle.trim()).trim();
  if (!text) throw new Error("VOICE_TEXT_REQUIRED");
  return text;
}

export function voiceAudioObjectKey(
  projectId: string,
  sceneId: string,
  jobId: string,
): string {
  for (const segment of [projectId, sceneId, jobId]) {
    if (!OBJECT_KEY_SEGMENT.test(segment)) {
      throw new Error("VOICE_OBJECT_KEY_INVALID");
    }
  }
  return `projects/${projectId}/voice/${sceneId}-${jobId}.wav`;
}

export function resolveVoiceServiceUrl(
  metadataServiceUrl: string | undefined,
  environmentServiceUrl: string | undefined,
): string {
  const candidate = metadataServiceUrl?.trim() || environmentServiceUrl?.trim();
  if (!candidate) throw new Error("VOICE_PROVIDER_UNAVAILABLE");
  return localVoiceServiceUrlSchema.parse(candidate);
}

export function voiceSubtitleCues(
  subtitle: string,
  durationMs: number,
): Array<{
  order: number;
  startMs: number;
  endMs: number;
  text: string;
  highlighted: string[];
}> {
  return alignTextToDuration(subtitle, durationMs, null).map((cue, order) => ({
    order,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
    highlighted: [],
  }));
}

export function finalizeSceneSubtitleCues(
  cues: readonly SubtitleCueInput[],
  boundaryStartMs: number,
  durationMs: number,
): Array<{ startMs: number; endMs: number; text: string }> {
  return cues
    .map((cue) => {
      const startMs = Math.max(0, Math.round(cue.startMs - boundaryStartMs));
      const endMs = Math.min(
        durationMs,
        Math.max(startMs + 1, Math.round(cue.endMs - boundaryStartMs)),
      );
      return { startMs, endMs, text: cue.text };
    })
    .filter((cue) => cue.endMs > cue.startMs && cue.startMs < durationMs);
}

export function capWavTrailingSilence(
  audio: Uint8Array,
  maximumTailMs = 220,
): Uint8Array {
  const durationMs = wavDurationMs(audio);
  if (!durationMs || durationMs <= 0) {
    throw new Error("INDEXTTS_AUDIO_INVALID");
  }
  const trailingMs = pcmWavTrailingSilenceMs(audio) ?? 0;
  if (trailingMs <= maximumTailMs) return audio;
  const endMs = Math.max(1, durationMs - (trailingMs - maximumTailMs));
  return slicePcmWav(audio, 0, endMs);
}

const sceneSentenceEndPattern = /[。！？!?…][”’"'）)\]】》〉]*$/u;

/**
 * The audible pause before the next scene must never make sentence endings
 * shorter than comma clause breaks: sentence ends keep a longer tail than
 * comma/no-punctuation endings.
 */
export function maximumSceneTrailingSilenceMs(narration: string): number {
  return sceneSentenceEndPattern.test(narration.trim()) ? 160 : 140;
}

export interface VoicePartitionBoundary {
  startMs: number;
  endMs: number;
}

export function proportionalSceneDurationsMs(
  sceneTexts: readonly string[],
  totalDurationMs: number,
): number[] {
  if (sceneTexts.length === 0 || totalDurationMs <= 0) {
    throw new Error("VOICE_PARTITION_INVALID");
  }
  const counts = sceneTexts.map((text) =>
    Math.max(1, Array.from(text.trim()).length),
  );
  const sum = counts.reduce((total, count) => total + count, 0);
  const raw = counts.map((count) => (totalDurationMs * count) / sum);
  const base = raw.map((value) => Math.floor(value));
  const fractions = raw.map((value) => value - Math.floor(value));
  const order = fractions
    .map((fraction, index) => ({ fraction, index }))
    .sort((left, right) => right.fraction - left.fraction);
  const durations = [...base];
  let remainderMs = totalDurationMs - base.reduce((a, b) => a + b, 0);
  for (const { index } of order) {
    if (remainderMs <= 0) break;
    durations[index] = (durations[index] ?? 0) + 1;
    remainderMs -= 1;
  }
  return durations.map((duration) => Math.max(1, duration));
}

export function sceneBoundariesFromCueStarts(
  cueStarts: readonly (readonly number[])[],
  totalDurationMs: number,
): VoicePartitionBoundary[] {
  const firstStarts = cueStarts.map((starts) => starts[0]);
  return cueStarts.map((_, index) => {
    // The first scene always owns the timeline head, including any leading
    // silence in the master audio; later scenes start at their own speech
    // onset so subtitles never lead the voice.
    const startMs =
      index === 0 ? 0 : Math.max(0, Math.round(firstStarts[index] ?? 0));
    const endMs =
      index < cueStarts.length - 1
        ? Math.min(
            totalDurationMs,
            Math.max(
              startMs + 1,
              Math.round(firstStarts[index + 1] ?? totalDurationMs),
            ),
          )
        : totalDurationMs;
    if (endMs <= startMs) throw new Error("VOICE_PARTITION_EMPTY");
    return { startMs, endMs };
  });
}

interface ContinuousPartition {
  mode: "whisper" | "fallback";
  boundaries: VoicePartitionBoundary[];
  cueGroups?: SubtitleCueInput[][];
}

export async function partitionContinuousVoice(
  audio: Uint8Array,
  sceneTexts: readonly string[],
  align: (input: {
    audio: Uint8Array;
    text: string;
    sceneTexts: readonly string[];
  }) => SubtitleCueInput[] | Promise<SubtitleCueInput[]>,
): Promise<ContinuousPartition> {
  const durationMs = wavDurationMs(audio);
  if (!durationMs || durationMs <= 0) {
    throw new Error("INDEXTTS_AUDIO_INVALID");
  }
  try {
    const rawCues = await align({
      audio,
      text: sceneTexts.join(""),
      sceneTexts,
    });
    const cues = alignSubtitleCueStartsToPcmWav(audio, rawCues, {
      firstSearchRadiusMs: 800,
      firstCueStrategy: "acoustic",
    });
    const cueGroups: SubtitleCueInput[][] = [];
    let cursor = 0;
    for (const sceneText of sceneTexts) {
      const cueCount = splitSubtitleText(sceneText, null).length;
      cueGroups.push(cues.slice(cursor, cursor + cueCount));
      cursor += cueCount;
    }
    if (
      cursor !== cues.length ||
      cueGroups.some((group) => group.length === 0)
    ) {
      throw new Error("ALIGN_CUE_COUNT_MISMATCH");
    }
    const boundaries = sceneBoundariesFromCueStarts(
      cueGroups.map((group) => group.map((cue) => cue.startMs)),
      durationMs,
    );
    return { mode: "whisper", boundaries, cueGroups };
  } catch {
    const durations = proportionalSceneDurationsMs(sceneTexts, durationMs);
    const boundaries = createExactAudioPartitions(durations).map(
      (partition) => ({
        startMs: partition.startMs,
        endMs: partition.endMs,
      }),
    );
    return { mode: "fallback", boundaries };
  }
}

export interface VoiceProcessorDependencies {
  synthesize?: (request: IndexTTSAudioRequest) => Promise<Uint8Array>;
  cleanOutput?: (audio: Uint8Array) => Promise<Uint8Array>;
  align?: (input: {
    audio: Uint8Array;
    text: string;
    sceneTexts: readonly string[];
  }) => SubtitleCueInput[] | Promise<SubtitleCueInput[]>;
  objectStore?: LocalObjectStore;
}

export function createVoiceProcessor(
  dependencies: VoiceProcessorDependencies = {},
) {
  const synthesize = dependencies.synthesize ?? synthesizeIndexTTSAudio;
  const cleanOutput = dependencies.cleanOutput ?? cleanVoiceOutputAudio;
  const align =
    dependencies.align ??
    ((input: {
      audio: Uint8Array;
      text: string;
      sceneTexts: readonly string[];
    }) =>
      alignNarrationWithLocalWhisper({
        audio: input.audio,
        text: input.text,
        sceneTexts: input.sceneTexts,
        maximumErrorRate: 0.15,
      }));
  const objectStore = dependencies.objectStore ?? new LocalObjectStore();

  return async function processVoiceJob(
    localJob: LocalJob<VoiceGenerationInput>,
  ): Promise<{ audioObjectKey: string }> {
    const input = voiceGenerationInputSchema.parse(localJob.data);
    const prisma = getPrisma();

    const started = await prisma.generationJob.updateMany({
      where: { id: input.jobId, status: "RUNNING" },
      data: {
        startedAt: new Date(),
        progress: 5,
      },
    });
    if (started.count !== 1) {
      throw new Error("VOICE_JOB_NOT_RUNNING");
    }
    await prisma.jobEvent.create({
      data: {
        jobId: input.jobId,
        status: "RUNNING",
        progress: 5,
        code: "VOICE_STARTED",
      },
    });

    try {
      const scene = await prisma.scene.findUniqueOrThrow({
        where: { id: input.sceneId },
        include: {
          project: {
            include: {
              scenes: { orderBy: { order: "asc" } },
              voiceProfile: { include: { asset: true } },
            },
          },
        },
      });
      if (
        scene.projectId !== input.projectId ||
        scene.project.revision !== input.projectRevision
      ) {
        throw new Error("PROJECT_REVISION_STALE");
      }
      const project = scene.project;
      const voiceProfile = project.voiceProfile;
      if (project.voiceStyle !== "indextts2" || !voiceProfile?.asset) {
        throw new Error("VOICE_PROVIDER_UNAVAILABLE");
      }
      const referenceMetadata = voiceCloneReferenceMetadataSchema.parse(
        voiceProfile.asset.metadata,
      );
      const serviceUrl = resolveVoiceServiceUrl(
        referenceMetadata.serviceUrl,
        process.env.INDEXTTS_SERVICE_URL,
      );
      const referenceAudio = await cleanVoiceReferenceAudio(
        await objectStore.get(voiceProfile.asset.objectKey),
      );

      const groupScenes = continuousVoiceGroupForScene(
        project.scenes,
        scene.id,
      );
      const narration =
        groupScenes.length > 1
          ? joinContinuousNarration(groupScenes)
          : voiceTextForScene(scene);

      await prisma.generationJob.update({
        where: { id: input.jobId },
        data: {
          progress: 25,
          events: {
            create: {
              status: "RUNNING",
              progress: 25,
              code: "VOICE_SYNTHESIZING",
            },
          },
        },
      });
      const synthesizedAudio = await synthesize({
        serviceUrl,
        text: narration,
        referenceAudio,
      });
      const audio = await cleanOutput(synthesizedAudio);
      const durationMs = wavDurationMs(audio);
      if (!durationMs || durationMs < 100) {
        throw new Error("INDEXTTS_AUDIO_INVALID");
      }

      let partition: ContinuousPartition;
      if (groupScenes.length > 1) {
        await prisma.generationJob.update({
          where: { id: input.jobId },
          data: {
            progress: 55,
            events: {
              create: {
                status: "RUNNING",
                progress: 55,
                code: "VOICE_ALIGNING",
              },
            },
          },
        });
        partition = await partitionContinuousVoice(
          audio,
          groupScenes.map((groupScene) => groupScene.narration.trim()),
          align,
        );
      } else {
        partition = {
          mode: "fallback",
          boundaries: [{ startMs: 0, endMs: durationMs }],
        };
      }

      const rawSlices = groupScenes.map((groupScene, index) => {
        const boundary = partition.boundaries[index]!;
        const rawClip = slicePcmWav(audio, boundary.startMs, boundary.endMs);
        // Keep the clip's internal timeline intact. Removing a quiet gap here
        // without applying the same edit to Whisper cue timestamps makes every
        // following subtitle drift later than its spoken word. Only the
        // trailing tail is capped below; it cannot shift any cue start.
        const clip = capWavTrailingSilence(
          rawClip,
          maximumSceneTrailingSilenceMs(groupScene.narration),
        );
        return {
          scene: groupScene,
          clip,
          durationMs: wavDurationMs(clip) ?? boundary.endMs - boundary.startMs,
          objectKey: voiceAudioObjectKey(
            input.projectId,
            groupScene.id,
            input.jobId,
          ),
          boundary,
        };
      });
      // Whisper fallback can still identify a real speech onset while the
      // provider output begins with a short click/buzz. Mute only that head;
      // duration and all later subtitle timestamps stay unchanged.
      const slices = rawSlices.map((slice, index) => {
        let sourceCues: SubtitleCueInput[];
        if (partition.mode === "whisper" && partition.cueGroups?.[index]) {
          sourceCues = partition.cueGroups[index].map((cue) => ({
            ...cue,
            startMs: Math.max(0, cue.startMs - slice.boundary.startMs),
            endMs: Math.max(
              Math.max(1, cue.startMs - slice.boundary.startMs + 1),
              cue.endMs - slice.boundary.startMs,
            ),
          }));
        } else {
          sourceCues = voiceSubtitleCues(
            slice.scene.subtitle,
            slice.durationMs,
          );
        }
        const snappedCues = alignSubtitleCueStartsToPcmWav(
          slice.clip,
          sourceCues,
          { firstSearchRadiusMs: 800, firstCueStrategy: "acoustic" },
        );
        const firstCueStartMs = snappedCues[0]?.startMs ?? 0;
        const clip = mutePcmWavBeforeMs(
          slice.clip,
          Math.max(0, firstCueStartMs - 20),
        );
        return {
          ...slice,
          clip,
          durationMs: wavDurationMs(clip) ?? slice.durationMs,
        };
      });
      const coversAllScenes =
        groupScenes.length === project.scenes.length &&
        groupScenes.every(
          (groupScene, index) => groupScene.id === project.scenes[index]?.id,
        );
      const masterObjectKey = coversAllScenes
        ? `projects/${input.projectId}/voice/${input.jobId}-continuous.wav`
        : undefined;
      const masterDurationMs = slices.reduce(
        (sum, slice) => sum + slice.durationMs,
        0,
      );
      const masterAudio = masterObjectKey
        ? concatenatePcmWav(
            slices.map((slice) => ({ audio: slice.clip, pauseAfterMs: 0 })),
          )
        : undefined;

      await Promise.all(
        slices.map((slice) =>
          objectStore.put(slice.objectKey, slice.clip, "audio/wav"),
        ),
      );
      if (masterObjectKey && masterAudio) {
        await objectStore.put(masterObjectKey, masterAudio, "audio/wav");
      }
      await prisma.generationJob.update({
        where: { id: input.jobId },
        data: {
          progress: 80,
          events: {
            create: {
              status: "RUNNING",
              progress: 80,
              code: "VOICE_SAVING",
            },
          },
        },
      });

      await prisma.$transaction(async (tx) => {
        const current = await tx.scene.findUniqueOrThrow({
          where: { id: scene.id },
          select: { project: { select: { revision: true } } },
        });
        if (current.project.revision !== input.projectRevision) {
          throw new Error("PROJECT_REVISION_STALE");
        }
        if (masterObjectKey) {
          await tx.asset.deleteMany({
            where: { projectId: input.projectId, kind: "NARRATION_MIX" },
          });
        }
        for (const [index, slice] of slices.entries()) {
          await tx.voiceTrack.deleteMany({
            where: { sceneId: slice.scene.id },
          });
          await tx.subtitleCue.deleteMany({
            where: { sceneId: slice.scene.id },
          });
          const asset = await tx.asset.create({
            data: {
              projectId: input.projectId,
              kind: "VOICE",
              bucket: "local",
              objectKey: slice.objectKey,
              contentType: "audio/wav",
              byteSize: BigInt(slice.clip.byteLength),
              source: "indextts2",
              metadata: {
                provider: "indextts2",
                model: "IndexTTS-2",
                sceneId: slice.scene.id,
                jobId: input.jobId,
              },
            },
          });
          await tx.voiceTrack.create({
            data: {
              sceneId: slice.scene.id,
              assetId: asset.id,
              model: "IndexTTS-2",
              voice: voiceProfile.name,
              durationMs: slice.durationMs,
              aiGenerated: true,
            },
          });
          if (!project.includeSubtitles) continue;
          let sourceCues: SubtitleCueInput[];
          if (partition.mode === "whisper" && partition.cueGroups?.[index]) {
            sourceCues = partition.cueGroups[index].map((cue) => ({
              ...cue,
              startMs: Math.max(0, cue.startMs - slice.boundary.startMs),
              endMs: Math.max(
                Math.max(1, cue.startMs - slice.boundary.startMs + 1),
                cue.endMs - slice.boundary.startMs,
              ),
            }));
          } else {
            sourceCues = voiceSubtitleCues(
              slice.scene.subtitle,
              slice.durationMs,
            );
          }
          // Re-snap against the exact scene clip that is stored. Global
          // Whisper timestamps can miss a noisy/pre-roll onset at a scene
          // boundary; using the final clip here keeps DB cues and WAV samples
          // on one timeline for both continuous and single-scene synthesis.
          const snappedCues = alignSubtitleCueStartsToPcmWav(
            slice.clip,
            sourceCues,
            { firstSearchRadiusMs: 800, firstCueStrategy: "acoustic" },
          );
          const cues = finalizeSceneSubtitleCues(
            snappedCues,
            0,
            slice.durationMs,
          );
          if (cues.length > 0) {
            await tx.subtitleCue.createMany({
              data: cues.map((cue, order) => ({
                sceneId: slice.scene.id,
                order,
                startMs: cue.startMs,
                endMs: cue.endMs,
                text: cue.text,
                highlighted: [],
              })),
            });
          }
        }
        if (masterObjectKey) {
          await tx.asset.create({
            data: {
              projectId: input.projectId,
              kind: "NARRATION_MIX",
              bucket: "local",
              objectKey: masterObjectKey,
              contentType: "audio/wav",
              byteSize: BigInt(audio.byteLength),
              source: "indextts2",
              metadata: continuousNarrationAssetMetadataSchema.parse({
                assetRole: "CONTINUOUS_NARRATION",
                projectRevision: input.projectRevision,
                sceneIds: project.scenes.map((projectScene) => projectScene.id),
                sceneDurationsMs: slices.map((slice) => slice.durationMs),
                durationMs: masterDurationMs,
                voiceGenerationJobId: input.jobId,
              }),
            },
          });
        }
      });

      await prisma.generationJob.update({
        where: { id: input.jobId },
        data: {
          status: "SUCCEEDED",
          progress: 100,
          finishedAt: new Date(),
          output: {
            audioObjectKey: masterObjectKey ?? slices[0]?.objectKey,
            durationMs: masterObjectKey ? masterDurationMs : durationMs,
            sceneCount: slices.length,
          },
          events: {
            create: {
              status: "SUCCEEDED",
              progress: 100,
              code: "VOICE_SUCCEEDED",
            },
          },
        },
      });
      return { audioObjectKey: masterObjectKey ?? slices[0]!.objectKey };
    } catch (error) {
      await prisma.generationJob.updateMany({
        where: { id: input.jobId, status: "RUNNING" },
        data: {
          status: "FAILED",
          errorCode: "VOICE_GENERATION_FAILED",
          errorMessage: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 2_000),
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  };
}
