import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getPrisma } from "@stickmotion/db";
import { enqueueRender } from "@stickmotion/queue";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

const renderRequestSchema = z
  .object({
    watermark: z.string().max(80).default(""),
    introTitle: z.boolean().default(true),
    outro: z.boolean().default(true),
  })
  .strict();

function assetMatchesRevision(
  metadata: unknown,
  projectRevision: number,
  sceneRevision: number,
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const candidate = metadata as Record<string, unknown>;
  return (
    candidate.projectRevision === projectRevision &&
    candidate.sceneRevision === sceneRevision
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const options = renderRequestSchema.parse(await request.json());
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
      include: {
        scenes: {
          select: {
            id: true,
            revision: true,
            sceneAssets: {
              where: { role: "VISUAL" },
              select: { asset: { select: { metadata: true } } },
              take: 1,
            },
          },
        },
      },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (project.scenes.length === 0) throw new Error("RENDER_SCENES_REQUIRED");
    if (
      project.visualMode === "AI_IMAGE" &&
      project.scenes.some(
        (scene) =>
          !scene.sceneAssets.some((link) =>
            assetMatchesRevision(
              link.asset.metadata,
              project.revision,
              scene.revision,
            ),
          ),
      )
    ) {
      throw new Error("SCENE_IMAGES_REQUIRED");
    }

    const job = await prisma.generationJob.create({
      data: {
        projectId,
        type: "RENDER",
        status: "QUEUED",
        idempotencyKey: `render:${projectId}:${project.revision}:${randomUUID()}`,
        projectRevision: project.revision,
        input: options,
        events: {
          create: { status: "QUEUED", progress: 0, code: "RENDER_QUEUED" },
        },
      },
    });
    await enqueueRender({
      jobId: job.id,
      projectId,
      projectRevision: project.revision,
      ...options,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { status: "RENDERING" },
    });
    return NextResponse.json({ jobId: job.id, status: "QUEUED" }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}