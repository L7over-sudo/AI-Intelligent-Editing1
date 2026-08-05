import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import {
  promptTemplateIdSchema,
  updatePromptTemplateSchema,
} from "@stickmotion/shared";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

type RouteContext = {
  params: Promise<{ templateId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { templateId: rawTemplateId } = await context.params;
    const templateId = promptTemplateIdSchema.parse(rawTemplateId);
    const user = await getCurrentUser();
    const input = updatePromptTemplateSchema.parse(await request.json());
    const data: { name?: string; content?: string } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.content !== undefined) data.content = input.content;

    const result = await getPrisma().promptTemplate.updateMany({
      where: { id: templateId, ownerId: user.id },
      data,
    });
    if (result.count === 0) throw new Error("PROMPT_TEMPLATE_NOT_FOUND");

    const template = await getPrisma().promptTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) throw new Error("PROMPT_TEMPLATE_NOT_FOUND");
    return NextResponse.json({ template });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { templateId: rawTemplateId } = await context.params;
    const templateId = promptTemplateIdSchema.parse(rawTemplateId);
    const user = await getCurrentUser();
    const result = await getPrisma().promptTemplate.deleteMany({
      where: { id: templateId, ownerId: user.id },
    });
    if (result.count === 0) throw new Error("PROMPT_TEMPLATE_NOT_FOUND");
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
