import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const user = await getCurrentUser();
    const job = await getPrisma().generationJob.findFirst({
      where: { id: jobId, project: { ownerId: user.id, deletedAt: null } },
      include: {
        events: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ job });
  } catch (error) {
    return apiError(error);
  }
}
