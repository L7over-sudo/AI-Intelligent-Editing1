import { access } from "node:fs/promises";

import { getPrisma } from "@stickmotion/db";
import { voiceCloneReferenceMetadataSchema } from "@stickmotion/shared";
import { resolveObjectPath } from "@stickmotion/storage";

const prisma = getPrisma();
const profiles = await prisma.voiceProfile.findMany({
  include: { asset: true },
  orderBy: { updatedAt: "desc" },
});
const voiceAssets = await prisma.asset.findMany({
  where: { kind: "VOICE" },
  orderBy: { createdAt: "desc" },
});

const profileResult = await Promise.all(
  profiles.map(async (profile) => {
    const metadata = voiceCloneReferenceMetadataSchema.safeParse(
      profile.asset.metadata,
    );
    const absolutePath = resolveObjectPath(profile.asset.objectKey);
    let exists = true;
    try {
      await access(absolutePath);
    } catch {
      exists = false;
    }
    return {
      profileId: profile.id,
      profileName: profile.name,
      assetId: profile.asset.id,
      projectId: profile.asset.projectId,
      objectKey: profile.asset.objectKey,
      absolutePath,
      contentType: profile.asset.contentType,
      expectedBytes: profile.asset.byteSize?.toString() ?? null,
      originalFileName: metadata.success
        ? metadata.data.originalFileName
        : null,
      exists,
    };
  }),
);

const recoverableAssets = (
  await Promise.all(
    voiceAssets.map(async (asset) => {
      const absolutePath = resolveObjectPath(asset.objectKey);
      let exists = true;
      try {
        await access(absolutePath);
      } catch {
        exists = false;
      }
      return {
        id: asset.id,
        projectId: asset.projectId,
        objectKey: asset.objectKey,
        absolutePath,
        contentType: asset.contentType,
        byteSize: asset.byteSize?.toString() ?? null,
        source: asset.source,
        exists,
      };
    }),
  )
).filter((asset) => asset.exists);

console.log(
  JSON.stringify({ profiles: profileResult, recoverableAssets }, null, 2),
);
await prisma.$disconnect();
