import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import {
  buildSceneOrderUpdates,
  sceneReorderSchema,
} from "@stickmotion/shared";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const input = sceneReorderSchema.parse(await request.json());
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
      select: { revision: true },
    });
    if (!project) {
      throw new Error("PROJECT_NOT_FOUND");
    }
    if (project.revision !== input.expectedProjectRevision) {
      throw new Error("PROJECT_REVISION_CONFLICT");
    }

    const scenes = await prisma.scene.findMany({
      where: { projectId },
      select: { id: true },
      orderBy: { order: "asc" },
    });
    const updates = buildSceneOrderUpdates(
      scenes.map(({ id }) => id),
      input.sceneIds,
    );

    await prisma.$transaction(async (tx) => {
      await Promise.all(
        updates.map(({ id }, index) =>
          tx.scene.update({
            where: { id },
            data: { order: -(index + 1) },
          }),
        ),
      );
      await Promise.all(
        updates.map(({ id, order }) =>
          tx.scene.update({ where: { id }, data: { order } }),
        ),
      );
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 }, status: "DRAFT" },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

