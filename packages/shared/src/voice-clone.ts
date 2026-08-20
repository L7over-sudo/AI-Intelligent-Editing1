import { z } from "zod";

export const voiceCloneLanguageSchema = z.enum(["zh", "en", "ja", "ko", "yue"]);

export const voiceProviderSchema = z.enum([
  "indextts2",
  "local-clone",
  "qwen3-tts-clone",
  "qwen3-tts-custom",
]);

export type VoiceProvider = z.infer<typeof voiceProviderSchema>;

export const voiceServiceUrlSchema = z
  .string()
  .trim()
  .url()
  .max(200)
  .superRefine((value, context) => {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      context.addIssue({
        code: "custom",
        message: "配音服务地址只能使用 HTTP 或 HTTPS",
      });
    }
    if (url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "配音服务地址不能包含账号或密码",
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
  byteSize: z
    .number()
    .int()
    .positive()
    .max(200 * 1024 * 1024),
  consentConfirmed: z.literal(true),
});

const genericVoiceCloneUploadSchema = voiceCloneUploadBaseSchema
  .extend({
    provider: voiceProviderSchema.default("qwen3-tts-clone"),
    serviceUrl: voiceServiceUrlSchema.optional(),
  })
  .strict();

export const voiceCloneUploadSchema = genericVoiceCloneUploadSchema;

const genericVoiceCloneReferenceMetadataSchema = z
  .object({
    provider: voiceProviderSchema.default("local-clone"),
    purpose: z.literal("voice-clone-reference"),
    originalFileName: z.string().min(1).max(180),
    builtin: z.boolean().optional(),
    speaker: z.string().trim().min(1).max(80).optional(),
    // Accepted for compatibility with older voice-profile records.
    promptText: z.string().max(1000).optional(),
    promptLanguage: voiceCloneLanguageSchema.optional(),
    serviceUrl: voiceServiceUrlSchema.optional(),
    consentConfirmedAt: z.string().datetime(),
  })
  .strict();

export const voiceCloneReferenceMetadataSchema =
  genericVoiceCloneReferenceMetadataSchema;

export type VoiceCloneReferenceMetadata = z.infer<
  typeof voiceCloneReferenceMetadataSchema
>;
