import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getPrisma } from "@stickmotion/db";
import { enqueueJianyingDraft } from "@stickmotion/queue";
import { jianyingDraftCreateOutputSchema } from "@stickmotion/shared";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE") }).strict(),
  z
    .object({
      action: z.literal("INSTALL"),
      draftJobId: z.string().min(1),
    })
    .strict(),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const body = requestSchema.parse(await request.json());
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
      select: {
        id: true,
        revision: true,
        renderOutputs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { projectRevision: true },
        },
      },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (
      !project.renderOutputs[0] ||
      project.renderOutputs[0].projectRevision !== project.revision
    ) {
      throw new Error("CURRENT_RENDER_REQUIRED");
    }

    if (body.action === "INSTALL") {
      const sourceJob = await prisma.generationJob.findFirst({
        where: {
          id: body.draftJobId,
          projectId,
          projectRevision: project.revision,
          type: "JIANYING_DRAFT",
          status: "SUCCEEDED",
        },
        select: { output: true },
      });
      if (!sourceJob) throw new Error("JIANYING_SOURCE_DRAFT_NOT_FOUND");
      jianyingDraftCreateOutputSchema.parse(sourceJob.output);
    }

    const job = await prisma.generationJob.create({
      data: {
        projectId,
        type: "JIANYING_DRAFT",
        status: "QUEUED",
        maxAttempts: body.action === "INSTALL" ? 1 : 2,
        idempotencyKey: `jianying:${body.action.toLowerCase()}:${projectId}:${project.revision}:${randomUUID()}`,
        projectRevision: project.revision,
        input: body,
        events: {
          create: {
            status: "QUEUED",
            progress: 0,
            code:
              body.action === "CREATE"
                ? "JIANYING_DRAFT_CREATE_QUEUED"
                : "JIANYING_DRAFT_INSTALL_QUEUED",
          },
        },
      },
    });
    await enqueueJianyingDraft({
      jobId: job.id,
      projectId,
      projectRevision: project.revision,
      ...body,
    });
    return NextResponse.json(
      { jobId: job.id, status: "QUEUED", action: body.action },
      { status: 202 },
    );
  } catch (error) {
    return apiError(error);
  }
}
