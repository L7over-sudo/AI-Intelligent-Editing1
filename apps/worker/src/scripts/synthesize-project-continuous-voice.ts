import { getPrisma } from "@stickmotion/db";
import {
  alignSubtitleCueStartsToPcmWav,
  concatenatePcmWav,
  slicePcmWav,
  splitSubtitleText,
  wavDurationMs,
  type SubtitleCueInput,
} from "@stickmotion/media";
import {
  continuousNarrationAssetMetadataSchema,
  groupScenesForContinuousVoice,
  joinContinuousNarration,
  voiceCloneReferenceMetadataSchema,
} from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";
import { z } from "zod";

import {
  capWavTrailingSilence,
  finalizeSceneSubtitleCues,
  partitionContinuousVoice,
  resolveVoiceServiceUrl,
  voiceTextForScene,
} from "../processors/voice";
import { alignNarrationWithLocalWhisper } from "../services/local-whisper-aligner";
import { cleanVoiceOutputAudio } from "../services/voice-output-cleaner";
import { cleanVoiceReferenceAudio } from "../services/voice-reference-cleaner";
import { synthesizeVoiceAudio } from "../services/voice-audio-provider";

const [projectId, runId] = process.argv
  .slice(2)
  .filter((value) => value !== "--" && value.length > 0);
const input = z
  .object({
    projectId: z.string().min(1),
    runId: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
  })
  .parse({ projectId, runId });

const prisma = getPrisma();
const objectStore = new LocalObjectStore();
const project = await prisma.project.findUniqueOrThrow({
  where: { id: input.projectId },
  include: {
    scenes: { orderBy: { order: "asc" } },
    voiceProfile: { include: { asset: true } },
  },
});

if (project.scenes.length === 0) throw new Error("VOICE_SCENES_REQUIRED");
if (!project.voiceProfile?.asset) throw new Error("VOICE_PROFILE_REQUIRED");

const referenceMetadata = voiceCloneReferenceMetadataSchema.parse(
  project.voiceProfile.asset.metadata,
);
const serviceUrl = resolveVoiceServiceUrl(
  referenceMetadata.serviceUrl,
  process.env.VOICE_SERVICE_URL,
);
const referenceAudio = await cleanVoiceReferenceAudio(
  await objectStore.get(project.voiceProfile.asset.objectKey),
);
const sceneTexts = project.scenes.map((scene) => voiceTextForScene(scene));
const fullText = sceneTexts.join("");
const groups = groupScenesForContinuousVoice(project.scenes);

console.log(
  `[continuous-voice] synthesizing ${project.scenes.length} scenes / ${fullText.length} characters ` +
    `as ${groups.length} sentence groups`,
);
const groupAudios: Uint8Array[] = [];
for (const [index, group] of groups.entries()) {
  const synthesized = await synthesizeVoiceAudio({
    serviceUrl,
    provider: referenceMetadata.provider,
    ...(referenceMetadata.speaker
      ? { speaker: referenceMetadata.speaker }
      : {}),
    text: joinContinuousNarration(group),
    referenceAudio,
  });
  const cleaned = await cleanVoiceOutputAudio(synthesized);
  groupAudios.push(capWavTrailingSilence(cleaned, 180));
  console.log(`[continuous-voice] group ${index + 1}/${groups.length} ready`);
}
const audio = concatenatePcmWav(
  groupAudios.map((groupAudio) => ({ audio: groupAudio, pauseAfterMs: 0 })),
);
const durationMs = wavDurationMs(audio);
if (!durationMs || durationMs < 100) throw new Error("VOICE_AUDIO_INVALID");

const partition = await partitionContinuousVoice(
  audio,
  sceneTexts,
  ({ audio: alignmentAudio, text, sceneTexts: alignmentScenes }) =>
    alignNarrationWithLocalWhisper({
      audio: alignmentAudio,
      text,
      sceneTexts: alignmentScenes,
      maximumErrorRate: 0.15,
    }),
);
if (partition.mode !== "whisper" || !partition.cueGroups) {
  throw new Error("VOICE_FULL_ALIGNMENT_REQUIRED");
}

