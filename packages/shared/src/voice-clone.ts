import { z } from "zod";

export const voiceCloneLanguageSchema = z.enum(["zh", "en", "ja", "ko", "yue"]);

export const localVoiceServiceUrlSchema = z
  .string()
  .trim()
  .url()
  .max(200)
  .superRefine((value, context) => {
    const url = new URL(value);
    const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
    if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
      context.addIssue({
        code: "custom",
        message: "VoxCPM2 服务地址只能使用本机 HTTP 地址",
      });
    }
    if (url.username || url.password || url.pathname !== "/" || url.search) {
      context.addIssue({
        code: "custom",
        message: "VoxCPM2 服务地址只能包含主机和端口",
      });
    }
  })
  .transform((value) => value.replace(/\/+$/u, ""));

export const voiceCloneUploadSchema = z
  .object({
    profileName: z.string().trim().min(1).max(40),
    fileName: z.string().trim().min(1).max(180),
    contentType: z.enum([
      "audio/wav",
      "audio/x-wav",
      "audio/x-m4a",
      "audio/aac",
      "audio/mpeg",
      "audio/mp4",
      "audio/flac",
      "audio/x-flac",
    ]),
    byteSize: z.number().int().positive().max(200 * 1024 * 1024),
    promptText: z.string().trim().max(500).optional().default(""),
    promptLanguage: voiceCloneLanguageSchema,
    serviceUrl: localVoiceServiceUrlSchema,
    consentConfirmed: z.literal(true),
  })
  .strict();

export const voiceCloneReferenceMetadataSchema = z
  .object({
    purpose: z.literal("voice-clone-reference"),
    originalFileName: z.string().min(1).max(180),
    promptText: z.string().max(1000),
    promptLanguage: voiceCloneLanguageSchema,
    serviceUrl: localVoiceServiceUrlSchema,
    consentConfirmedAt: z.string().datetime(),
  })
  .strict();

export type VoiceCloneReferenceMetadata = z.infer<
  typeof voiceCloneReferenceMetadataSchema
>;