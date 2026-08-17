import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import {
  voiceCloneReferenceMetadataSchema,
  voiceCloneUploadSchema,
} from "@stickmotion/shared";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";
import { ensureBuiltinVoiceProfiles } from "@/server/builtin-voice-profiles";

export async function GET() {
  try {
    const user = await getCurrentUser();
    await ensureBuiltinVoiceProfiles(
      getPrisma(),
      user.id,
      process.env.INDEXTTS_SERVICE_URL ?? "http://127.0.0.1:7851",
    );
    const profiles = await getPrisma().voiceProfile.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { asset: true },
    });

    return NextResponse.json({
      profiles: profiles.map((profile) => {
        const metadata = voiceCloneReferenceMetadataSchema.safeParse(
          profile.asset.metadata,
        );
        return {
          id: profile.id,
          name: profile.name,
          assetId: profile.assetId,
          fileName: metadata.success
            ? metadata.data.originalFileName
            : "参考声音",
          createdAt: profile.createdAt,
          provider: metadata.success ? metadata.data.provider : "indextts2",
          builtin: metadata.success ? Boolean(metadata.data.builtin) : false,
          available: true,
        };
      }),
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
    const safeExtension = /^[a-z0-9]{2,5}$/u.test(extension)
      ? extension
      : "wav";
    const objectKey =
      `users/${user.id}/voice-profiles/` + `${randomUUID()}.${safeExtension}`;
    const metadata = voiceCloneReferenceMetadataSchema.parse({
      provider: "indextts2",
      purpose: "voice-clone-reference",
      originalFileName: input.fileName,
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
        provider: input.provider,
        createdAt: saved.profile.createdAt,
        available: true,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
