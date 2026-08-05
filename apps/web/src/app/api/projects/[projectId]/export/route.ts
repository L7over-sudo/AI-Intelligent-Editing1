import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const output = await getPrisma().renderOutput.findFirst({
      where: { projectId, project: { ownerId: user.id, deletedAt: null } },
      orderBy: { createdAt: "desc" },
      include: { asset: true },
    });
    if (!output) {
      return NextResponse.json({ error: "OUTPUT_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({
      downloadUrl: `/api/assets/${output.asset.id}/content?download=1`,
      output,
    });
  } catch (error) {
    return apiError(error);
  }
}