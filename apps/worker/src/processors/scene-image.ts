import type { LocalJob } from "@stickmotion/queue";

import { getPrisma } from "@stickmotion/db";
import { LocalObjectStore, type StoredObject } from "@stickmotion/storage";
import {
  sceneImageBatchSize,
  sceneImageGenerationInputSchema,
  subtitleStyleSchema,
  type SceneImageGenerationInput,
  type VideoTemplate,
} from "@stickmotion/shared";
import sharp from "sharp";

import {
  OpenAIImageProvider,
  type GenerateSceneImageInput,
} from "../services/ai-image-provider";
import { prepareKnowledgeBoardImage } from "../services/video-template-frame";
import {
  automaticVoiceIdempotencyKey,
  groupScenesForContinuousVoice,
  shouldQueueAutomaticVoice,
} from "./automatic-voice";
import { formatSceneImageGenerationFailure } from "./scene-image-errors";

export interface SceneImageProvider {
  readonly model: string;
  generate(input: GenerateSceneImageInput): Promise<Uint8Array>;
}

export function getSceneImageAspectRatio(
  projectAspectRatio: "PORTRAIT" | "LANDSCAPE",
  videoTemplate: VideoTemplate,
): GenerateSceneImageInput["aspectRatio"] {
  return videoTemplate === "KNOWLEDGE_BOARD" ? "WIDE" : projectAspectRatio;
}

export async function normalizeGeneratedSceneImage(
  source: Uint8Array,
  aspectRatio: GenerateSceneImageInput["aspectRatio"],
): Promise<Buffer> {
  if (aspectRatio === "WIDE") {
    return prepareKnowledgeBoardImage(source);
  }

  const portrait = aspectRatio === "PORTRAIT";
  return sharp(source)
    .resize(portrait ? 1080 : 1920, portrait ? 1920 : 1080, {
      fit: "cover",
      position: "centre",
    })
    .png()
    .toBuffer();
}

const characterReferenceContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function buildCharacterReferenceDataUrl(
  contentType: string,
  bytes: Uint8Array,
): string {
  if (!characterReferenceContentTypes.has(contentType)) {
    throw new Error("CHARACTER_REFERENCE_CONTENT_TYPE_UNSUPPORTED");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error("CHARACTER_REFERENCE_SIZE_INVALID");
  }
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function batchSceneImages<T>(
  items: readonly T[],
  batchSize: number = sceneImageBatchSize,
): T[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("SCENE_IMAGE_BATCH_SIZE_INVALID");
  }
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

export interface SceneImageReuseCriteria {
  projectRevision: number;
  sceneRevision: number;
  characterProfileId: string | null;
  currentJobId: string;
  resumeFromFailedJob: boolean;
}

export function isReusableSceneImage(
  metadata: unknown,
  criteria: SceneImageReuseCriteria,
): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const record = metadata as Record<string, unknown>;
  if (record.projectRevision !== criteria.projectRevision) return false;
  if (record.sceneRevision !== criteria.sceneRevision) return false;
  if (record.characterProfileId !== criteria.characterProfileId) return false;
  const fromCurrentJob = record.generationJobId === criteria.currentJobId;
  return fromCurrentJob || criteria.resumeFromFailedJob;
}

