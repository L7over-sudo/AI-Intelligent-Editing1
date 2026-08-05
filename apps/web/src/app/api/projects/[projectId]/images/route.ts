import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { enqueueSceneImageGeneration } from "@stickmotion/queue";
import {
  sceneImageBatchSize,
  sceneImageSelectionSchema,
} from "@stickmotion/shared";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const input = sceneImageSelectionSchema.parse(await request.json());
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
      include: {
        scenes: {
          where: { id: { in: input.sceneIds } },
          select: { id: true },
        },
      },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (project.visualMode !== "AI_IMAGE") {
      throw new Error("AI_IMAGE_MODE_REQUIRED");
    }

    const uniqueSceneIds = [...new Set(input.sceneIds)];
    if (project.scenes.length !== uniqueSceneIds.length) {
      throw new Error("SCENE_NOT_FOUND");
    }

    const job = await prisma.generationJob.create({
      data: {
        projectId,
        type: "SCENE",
        status: "QUEUED",
        idempotencyKey: `scene-images:${projectId}:${project.revision}:${randomUUID()}`,
        projectRevision: project.revision,
        input: { sceneIds: uniqueSceneIds },
        events: {
          create: {
            status: "QUEUED",
            progress: 0,
            code: "SCENE_IMAGES_QUEUED",
            metadata: {
              sceneCount: uniqueSceneIds.length,
              batchSize: sceneImageBatchSize,
            },
          },
        },
      },
    });

    await enqueueSceneImageGeneration({
      jobId: job.id,
      projectId,
      projectRevision: project.revision,
      sceneIds: uniqueSceneIds,
    });

    return NextResponse.json(
      {
        jobId: job.id,
        status: "QUEUED",
        sceneCount: uniqueSceneIds.length,
        batchSize: sceneImageBatchSize,
      },
      { status: 202 },
    );
  } catch (error) {
    return apiError(error);
  }
}
