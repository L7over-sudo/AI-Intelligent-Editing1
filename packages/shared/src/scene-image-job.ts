import { z } from "zod";

export const sceneImageBatchSize = 4 as const;

export const sceneImageSelectionSchema = z
  .object({
    sceneIds: z.array(z.string().min(1)).min(1).max(500),
  })
  .strict();

export const sceneImageGenerationInputSchema = sceneImageSelectionSchema
  .extend({
    jobId: z.string().min(1),
    projectId: z.string().min(1),
    projectRevision: z.number().int().positive(),
  })
  .strict();

export type SceneImageSelection = z.infer<typeof sceneImageSelectionSchema>;
export type SceneImageGenerationInput = z.infer<
  typeof sceneImageGenerationInputSchema
>;
