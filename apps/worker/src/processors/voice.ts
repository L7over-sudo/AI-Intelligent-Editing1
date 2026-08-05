import type { LocalJob } from "@stickmotion/queue";

import { getPrisma } from "@stickmotion/db";
import { cuesToAss, cuesToSrt, wavDurationMs } from "@stickmotion/media";
import { LocalObjectStore } from "@stickmotion/storage";
import {
  voiceCloneReferenceMetadataSchema,
  voiceGenerationInputSchema,
  type VoiceGenerationInput,
} from "@stickmotion/shared";

import {
  VoxCPMAudioProvider,
  type VoiceAudioProvider,
} from "../services/voxcpm-audio-provider";
import { prepareVoxCPMReference } from "../services/voxcpm-reference";

export function createVoiceProcessor(
  audioProvider: VoiceAudioProvider = new VoxCPMAudioProvider(),
  objectStore = new LocalObjectStore(),
) {
  return async function processVoice(
    bullJob: LocalJob<VoiceGenerationInput>,
  ): Promise<{ audioObjectKey: string }> {
    const input = voiceGenerationInputSchema.parse(bullJob.data);
    const prisma = getPrisma();
    await prisma.generationJob.update({
      where: { id: input.jobId },
      data: { status: "RUNNING", progress: 5, startedAt: new Date() },
    });

    try {
      const scene = await prisma.scene.findUniqueOrThrow({
        where: { id: input.sceneId },
        include: {
          project: {
            include: {
              voiceProfile: { include: { asset: true } },
              assets: {
                where: { kind: "VOICE", source: "user-upload" },
                orderBy: { createdAt: "desc" },
                take: 20,
              },
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

      const referenceAsset =
        scene.project.voiceProfile?.asset ??
        scene.project.assets.find(
          (asset) =>
            voiceCloneReferenceMetadataSchema.safeParse(asset.metadata).success,
        );
      if (!referenceAsset) throw new Error("VOICE_CLONE_REFERENCE_REQUIRED");
      const reference = voiceCloneReferenceMetadataSchema.parse(
        referenceAsset.metadata,
      );
      const preparedReference = await prepareVoxCPMReference(
        referenceAsset.objectKey,
        referenceAsset.id,
        reference.promptText,
        reference.promptLanguage,
      );

      const audio = await audioProvider.generateVoice({
        text: scene.narration,
        referenceAudioPath: preparedReference.audioPath,
        promptText: preparedReference.promptText,
        serviceUrl: reference.serviceUrl,
      });
      await bullJob.updateProgress(55);

      const durationMs = Math.max(
        1_500,
        wavDurationMs(audio) ?? Math.round(scene.estimatedDuration * 1_000),
      );
      const cues = await audioProvider.transcribeWithTimestamps(
        audio,
        scene.subtitle,
        durationMs,
      );
      const base =
        `projects/${scene.projectId}/revisions/${scene.project.revision}/` +
        `scenes/${scene.id}`;
      const [storedAudio, storedSrt, storedAss] = await Promise.all([
        objectStore.put(`${base}/voice-${input.jobId}.wav`, audio, "audio/wav"),
        objectStore.put(
          `${base}/captions-${input.jobId}.srt`,
          new TextEncoder().encode(cuesToSrt(cues)),
          "application/x-subrip",
        ),
        objectStore.put(
          `${base}/captions-${input.jobId}.ass`,
          new TextEncoder().encode(
            cuesToAss(
              cues,
              {
                fontName: "Noto Sans CJK SC",
                fontSize: 60,
                primaryColor: "#FFFFFF",
                accentColor: scene.project.accentColor,
                outline: true,
                shadow: true,
                position: "BOTTOM",
                bilingual: false,
              },
              scene.project.aspectRatio === "PORTRAIT"
                ? { width: 1080, height: 1920 }
                : { width: 1920, height: 1080 },
            ),
          ),
          "text/x-ssa",
        ),
      ]);

      await prisma.$transaction(async (tx) => {
        // Use upserts keyed on (bucket, objectKey) so a job retried after a
        // worker restart does not crash on the unique constraint when the
        // previous attempt already committed the asset rows.
        const [audioAsset] = await Promise.all([
          tx.asset.upsert({
            where: {
              bucket_objectKey: {
                bucket: storedAudio.bucket,
                objectKey: storedAudio.objectKey,
              },
            },
            update: {
              projectId: scene.projectId,
              contentType: "audio/wav",
              byteSize: storedAudio.byteSize,
              source: "voxcpm2",
              license: "ai-generated-with-user-consent",
            },
            create: {
              projectId: scene.projectId,
              kind: "VOICE",
              bucket: storedAudio.bucket,
              objectKey: storedAudio.objectKey,
              byteSize: storedAudio.byteSize,
              contentType: "audio/wav",
              source: "voxcpm2",
              license: "ai-generated-with-user-consent",
            },
          }),
          tx.asset.upsert({
            where: {
              bucket_objectKey: {
                bucket: storedSrt.bucket,
                objectKey: storedSrt.objectKey,
              },
            },
            update: {
              projectId: scene.projectId,
              contentType: "application/x-subrip",
              byteSize: storedSrt.byteSize,
              source: "local-text-alignment",
              license: "project-output",
            },
            create: {
              projectId: scene.projectId,
              kind: "SUBTITLE_SRT",
              bucket: storedSrt.bucket,
              objectKey: storedSrt.objectKey,
              byteSize: storedSrt.byteSize,
              contentType: "application/x-subrip",
              source: "local-text-alignment",
              license: "project-output",
            },
          }),
          tx.asset.upsert({
            where: {
              bucket_objectKey: {
                bucket: storedAss.bucket,
                objectKey: storedAss.objectKey,
              },
            },
            update: {
              projectId: scene.projectId,
              contentType: "text/x-ssa",
              byteSize: storedAss.byteSize,
              source: "local-text-alignment",
              license: "project-output",
            },
            create: {
              projectId: scene.projectId,
              kind: "SUBTITLE_ASS",
              bucket: storedAss.bucket,
              objectKey: storedAss.objectKey,
              byteSize: storedAss.byteSize,
              contentType: "text/x-ssa",
              source: "local-text-alignment",
              license: "project-output",
            },
          }),
        ]);
        await tx.voiceTrack.create({
          data: {
            sceneId: scene.id,
            assetId: audioAsset.id,
            model: "openbmb/VoxCPM2",
            voice: "VoxCPM2 高保真克隆",
            instructions: preparedReference.promptText,
            durationMs,
            aiGenerated: true,
          },
        });
        await tx.scene.update({
          where: { id: scene.id },
          data: { estimatedDuration: Math.max(1.5, durationMs / 1_000) },
        });
        await tx.subtitleCue.deleteMany({ where: { sceneId: scene.id } });
        await tx.subtitleCue.createMany({
          data: cues.map((cue, order) => ({
            sceneId: scene.id,
            order,
            startMs: cue.startMs,
            endMs: cue.endMs,
            text: cue.text,
            translation: cue.translation ?? null,
            highlighted: cue.highlighted ?? [],
          })),
        });
        await tx.generationJob.update({
          where: { id: input.jobId },
          data: {
            status: "SUCCEEDED",
            progress: 100,
            errorCode: null,
            errorMessage: null,
            finishedAt: new Date(),
            output: { audioObjectKey: storedAudio.objectKey },
          },
        });
      });
      return { audioObjectKey: storedAudio.objectKey };
    } catch (error) {
      await prisma.generationJob.update({
        where: { id: input.jobId },
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
