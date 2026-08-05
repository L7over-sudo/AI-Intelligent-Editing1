import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

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
