import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { characterReferenceMetadataSchema } from "@stickmotion/shared";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const profiles = await getPrisma().characterProfile.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { asset: true },
    });

    return NextResponse.json({
      profiles: profiles.map((profile) => {
        const metadata = characterReferenceMetadataSchema.safeParse(
          profile.asset.metadata,
        );
        return {
          id: profile.id,
          name: profile.name,
          assetId: profile.assetId,
          fileName: metadata.success
            ? metadata.data.originalFileName
            : "参考人物",
          contentType: profile.asset.contentType,
          createdAt: profile.createdAt,
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
