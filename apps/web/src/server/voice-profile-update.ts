import { z } from "zod";

export const voiceProfileRenameSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
  })
  .strict();

export type VoiceProfileRenameInput = z.infer<typeof voiceProfileRenameSchema>;
