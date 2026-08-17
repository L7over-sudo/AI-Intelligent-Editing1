import { stat } from "node:fs/promises";

import type { PrismaClient } from "@stickmotion/db";
import { voiceCloneReferenceMetadataSchema } from "@stickmotion/shared";
import { resolveObjectPath } from "@stickmotion/storage";

export const INDEXTTS_BUILTIN_PRESET_PREFIX = "presets/indextts2";

export interface BuiltinVoiceProfileDefinition {
  name: string;
  fileName: string;
  objectKey: string;
}

const BUILTIN_VOICE_NAMES: Record<string, string> = {
  "voice_03.wav": "展示讲解女声",
  "voice_04.wav": "专业叙述女声",
  "voice_05.wav": "沉稳男声长文",
  "voice_06.wav": "幽默俏皮",
  "voice_07.wav": "低沉男声对话",
  "voice_08.wav": "细腻低沉女声",
  "voice_09.wav": "温柔甜美女声",
  "voice_11.wav": "伤感悲情女声",
  "voice_12.wav": "紧张急促男声",
};

export function builtinVoiceProfileDefinitions(): BuiltinVoiceProfileDefinition[] {
  return [3, 4, 5, 6, 7, 8, 9, 11, 12].map((index) => {
    const fileName = `voice_${String(index).padStart(2, "0")}.wav`;
    return {
      name: BUILTIN_VOICE_NAMES[fileName] ?? `内置音色 ${index}`,
      fileName,
      objectKey: `${INDEXTTS_BUILTIN_PRESET_PREFIX}/${fileName}`,
    };
  });
}

export function builtinVoiceProfileMetadata(
  serviceUrl: string,
  definition: BuiltinVoiceProfileDefinition,
) {
  return voiceCloneReferenceMetadataSchema.parse({
    provider: "indextts2",
    purpose: "voice-clone-reference",
    originalFileName: definition.fileName,
    serviceUrl,
    builtin: true,
    consentConfirmedAt: "2025-09-08T00:00:00.000Z",
  });
}

export async function ensureBuiltinVoiceProfiles(
  prisma: PrismaClient,
  userId: string,
  serviceUrl: string,
) {
  for (const definition of builtinVoiceProfileDefinitions()) {
    let byteSize: number | undefined;
    try {
      byteSize = (await stat(resolveObjectPath(definition.objectKey))).size;
    } catch {
      // Preset audio missing on disk; skip so the UI never shows a broken profile.
      continue;
    }
    const metadata = builtinVoiceProfileMetadata(serviceUrl, definition);
    const asset = await prisma.asset.upsert({
      where: {
        bucket_objectKey: { bucket: "local", objectKey: definition.objectKey },
      },
      create: {
        kind: "VOICE",
        bucket: "local",
        objectKey: definition.objectKey,
        contentType: "audio/wav",
        byteSize: BigInt(byteSize),
        source: "builtin-preset",
        metadata,
      },
      update: { metadata, byteSize: BigInt(byteSize) },
    });
    const existingProfile = await prisma.voiceProfile.findFirst({
      where: { ownerId: userId, assetId: asset.id },
      select: { id: true },
    });
    if (existingProfile) {
      await prisma.voiceProfile.update({
        where: { id: existingProfile.id },
        data: { name: definition.name },
      });
    } else {
      await prisma.voiceProfile.create({
        data: { ownerId: userId, assetId: asset.id, name: definition.name },
      });
    }
  }
}
