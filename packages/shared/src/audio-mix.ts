import { z } from "zod";

export const narrationVolumeSchema = z
  .number()
  .finite()
  .min(0)
  .max(2)
  .default(1);

export const backgroundMusicVolumeSchema = z
  .number()
  .finite()
  .min(0)
  .max(1)
  .default(0.1);

export const projectAudioMixSchema = z
  .object({
    narrationVolume: narrationVolumeSchema,
    backgroundMusicVolume: backgroundMusicVolumeSchema,
  })
  .strict();

export type ProjectAudioMix = z.infer<typeof projectAudioMixSchema>;
