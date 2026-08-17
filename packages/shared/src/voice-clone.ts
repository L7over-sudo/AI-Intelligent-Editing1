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
        message: "IndexTTS2 服务地址只能使用本机 HTTP 地址",
      });
    }
    if (url.username || url.password || url.pathname !== "/" || url.search) {
      context.addIssue({
        code: "custom",
        message: "IndexTTS2 服务地址只能包含主机和端口",
      });
    }
  })
  .transform((value) => value.replace(/\/+$/u, ""));

const voiceCloneUploadBaseSchema = z.object({
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
  byteSize: z.number().int().positive(),
  consentConfirmed: z.literal(true),
});

const indexTTSVoiceCloneUploadSchema = voiceCloneUploadBaseSchema
  .extend({
    provider: z.literal("indextts2"),
    serviceUrl: localVoiceServiceUrlSchema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(200 * 1024 * 1024),
  })
  .strict();

export const voiceCloneUploadSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const record = value as Record<string, unknown>;
    return record.provider ? record : { ...record, provider: "indextts2" };
  },
  indexTTSVoiceCloneUploadSchema,
);

const indexTTSVoiceCloneReferenceMetadataSchema = z
  .object({
    provider: z.literal("indextts2"),
    purpose: z.literal("voice-clone-reference"),
    originalFileName: z.string().min(1).max(180),
    builtin: z.boolean().optional(),
    // Accepted only for compatibility with profiles created by VoxCPM2.
    promptText: z.string().max(1000).optional(),
    promptLanguage: voiceCloneLanguageSchema.optional(),
    serviceUrl: localVoiceServiceUrlSchema,
    consentConfirmedAt: z.string().datetime(),
  })
  .strict();

export const voiceCloneReferenceMetadataSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const record = value as Record<string, unknown>;
    return record.provider ? record : { ...record, provider: "indextts2" };
  },
  indexTTSVoiceCloneReferenceMetadataSchema,
);

export type VoiceCloneReferenceMetadata = z.infer<
  typeof voiceCloneReferenceMetadataSchema
>;
