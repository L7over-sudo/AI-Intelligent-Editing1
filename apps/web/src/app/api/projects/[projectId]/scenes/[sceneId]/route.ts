import { NextResponse } from "next/server";

import { getPrisma, type Prisma } from "@stickmotion/db";
import { scenePatchSchema } from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

type RouteContext = {
  params: Promise<{ projectId: string; sceneId: string }>;
};

async function assertOwnedScene(projectId: string, sceneId: string) {
  const user = await getCurrentUser();
  const scene = await getPrisma().scene.findFirst({
    where: {
      id: sceneId,
      projectId,
      project: { ownerId: user.id, deletedAt: null },
    },
  });
  if (!scene) {
    throw new Error("SCENE_NOT_FOUND");
  }
  return scene;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId, sceneId } = await context.params;
    return NextResponse.json({
      scene: await assertOwnedScene(projectId, sceneId),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { projectId, sceneId } = await context.params;
    await assertOwnedScene(projectId, sceneId);
    const input = scenePatchSchema.parse(await request.json());
    const data: Prisma.SceneUpdateInput = {
      revision: { increment: 1 },
    };

    if (input.narration !== undefined) data.narration = input.narration;
    if (input.subtitle !== undefined) data.subtitle = input.subtitle;
    if (input.estimatedDuration !== undefined) {
      data.estimatedDuration = input.estimatedDuration;
    }
    if (input.visualPrompt !== undefined)
      data.visualPrompt = input.visualPrompt;
    if (input.templateElements !== undefined) {
      data.templateElements = input.templateElements;
    }
    if (input.animation !== undefined) data.animation = input.animation;
    if (input.transition !== undefined) data.transition = input.transition;
    if (input.soundEffects !== undefined) {
      data.soundEffects = input.soundEffects;
    }
    if (input.isTextOpening !== undefined) {
      data.isTextOpening = input.isTextOpening;
    }

    const prisma = getPrisma();
    const [scene] = await prisma.$transaction([
      prisma.scene.update({ where: { id: sceneId }, data }),
      prisma.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 }, status: "DRAFT" },
      }),
    ]);
    return NextResponse.json({ scene });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { projectId, sceneId } = await context.params;
    const scene = await assertOwnedScene(projectId, sceneId);
    const prisma = getPrisma();
    const sceneAssets = await prisma.asset.findMany({
      where: {
        projectId,
        objectKey: {
          startsWith: `projects/${projectId}/`,
          contains: `/scenes/${sceneId}/`,
        },
      },
      select: { id: true, objectKey: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.scene.delete({ where: { id: sceneId } });
      if (sceneAssets.length > 0) {
        await tx.asset.deleteMany({
          where: { id: { in: sceneAssets.map((asset) => asset.id) } },
        });
      }
      const following = await tx.scene.findMany({
        where: { projectId, order: { gt: scene.order } },
        select: { id: true, order: true },
      });
      for (const item of following) {
        await tx.scene.update({
          where: { id: item.id },
          data: { order: item.order - 1 },
        });
      }
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 }, status: "DRAFT" },
      });
    });
    const objectStore = new LocalObjectStore();
    await Promise.all(
      sceneAssets.map((asset) => objectStore.delete(asset.objectKey)),
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
