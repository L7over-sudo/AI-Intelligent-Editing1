import { z } from "zod";

export const promptTemplateIdSchema = z.string().trim().min(1).max(100);

export const createPromptTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    content: z.string().trim().min(1),
  })
  .strict();

export const updatePromptTemplateSchema = createPromptTemplateSchema
  .partial()
  .refine(
    (value) => value.name !== undefined || value.content !== undefined,
    "PROMPT_TEMPLATE_UPDATE_REQUIRED",
  );

export type CreatePromptTemplateInput = z.infer<
  typeof createPromptTemplateSchema
>;
export type UpdatePromptTemplateInput = z.infer<
  typeof updatePromptTemplateSchema
>;
