import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import {
  voiceCloneReferenceMetadataSchema,
  voiceCloneUploadSchema,
} from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const profiles = await getPrisma().voiceProfile.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { asset: true },
    });

    const objectStore = new LocalObjectStore();
    return NextResponse.json({
      profiles: await Promise.all(
        profiles.map(async (profile) => {
          const metadata = voiceCloneReferenceMetadataSchema.safeParse(
            profile.asset.metadata,
          );
          let available = true;
          try {
            await objectStore.size(profile.asset.objectKey);
          } catch {
            available = false;
          }
          return {
            id: profile.id,
            name: profile.name,
            assetId: profile.assetId,
            fileName: metadata.success
              ? metadata.data.originalFileName
              : "参考声音",
            createdAt: profile.createdAt,
            available,
          };
        }),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = voiceCloneUploadSchema.parse(await request.json());
    const user = await getCurrentUser();
    const extension = input.fileName.toLowerCase().split(".").pop() ?? "wav";
    const safeExtension = /^[a-z0-9]{2,5}$/u.test(extension) ? extension : "wav";
    const objectKey =
      `users/${user.id}/voice-profiles/` +
      `${randomUUID()}.${safeExtension}`;
    const metadata = voiceCloneReferenceMetadataSchema.parse({
      purpose: "voice-clone-reference",
      originalFileName: input.fileName,
      promptText: input.promptText,
      promptLanguage: input.promptLanguage,
      serviceUrl: input.serviceUrl,
      consentConfirmedAt: new Date().toISOString(),
    });
    const saved = await getPrisma().$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          kind: "VOICE",
          bucket: "local",
          objectKey,
          contentType: input.contentType,
          byteSize: BigInt(input.byteSize),
          source: "user-upload",
          license: "user-confirmed-voice-consent",
          metadata,
        },
      });
      const profile = await tx.voiceProfile.create({
        data: {
          ownerId: user.id,
          assetId: asset.id,
          name: input.profileName,
        },
      });
      return { asset, profile };
    });

    return NextResponse.json({
      assetId: saved.asset.id,
      uploadUrl: `/api/assets/${saved.asset.id}/content`,
      method: "PUT",
      profile: {
        id: saved.profile.id,
        name: saved.profile.name,
        assetId: saved.asset.id,
        fileName: input.fileName,
        createdAt: saved.profile.createdAt,
        available: true,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
