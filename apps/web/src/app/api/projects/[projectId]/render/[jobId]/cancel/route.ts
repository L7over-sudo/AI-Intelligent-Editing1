import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function POST(
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
        progress: true,
      },
    });
    if (!job) throw new Error("RENDER_JOB_NOT_FOUND");
    if (job.status === "SUCCEEDED" || job.status === "FAILED") {
      throw new Error("RENDER_JOB_NOT_ACTIVE");
    }
    if (job.status === "CANCELED" || job.status === "CANCEL_REQUESTED") {
      return NextResponse.json({ jobId: job.id, status: job.status });
    }

    const queued = job.status === "QUEUED" || job.status === "RETRYING";
    const nextStatus = queued ? "CANCELED" : "CANCEL_REQUESTED";
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: nextStatus,
        ...(nextStatus === "CANCELED"
          ? { finishedAt: new Date(), startedAt: null }
          : {}),
        events: {
          create: {
            status: nextStatus,
            progress: job.progress,
            code:
              nextStatus === "CANCELED"
                ? "RENDER_CANCELED"
                : "RENDER_CANCEL_REQUESTED",
            message:
              nextStatus === "CANCELED" ? "渲染已取消" : "正在取消渲染",
          },
        },
      },
    });

    const activeJobs = await prisma.generationJob.count({
      where: {
        projectId,
        status: { in: ["QUEUED", "RUNNING", "RETRYING"] },
      },
    });
    if (activeJobs === 0) {
      const outputs = await prisma.renderOutput.count({
        where: { projectId },
      });
      await prisma.project.update({
        where: { id: projectId },
        data: { status: outputs > 0 ? "COMPLETED" : "READY" },
      });
    }
    return NextResponse.json({ jobId: job.id, status: nextStatus });
  } catch (error) {
    return apiError(error);
  }
}
