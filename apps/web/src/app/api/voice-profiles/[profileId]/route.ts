import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { voiceCloneReferenceMetadataSchema } from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";
import { voiceProfileRenameSchema } from "@/server/voice-profile-update";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  try {
    const input = voiceProfileRenameSchema.parse(await request.json());
    const { profileId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const profile = await prisma.voiceProfile.findFirst({
      where: { id: profileId, ownerId: user.id },
      include: { asset: true },
    });
    if (!profile) throw new Error("VOICE_PROFILE_NOT_FOUND");
    const metadata = voiceCloneReferenceMetadataSchema.safeParse(
      profile.asset.metadata,
    );
    if (metadata.success && metadata.data.builtin) {
      throw new Error("VOICE_PROFILE_BUILTIN_READONLY");
    }

    const updated = await prisma.voiceProfile.update({
      where: { id: profile.id },
      data: { name: input.name },
    });
    return NextResponse.json({
      profile: {
        id: updated.id,
        name: updated.name,
        assetId: profile.assetId,
        fileName: metadata.success
          ? metadata.data.originalFileName
          : "参考声音",
        createdAt: updated.createdAt,
        provider: metadata.success ? metadata.data.provider : "local-clone",
        speaker: metadata.success ? metadata.data.speaker : undefined,
        builtin: false,
        available: true,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  try {
    const { profileId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const profile = await prisma.voiceProfile.findFirst({
      where: { id: profileId, ownerId: user.id },
      include: { asset: true },
    });
    if (!profile) throw new Error("VOICE_PROFILE_NOT_FOUND");

    await prisma.$transaction(async (tx) => {
      await tx.voiceProfile.delete({ where: { id: profile.id } });
      await tx.asset.delete({ where: { id: profile.assetId } });
    });
    await new LocalObjectStore().delete(profile.asset.objectKey);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
