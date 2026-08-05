import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

async function getOwnedProfile(profileId: string) {
  const user = await getCurrentUser();
  const profile = await getPrisma().characterProfile.findFirst({
    where: { id: profileId, ownerId: user.id },
    include: { asset: true },
  });
  if (!profile) throw new Error("CHARACTER_PROFILE_NOT_FOUND");
  return profile;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  try {
    const { profileId } = await context.params;
    const profile = await getOwnedProfile(profileId);
    const bytes = await new LocalObjectStore().get(profile.asset.objectKey);

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": profile.asset.contentType,
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename="character-${profile.id}"`,
        "cache-control": "private, no-store",
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
    const profile = await getOwnedProfile(profileId);
    const prisma = getPrisma();

    await prisma.$transaction(async (tx) => {
      await tx.characterProfile.delete({ where: { id: profile.id } });
      await tx.asset.delete({ where: { id: profile.assetId } });
    });
    await new LocalObjectStore().delete(profile.asset.objectKey);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
