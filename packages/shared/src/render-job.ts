import { z } from "zod";

export const renderGenerationInputSchema = z
  .object({
    jobId: z.string().min(1),
    projectId: z.string().min(1),
    projectRevision: z.number().int().positive(),
    watermark: z.string().max(80),
    introTitle: z.boolean(),
    outro: z.boolean(),
  })
  .strict();

export type RenderGenerationInput = z.infer<
  typeof renderGenerationInputSchema
>;

