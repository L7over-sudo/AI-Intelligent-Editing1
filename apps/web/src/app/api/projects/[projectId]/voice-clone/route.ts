import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import {
  voiceCloneReferenceMetadataSchema,
  voiceCloneUploadSchema,
} from "@stickmotion/shared";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const assets = await getPrisma().asset.findMany({
      where: {
        projectId,
        kind: "VOICE",
        source: "user-upload",
        project: { ownerId: user.id, deletedAt: null },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const reference = assets.find(
      (asset) =>
        voiceCloneReferenceMetadataSchema.safeParse(asset.metadata).success,
    );
    if (!reference) {
      return NextResponse.json({ reference: null });
    }
    const metadata = voiceCloneReferenceMetadataSchema.parse(
      reference.metadata,
    );
    return NextResponse.json({
      reference: {
        assetId: reference.id,
        fileName: metadata.originalFileName,
        provider: metadata.provider,
        serviceUrl: metadata.serviceUrl,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const input = voiceCloneUploadSchema.parse(await request.json());
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");

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

    const saved = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          projectId,
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
      await tx.project.update({
        where: { id: projectId },
        data: {
          voiceStyle: "indextts2",
          voiceProfileId: profile.id,
        },
      });
      return { asset, profile };
    });

    return NextResponse.json({
      assetId: saved.asset.id,
      profile: {
        id: saved.profile.id,
        name: saved.profile.name,
        provider: input.provider,
      },
      uploadUrl: `/api/assets/${saved.asset.id}/content`,
      method: "PUT",
    });
  } catch (error) {
    return apiError(error);
  }
}
