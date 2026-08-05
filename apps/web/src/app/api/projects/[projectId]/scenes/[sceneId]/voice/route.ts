import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { enqueueVoiceGeneration } from "@stickmotion/queue";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string; sceneId: string }> },
) {
  try {
    const { projectId, sceneId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const scene = await prisma.scene.findFirst({
      where: {
        id: sceneId,
        projectId,
        project: { ownerId: user.id, deletedAt: null },
      },
      include: {
        project: {
          include: {
            assets: {
              where: { kind: "VOICE" },
              orderBy: { createdAt: "desc" },
              take: 40,
            },
          },
        },
      },
    });
    if (!scene) throw new Error("SCENE_NOT_FOUND");

    const job = await prisma.generationJob.create({
      data: {
        projectId,
        type: "VOICE",
        status: "QUEUED",
        projectRevision: scene.project.revision,
        idempotencyKey: `voice:${sceneId}:${scene.revision}:${randomUUID()}`,
        input: { sceneId },
        events: {
          create: { status: "QUEUED", progress: 0, code: "VOICE_QUEUED" },
        },
      },
    });
    await enqueueVoiceGeneration({
      jobId: job.id,
      projectId,
      sceneId,
      projectRevision: scene.project.revision,
    });
    return NextResponse.json(
      { jobId: job.id, status: "QUEUED" },
      { status: 202 },
    );
  } catch (error) {
    return apiError(error);
  }
}
