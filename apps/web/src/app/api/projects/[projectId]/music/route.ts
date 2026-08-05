import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getPrisma } from "@stickmotion/db";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

const schema = z
  .object({
    fileName: z.string().min(1).max(180),
    contentType: z.enum(["audio/mpeg", "audio/wav", "audio/mp4"]),
    byteSize: z.number().int().positive().max(50 * 1024 * 1024),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const input = schema.parse(await request.json());
    const { projectId } = await context.params;
    const user = await getCurrentUser();
    const prisma = getPrisma();
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id, deletedAt: null },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");

    const safeName = input.fileName.replaceAll(/[^a-zA-Z0-9._-]/gu, "_");
    const objectKey = `projects/${projectId}/uploads/${randomUUID()}-${safeName}`;
    const asset = await prisma.asset.create({
      data: {
        projectId,
        kind: "BGM",
        bucket: "local",
        objectKey,
        contentType: input.contentType,
        byteSize: BigInt(input.byteSize),
        source: "user-upload",
        license: "user-confirmed",
      },
    });
    return NextResponse.json({
      assetId: asset.id,
      objectKey,
      uploadUrl: `/api/assets/${asset.id}/content`,
      method: "PUT",
    });
  } catch (error) {
    return apiError(error);
  }
}