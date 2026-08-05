import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPrisma, type PrismaClient } from "@stickmotion/db";
import {
  soundEffectSchema,
  soundEffectTagSchema,
  type SoundEffectTag,
} from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";
import { z } from "zod";

import { soundEffectOffsetMs } from "./automatic-sound-effects";
import {
  externalSoundEffectObjectKey,
  findExternalSoundEffectRoot,
  readExternalSoundEffectCatalog,
  resolveExternalSoundEffectPath,
} from "./external-sound-effect-library";

const manifestSchema = z
  .object({
    version: z.number().int().positive(),
    license: z.string().trim().min(1),
    source: z.string().trim().min(1),
    assets: z
      .array(
        z
          .object({
            tag: soundEffectTagSchema,
            file: z
              .string()
              .regex(/^[a-zA-Z0-9._-]+\.wav$/u)
              .refine((value) => !value.includes("..")),
            recommendedGainDb: z.number().min(-24).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(soundEffectTagSchema.options.length),
  })
  .strict();

export interface SoundEffectAsset {
  assetId: string;
  recommendedGainDb: number;
  objectKey: string;
  contentType: string;
  displayName: string;
  source: "builtin-synthesized" | "user-local-library";
  license: string;
}

export type SoundEffectAssetMap = ReadonlyMap<SoundEffectTag, SoundEffectAsset>;

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

export async function findSoundEffectLibraryRoot(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "assets", "sfx"),
    path.resolve(process.cwd(), "..", "..", "assets", "sfx"),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "assets",
      "sfx",
    ),
  ];

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) return candidate;
  }
  throw new Error("SFX_LIBRARY_NOT_FOUND");
}

