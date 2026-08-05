import { z } from "zod";

export const voiceGenerationInputSchema = z
  .object({
    jobId: z.string().min(1),
    projectId: z.string().min(1),
    sceneId: z.string().min(1),
    projectRevision: z.number().int().positive(),
  })
  .strict();

export type VoiceGenerationInput = z.infer<typeof voiceGenerationInputSchema>;

