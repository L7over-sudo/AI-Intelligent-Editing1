import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { createPromptTemplateSchema } from "@stickmotion/shared";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const templates = await getPrisma().promptTemplate.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ templates });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const input = createPromptTemplateSchema.parse(await request.json());
    const template = await getPrisma().promptTemplate.upsert({
      where: {
        ownerId_name: { ownerId: user.id, name: input.name },
      },
      update: { content: input.content },
      create: {
        ownerId: user.id,
        name: input.name,
        content: input.content,
      },
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