export async function ensureSoundEffectLibrary(
  objectStore = new LocalObjectStore(),
  prisma: PrismaClient = getPrisma(),
  libraryRoot?: string,
): Promise<SoundEffectAssetMap> {
  const root = libraryRoot ?? (await findSoundEffectLibraryRoot());
  const manifest = manifestSchema.parse(
    JSON.parse(
      await readFile(path.join(root, "manifest.json"), "utf8"),
    ) as unknown,
  );
  const result = new Map<SoundEffectTag, SoundEffectAsset>();

  for (const item of manifest.assets) {
    const body = await readFile(path.join(root, item.file));
    const objectKey = `library/sfx/${item.file}`;
    const stored = await objectStore.put(objectKey, body, "audio/wav");
    const asset = await prisma.asset.upsert({
      where: {
        bucket_objectKey: {
          bucket: stored.bucket,
          objectKey: stored.objectKey,
        },
      },
      create: {
        projectId: null,
        kind: "SFX",
        bucket: stored.bucket,
        objectKey: stored.objectKey,
        contentType: "audio/wav",
        byteSize: BigInt(stored.byteSize),
        source: "builtin-synthesized",
        license: manifest.license,
        metadata: {
          tag: item.tag,
          manifestVersion: manifest.version,
          source: manifest.source,
        },
      },
      update: {
        kind: "SFX",
        contentType: "audio/wav",
        byteSize: BigInt(stored.byteSize),
        source: "builtin-synthesized",
        license: manifest.license,
        metadata: {
          tag: item.tag,
          manifestVersion: manifest.version,
          source: manifest.source,
        },
      },
    });
    result.set(item.tag, {
      assetId: asset.id,
      recommendedGainDb: item.recommendedGainDb,
      objectKey: asset.objectKey,
      contentType: asset.contentType,
      displayName: item.file.replace(/\.wav$/u, ""),
      source: "builtin-synthesized",
      license: manifest.license,
    });
  }

  const [externalRoot, externalCatalog] = await Promise.all([
    findExternalSoundEffectRoot(),
    readExternalSoundEffectCatalog(),
  ]);
  if (externalRoot && externalCatalog) {
    const selected = new Map<
      SoundEffectTag,
      (typeof externalCatalog.assets)[number]
    >();
    for (const item of externalCatalog.assets) {
      if (!selected.has(item.tag)) selected.set(item.tag, item);
    }
    for (const item of selected.values()) {
      let body: Buffer;
      try {
        body = await readFile(
          resolveExternalSoundEffectPath(externalRoot, item.relativePath),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const objectKey = externalSoundEffectObjectKey(item);
      const stored = await objectStore.put(
        objectKey,
        body,
        item.contentType,
      );
      const license =
        "user-provided; usage rights asserted by the local library owner";
      const asset = await prisma.asset.upsert({
        where: {
          bucket_objectKey: {
            bucket: stored.bucket,
            objectKey: stored.objectKey,
          },
        },
        create: {
          projectId: null,
          kind: "SFX",
          bucket: stored.bucket,
          objectKey: stored.objectKey,
          contentType: item.contentType,
          byteSize: BigInt(stored.byteSize),
          source: "user-local-library",
          license,
          metadata: {
            tag: item.tag,
            displayName: item.displayName,
            relativePath: item.relativePath,
            rootName: externalCatalog.rootName,
            catalogVersion: externalCatalog.version,
          },
        },
        update: {
          kind: "SFX",
          contentType: item.contentType,
          byteSize: BigInt(stored.byteSize),
          source: "user-local-library",
          license,
          metadata: {
            tag: item.tag,
            displayName: item.displayName,
            relativePath: item.relativePath,
            rootName: externalCatalog.rootName,
            catalogVersion: externalCatalog.version,
          },
        },
      });
      result.set(item.tag, {
        assetId: asset.id,
        recommendedGainDb: item.recommendedGainDb,
        objectKey: asset.objectKey,
        contentType: asset.contentType,
        displayName: item.displayName,
        source: "user-local-library",
        license,
      });
    }
  }

  const fallbackTags: Record<SoundEffectTag, SoundEffectTag> = {
    pop: "pop",
    click: "click",
    whoosh: "whoosh",
    success: "success",
    error: "error",
    typing: "typing",
    clock: "clock",
    impact: "impact",
    laughter: "pop",
    applause: "success",
    cheer: "success",
    surprise: "impact",
    question: "pop",
    notification: "click",
    camera: "click",
    phone: "notification",
    footsteps: "click",
    door: "impact",
    money: "success",
    food: "click",
    cooking: "typing",
    water: "whoosh",
    nature: "whoosh",
    traffic: "whoosh",
    crowd: "pop",
    animal: "pop",
    magic: "success",
    tension: "clock",
    sad: "error",
    game: "success",
    mechanical: "impact",
    sci_fi: "whoosh",
  };
  for (const tag of soundEffectTagSchema.options) {
    if (result.has(tag)) continue;
    const fallback = result.get(fallbackTags[tag]);
    if (fallback) result.set(tag, fallback);
  }

  return result;
}

export async function synchronizeProjectSoundEffects(
  projectId: string,
  projectRevision: number,
  objectStore = new LocalObjectStore(),
  prisma: PrismaClient = getPrisma(),
): Promise<number> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      revision: true,
      includeSoundEffects: true,
      scenes: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          narration: true,
          subtitle: true,
          estimatedDuration: true,
          soundEffects: true,
        },
      },
    },
  });
  if (project.revision !== projectRevision) {
    throw new Error("PROJECT_REVISION_STALE");
  }

  if (!project.includeSoundEffects) {
    // Sound effects are disabled for this project: clear any existing
    // placements and per-scene effects so no audio effects reach the render.
    await prisma.$transaction(async (tx) => {
      for (const scene of project.scenes) {
        await tx.scene.update({
          where: { id: scene.id },
          data: { soundEffects: [] },
        });
        await tx.soundPlacement.deleteMany({ where: { sceneId: scene.id } });
      }
    });
    return 0;
  }

  const existingEffects = project.scenes.map((scene) =>
    soundEffectSchema.array().parse(scene.soundEffects),
  );
  const plannedEffects = existingEffects;
  const assets = await ensureSoundEffectLibrary(objectStore, prisma);
  let placementCount = 0;

  await prisma.$transaction(async (tx) => {
    const current = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { revision: true },
    });
    if (current.revision !== projectRevision) {
      throw new Error("PROJECT_REVISION_STALE");
    }

    for (const [index, scene] of project.scenes.entries()) {
      const soundEffects = plannedEffects[index] ?? [];
      await tx.scene.update({
        where: { id: scene.id },
        data: { soundEffects },
      });
      await tx.soundPlacement.deleteMany({ where: { sceneId: scene.id } });

      const placements = soundEffects.map((effect) => {
        const asset = assets.get(effect.tag);
        if (!asset) throw new Error(`SFX_ASSET_MISSING:${effect.tag}`);
        placementCount += 1;
        return {
          sceneId: scene.id,
          assetId: asset.assetId,
          offsetMs: soundEffectOffsetMs(effect, scene.estimatedDuration),
          gainDb: Math.min(effect.gainDb, asset.recommendedGainDb),
          tag: effect.tag,
        };
      });
      if (placements.length > 0) {
        await tx.soundPlacement.createMany({ data: placements });
      }
    }
  });

  return placementCount;
}
