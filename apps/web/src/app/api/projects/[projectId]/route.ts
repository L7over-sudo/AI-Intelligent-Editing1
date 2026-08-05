import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";
import { retainedProfileAssetObjectKey } from "@/server/profile-asset-retention";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const project = await getPrisma().project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
      include: {
        scenes: {
          orderBy: { order: "asc" },
          include: {
            voiceTracks: { orderBy: { createdAt: "desc" }, take: 1 },
            sceneAssets: {
              where: { role: "VISUAL" },
              orderBy: { order: "desc" },
              take: 1,
              include: { asset: { select: { id: true, metadata: true } } },
            },
          },
        },
        jobs: { orderBy: { createdAt: "desc" }, take: 100 },
        renderOutputs: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    return NextResponse.json({ project });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");

    const objectStore = new LocalObjectStore();
    const projectAssets = await prisma.asset.findMany({
      where: { projectId: project.id },
      include: {
        voiceProfile: { select: { id: true } },
        characterProfile: { select: { id: true } },
      },
    });
    const retainedAssets = projectAssets.filter(
      (asset) => asset.voiceProfile || asset.characterProfile,
    );
    const retainedObjectKeys = new Map<string, string>();
    for (const asset of retainedAssets) {
      const destination = retainedProfileAssetObjectKey({
        ownerId: user.id,
        assetId: asset.id,
        kind:
          asset.kind === "CHARACTER_REFERENCE"
            ? "CHARACTER_REFERENCE"
            : "VOICE",
        objectKey: asset.objectKey,
      });
      if (asset.objectKey !== destination) {
        const bytes = await objectStore.get(asset.objectKey);
        await objectStore.put(destination, bytes, asset.contentType);
      }
      retainedObjectKeys.set(asset.id, destination);
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const [assetId, objectKey] of retainedObjectKeys) {
        await tx.asset.update({
          where: { id: assetId },
          data: { projectId: null, objectKey },
        });
      }
      await tx.project.update({
        where: { id: project.id },
        data: { deletedAt: now, revision: { increment: 1 } },
      });
      const activeJobs = await tx.generationJob.findMany({
        where: {
          projectId: project.id,
          status: { in: ["QUEUED", "RUNNING", "RETRYING"] },
        },
        select: { id: true, status: true, progress: true },
      });
      for (const job of activeJobs) {
        const status =
          job.status === "RUNNING" ? "CANCEL_REQUESTED" : "CANCELED";
        await tx.generationJob.update({
          where: { id: job.id },
          data: {
            status,
            ...(status === "CANCELED" ? { finishedAt: now } : {}),
            events: {
              create: {
                status,
                progress: job.progress,
                code: "PROJECT_DELETED",
              },
            },
          },
        });
      }
    });
    await objectStore.deletePrefix(`projects/${project.id}`);

    return NextResponse.json({
      projectId: project.id,
      deleted: true,
      localFilesDeleted: true,
    });
  } catch (error) {
    return apiError(error);
  }
}
