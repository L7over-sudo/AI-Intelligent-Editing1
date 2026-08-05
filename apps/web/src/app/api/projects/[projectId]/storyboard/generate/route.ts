import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { enqueueScriptGeneration } from "@stickmotion/queue";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");

    const job = await prisma.generationJob.create({
      data: {
        projectId,
        type: "SCRIPT",
        status: "QUEUED",
        idempotencyKey: `script:${projectId}:${project.revision}:${randomUUID()}`,
        projectRevision: project.revision,
        input: { projectId, projectRevision: project.revision },
        events: {
          create: { status: "QUEUED", progress: 0, code: "SCRIPT_QUEUED" },
        },
      },
    });

    await enqueueScriptGeneration({
      jobId: job.id,
      projectId,
      projectRevision: project.revision,
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "GENERATING" },
    });

    return NextResponse.json({ jobId: job.id, status: "QUEUED" }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}