export function createSceneImageProcessor(
  imageProvider: SceneImageProvider = new OpenAIImageProvider(),
  objectStore = new LocalObjectStore(),
) {
  return async function processSceneImages(
    localJob: LocalJob<SceneImageGenerationInput>,
  ): Promise<{ assetIds: string[] }> {
    const input = sceneImageGenerationInputSchema.parse(localJob.data);
    const prisma = getPrisma();

    await prisma.generationJob.update({
      where: { id: input.jobId },
      data: {
        status: "RUNNING",
        progress: 2,
        startedAt: new Date(),
        events: {
          create: {
            status: "RUNNING",
            progress: 2,
            code: "SCENE_IMAGES_STARTED",
            metadata: { batchSize: sceneImageBatchSize },
          },
        },
      },
    });

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: input.projectId },
      include: {
        characterProfile: {
          include: { asset: true },
        },
        scenes: {
          where: { id: { in: input.sceneIds } },
          orderBy: { order: "asc" },
          include: {
            voiceTracks: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    if (project.revision !== input.projectRevision) {
      throw new Error("PROJECT_REVISION_STALE");
    }
    if (project.visualMode !== "AI_IMAGE") {
      throw new Error("AI_IMAGE_MODE_REQUIRED");
    }
    const subtitleStyle = subtitleStyleSchema.parse(project.subtitleStyle);
    const videoTemplate = subtitleStyle.videoTemplate;
    const visualScenes = project.scenes;
    if (visualScenes.length !== new Set(input.sceneIds).size) {
      throw new Error("SCENE_NOT_FOUND");
    }

    const imageAspectRatio = getSceneImageAspectRatio(
      project.aspectRatio,
      videoTemplate,
    );
    const assetIds: string[] = [];
    const referenceImageUrls = project.characterProfile
      ? [
          buildCharacterReferenceDataUrl(
            project.characterProfile.asset.contentType,
            await objectStore.get(project.characterProfile.asset.objectKey),
          ),
        ]
      : undefined;

    // When the previous scene-image run for this revision failed partway, a
    // retry should reuse already-generated scenes and only fill in the gaps
    // instead of regenerating every scene from scratch.
    const previousSceneJob = await prisma.generationJob.findFirst({
      where: {
        projectId: project.id,
        type: "SCENE",
        projectRevision: input.projectRevision,
        id: { not: input.jobId },
      },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    const resumeFromFailedJob = previousSceneJob?.status === "FAILED";

    const prepareSceneImage = async (
      scene: (typeof project.scenes)[number],
    ) => {
      const objectKey =
        `projects/${project.id}/revisions/${project.revision}/` +
        `scenes/${scene.id}/image-${scene.revision}-${input.jobId}.png`;
      const existingAsset = await prisma.asset.findFirst({
        where: {
          projectId: project.id,
          kind: "AI_IMAGE",
          sceneAssets: {
            some: { sceneId: scene.id, role: "VISUAL" },
          },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, objectKey: true, metadata: true },
      });
      if (
        existingAsset &&
        isReusableSceneImage(existingAsset.metadata, {
          projectRevision: project.revision,
          sceneRevision: scene.revision,
          characterProfileId: project.characterProfileId,
          currentJobId: input.jobId,
          resumeFromFailedJob,
        })
      ) {
        try {
          await objectStore.size(existingAsset.objectKey);
          return { scene, existingAssetId: existingAsset.id } as const;
        } catch {
          // The stored file is missing; fall through and regenerate.
        }
      }

      const generated = await imageProvider.generate({
        prompt: scene.visualPrompt,
        aspectRatio: imageAspectRatio,
        accentColor: project.accentColor,
        imageSize: subtitleStyle.imageSize,
        ...(referenceImageUrls ? { referenceImageUrls } : {}),
      });
      const normalized = await normalizeGeneratedSceneImage(
        generated,
        imageAspectRatio,
      );
      const stored = await objectStore.put(objectKey, normalized, "image/png");
      return { scene, stored } as const;
    };

    const commitSceneAsset = async (
      scene: (typeof project.scenes)[number],
      stored: StoredObject,
    ) => {
      const asset = await prisma.$transaction(async (tx) => {
        const currentScene = await tx.scene.findUnique({
          where: { id: scene.id },
          select: {
            revision: true,
            project: { select: { revision: true } },
          },
        });
        if (
          !currentScene ||
          currentScene.revision !== scene.revision ||
          currentScene.project.revision !== input.projectRevision
        ) {
          throw new Error("PROJECT_REVISION_STALE");
        }

        const metadata = {
          projectRevision: project.revision,
          sceneRevision: scene.revision,
          generationJobId: input.jobId,
          characterProfileId: project.characterProfileId,
        };
        const created = await tx.asset.upsert({
          where: {
            bucket_objectKey: {
              bucket: stored.bucket,
              objectKey: stored.objectKey,
            },
          },
          update: {
            projectId: project.id,
            contentType: "image/png",
            byteSize: BigInt(stored.byteSize),
            source: imageProvider.model,
            license: "ai-generated",
            metadata,
          },
          create: {
            projectId: project.id,
            kind: "AI_IMAGE",
            bucket: stored.bucket,
            objectKey: stored.objectKey,
            contentType: "image/png",
            byteSize: BigInt(stored.byteSize),
            source: imageProvider.model,
            license: "ai-generated",
            metadata,
          },
        });
        await tx.sceneAsset.deleteMany({
          where: { sceneId: scene.id, role: "VISUAL" },
        });
        await tx.sceneAsset.create({
          data: {
            sceneId: scene.id,
            assetId: created.id,
            role: "VISUAL",
          },
        });
        return created;
      });
      assetIds.push(asset.id);
    };

    for (const batch of batchSceneImages(visualScenes)) {
      const attempted = await Promise.all(
        batch.map((scene) =>
          prepareSceneImage(scene).catch((error: unknown) => ({
            scene,
            error,
          })),
        ),
      );

      // A transient rejection from the image relay (for example an
      // intermittent moderation 400) should not discard the rest of the batch,
      // so retry each failed scene once before giving up.
      const prepared = await Promise.all(
        attempted.map(async (item) => {
          if (!("error" in item)) return item;
          return prepareSceneImage(item.scene).catch((error: unknown) => ({
            scene: item.scene,
            error,
          }));
        }),
      );

      const failures = prepared.filter(
        (
          item,
        ): item is {
          scene: (typeof project.scenes)[number];
          error: unknown;
        } => "error" in item,
      );

      // Persist the successful scenes before failing so the next retry resumes
      // them instead of regenerating from scratch.
      for (const item of prepared) {
        if ("error" in item) continue;
        if ("existingAssetId" in item) {
          assetIds.push(item.existingAssetId);
          continue;
        }
        await commitSceneAsset(item.scene, item.stored);
      }

      if (failures.length > 0) {
        throw new Error(
          formatSceneImageGenerationFailure(
            failures.map((item) => ({
              sceneId: item.scene.id,
              error: item.error,
            })),
          ),
          { cause: failures[0]?.error },
        );
      }

      const progress =
        5 +
        Math.round((assetIds.length / Math.max(1, visualScenes.length)) * 90);
      await localJob.updateProgress(progress);
    }

    const automaticVoiceJobIds: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const voiceGroup of groupScenesForContinuousVoice(
        project.scenes,
      )) {
        const scene = voiceGroup[0];
        if (!scene) continue;
        if (
          !shouldQueueAutomaticVoice({
            includeNarration: project.includeNarration,
            voiceStyle: project.voiceStyle,
            voiceProfileId: project.voiceProfileId,
            hasVoiceTrack: voiceGroup.every(
              (candidate) => candidate.voiceTracks.length > 0,
            ),
          })
        ) {
          continue;
        }

        const idempotencyKey = automaticVoiceIdempotencyKey(
          scene.id,
          scene.revision,
          input.jobId,
        );
        const voiceJob = await tx.generationJob.upsert({
          where: { idempotencyKey },
          update: {},
          create: {
            projectId: project.id,
            type: "VOICE",
            status: "QUEUED",
            projectRevision: input.projectRevision,
            idempotencyKey,
            input: { sceneId: scene.id },
            events: {
              create: {
                status: "QUEUED",
                progress: 0,
                code: "VOICE_AUTO_QUEUED",
                metadata: { sceneImageJobId: input.jobId },
              },
            },
          },
          select: { id: true },
        });
        automaticVoiceJobIds.push(voiceJob.id);
      }

      await tx.generationJob.update({
        where: { id: input.jobId },
        data: {
          status: "SUCCEEDED",
          progress: 100,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date(),
          output: { assetIds, automaticVoiceJobIds },
          events: {
            create: {
              status: "SUCCEEDED",
              progress: 100,
              code: "SCENE_IMAGES_COMPLETED",
              metadata: {
                sceneCount: assetIds.length,
                batchSize: sceneImageBatchSize,
                automaticVoiceCount: automaticVoiceJobIds.length,
              },
            },
          },
        },
      });
      await tx.project.updateMany({
        where: { id: project.id, revision: input.projectRevision },
        data: { status: "READY" },
      });
    });

    return { assetIds };
  };
}