const sceneParts = project.scenes.map((scene, index) => {
  const boundary = partition.boundaries[index];
  const cueGroup = partition.cueGroups?.[index];
  if (!boundary || !cueGroup || cueGroup.length === 0) {
    throw new Error(`VOICE_FULL_ALIGNMENT_SCENE_MISSING:${scene.order}`);
  }
  const sceneAudio = slicePcmWav(audio, boundary.startMs, boundary.endMs);
  const sceneDurationMs = wavDurationMs(sceneAudio) ?? boundary.endMs - boundary.startMs;
  const localCues: SubtitleCueInput[] = cueGroup.map((cue) => ({
    ...cue,
    startMs: Math.max(0, cue.startMs - boundary.startMs),
    endMs: Math.min(
      sceneDurationMs,
      Math.max(1, cue.endMs - boundary.startMs),
    ),
  }));
  const alignedCues = alignSubtitleCueStartsToPcmWav(
    sceneAudio,
    localCues,
    { firstSearchRadiusMs: 800, firstCueStrategy: "acoustic" },
  );
  const cues = finalizeSceneSubtitleCues(
    alignedCues,
    0,
    sceneDurationMs,
  );
  if (cues.length !== splitSubtitleText(scene.narration, null).length) {
    throw new Error(`VOICE_FULL_CUE_COUNT_MISMATCH:${scene.order}`);
  }
  return {
    scene,
    audio: sceneAudio,
    cues,
    durationMs: sceneDurationMs,
    boundary,
  };
});

const masterObjectKey =
  `projects/${project.id}/revisions/${project.revision}/` +
  `voice/full-continuous-${input.runId}.wav`;
const storedMaster = await objectStore.put(masterObjectKey, audio, "audio/wav");
const storedScenes = await Promise.all(
  sceneParts.map(async (part) => {
    const objectKey =
      `projects/${project.id}/revisions/${project.revision}/` +
      `scenes/${part.scene.id}/voice-full-continuous-${input.runId}.wav`;
    const stored = await objectStore.put(objectKey, part.audio, "audio/wav");
    return { ...part, stored };
  }),
);

const metadata = continuousNarrationAssetMetadataSchema.parse({
  assetRole: "CONTINUOUS_NARRATION",
  projectRevision: project.revision,
  sceneIds: project.scenes.map((scene) => scene.id),
  sceneDurationsMs: storedScenes.map((part) => part.durationMs),
  durationMs,
  voiceGenerationJobId: `full-continuous-${input.runId}`,
});

await prisma.$transaction(async (tx) => {
  await tx.asset.create({
    data: {
      projectId: project.id,
      kind: "NARRATION_MIX",
      bucket: storedMaster.bucket,
      objectKey: storedMaster.objectKey,
      contentType: "audio/wav",
      byteSize: BigInt(storedMaster.byteSize),
      source: "voice-full-continuous-test",
      metadata,
    },
  });

  for (const part of storedScenes) {
    const asset = await tx.asset.create({
      data: {
        projectId: project.id,
        kind: "VOICE",
        bucket: part.stored.bucket,
        objectKey: part.stored.objectKey,
        contentType: "audio/wav",
        byteSize: BigInt(part.stored.byteSize),
        source: "voice-full-continuous-test",
        metadata: {
          runId: input.runId,
          sourceMasterObjectKey: masterObjectKey,
          sceneBoundaryStartMs: part.boundary.startMs,
          sceneBoundaryEndMs: part.boundary.endMs,
        },
      },
    });
    await tx.voiceTrack.create({
      data: {
        sceneId: part.scene.id,
        assetId: asset.id,
        model: project.voiceStyle,
        voice: project.voiceProfile!.name,
        instructions: "full-continuous-test",
        durationMs: part.durationMs,
        aiGenerated: true,
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
        highlighted: [],
      })),
    });
    await tx.scene.update({
      where: { id: part.scene.id },
      data: { estimatedDuration: Math.max(0.1, part.durationMs / 1_000) },
    });
  }
});

console.log(
  JSON.stringify({
    projectId: project.id,
    runId: input.runId,
    mode: partition.mode,
    scenes: storedScenes.length,
    durationMs,
    masterObjectKey,
    firstBoundaries: storedScenes.slice(0, 5).map((part) => part.boundary),
  }),
);
