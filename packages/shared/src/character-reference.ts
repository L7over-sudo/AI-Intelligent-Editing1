import { z } from "zod";

export const characterReferenceUploadSchema = z
  .object({
    profileName: z.string().trim().min(1).max(40),
    fileName: z.string().trim().min(1).max(180),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(5 * 1024 * 1024),
  })
  .strict();

export const characterReferenceMetadataSchema = z
  .object({
    purpose: z.literal("character-reference"),
    originalFileName: z.string().min(1).max(180),
  })
  .strict();

export type CharacterReferenceUploadInput = z.infer<
  typeof characterReferenceUploadSchema
>;
