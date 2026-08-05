import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import {
  characterReferenceMetadataSchema,
  characterReferenceUploadSchema,
} from "@stickmotion/shared";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

const extensionByContentType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const input = characterReferenceUploadSchema.parse(await request.json());
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");

    const extension = extensionByContentType[input.contentType];
    const objectKey = `users/${user.id}/character-profiles/${randomUUID()}.${extension}`;
    const metadata = characterReferenceMetadataSchema.parse({
      purpose: "character-reference",
      originalFileName: input.fileName,
    });

    const saved = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          projectId,
          kind: "CHARACTER_REFERENCE",
          bucket: "local",
          objectKey,
          contentType: input.contentType,
          byteSize: BigInt(input.byteSize),
          source: "user-upload",
          license: "user-provided",
          metadata,
        },
      });
      const profile = await tx.characterProfile.create({
        data: {
          ownerId: user.id,
          assetId: asset.id,
          name: input.profileName,
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { characterProfileId: profile.id },
      });
      return { asset, profile };
    });

    return NextResponse.json({
      assetId: saved.asset.id,
      profile: {
        id: saved.profile.id,
        name: saved.profile.name,
      },
      uploadUrl: `/api/assets/${saved.asset.id}/content`,
      method: "PUT",
    });
  } catch (error) {
    return apiError(error);
  }
}
