import { NextResponse } from "next/server";
import { z } from "zod";

import { getPrisma } from "@stickmotion/db";
import { LocalObjectStore, objectKeySchema } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

const renderJobOutputSchema = z
  .object({ objectKey: objectKeySchema })
  .passthrough();

const activeRenderStatuses = new Set([
  "QUEUED",
  "RUNNING",
  "RETRYING",
  "CANCEL_REQUESTED",
]);

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string; jobId: string }> },
) {
  try {
    const { projectId, jobId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const job = await prisma.generationJob.findFirst({
      where: {
        id: jobId,
        projectId,
        type: "RENDER",
        project: { ownerId: user.id, deletedAt: null },
      },
      select: {
        id: true,
        status: true,
        projectRevision: true,
        output: true,
      },
    });
    if (!job) throw new Error("RENDER_JOB_NOT_FOUND");
    if (activeRenderStatuses.has(job.status)) {
      throw new Error("RENDER_JOB_ACTIVE");
    }

    const parsedOutput = renderJobOutputSchema.safeParse(job.output);
    const expectedObjectKey = `projects/${projectId}/revisions/${job.projectRevision}/renders/${job.id}.mp4`;
    const candidateObjectKeys = Array.from(
      new Set([
        expectedObjectKey,
        ...(parsedOutput.success ? [parsedOutput.data.objectKey] : []),
      ]),
    );
    const videoAsset = await prisma.asset.findFirst({
      where: {
        projectId,
        kind: "VIDEO_FINAL",
        objectKey: { in: candidateObjectKeys },
      },
      select: {
        id: true,
        objectKey: true,
        renderOutputs: {
          where: { projectId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        },
      },
    });
    const renderOutputId = videoAsset?.renderOutputs[0]?.id;
    let deletedVideoObjectKey: string | null = null;

    await prisma.$transaction(async (tx) => {
      if (renderOutputId) {
        await tx.renderOutput.delete({ where: { id: renderOutputId } });
      }
      if (videoAsset && videoAsset.renderOutputs.length <= 1) {
        await tx.asset.delete({ where: { id: videoAsset.id } });
        deletedVideoObjectKey = videoAsset.objectKey;
      }
      await tx.generationJob.delete({ where: { id: job.id } });

      const remainingOutputs = await tx.renderOutput.count({
        where: { projectId },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { status: remainingOutputs > 0 ? "COMPLETED" : "READY" },
      });
    });

    let localFileDeleted = false;
    if (deletedVideoObjectKey) {
      await new LocalObjectStore().delete(deletedVideoObjectKey);
      localFileDeleted = true;
    }

    return NextResponse.json({
      jobId: job.id,
      deleted: true,
      renderOutputDeleted: Boolean(renderOutputId),
      localFileDeleted,
    });
  } catch (error) {
    return apiError(error);
  }
}
