import { z } from "zod";

import {
  backgroundMusicVolumeSchema,
  narrationVolumeSchema,
} from "./audio-mix";
import { animationSchema, transitionSchema } from "./storyboard";
import { videoTemplateSchema } from "./video-template";

export const remotionMediaFileSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9._-]+$/u);

export const remotionSubtitleCueSchema = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
    text: z.string().trim().min(1).max(160),
    translation: z.string().trim().min(1).max(240).optional(),
    highlighted: z
      .array(z.string().trim().min(1).max(80))
      .max(24)
      .optional(),
  })
  .strict()
  .refine((cue) => cue.endMs > cue.startMs, {
    message: "Subtitle cue must have a positive duration",
  });

export const remotionSoundEffectSchema = z
  .object({
    file: remotionMediaFileSchema,
    offsetMs: z.number().int().min(0),
    gainDb: z.number().min(-24).max(6),
  })
  .strict();

export const remotionSceneSchema = z
  .object({
    imageFile: remotionMediaFileSchema,
    durationMs: z
      .number()
      .int()
      .min(100)
      .max(15 * 60 * 1_000),
    animation: animationSchema,
    transition: transitionSchema,
    voiceFile: remotionMediaFileSchema.optional(),
    subtitleCues: z.array(remotionSubtitleCueSchema).max(200),
    soundEffects: z.array(remotionSoundEffectSchema).max(50),
  })
  .strict();

export const remotionRenderInputSchema = z
  .object({
    width: z.number().int().min(320).max(4096),
    height: z.number().int().min(320).max(4096),
    fps: z.number().int().min(24).max(60).default(30),
    scenes: z.array(remotionSceneSchema).min(1).max(500),
    narrationFile: remotionMediaFileSchema.optional(),
    backgroundMusicFile: remotionMediaFileSchema.optional(),
    narrationVolume: narrationVolumeSchema,
    backgroundMusicVolume: backgroundMusicVolumeSchema,
    videoTemplate: videoTemplateSchema.default("FULL_BLEED"),
    headerText: z.string().trim().max(120).default(""),
    cornerVariant: z.enum(["BRACKET", "DIAMOND", "DOTS", "LINES"]).optional(),
    subtitleStyle: z
      .object({
        fontSize: z.number().int().min(28).max(96),
        position: z.enum(["TOP", "CENTER", "BOTTOM"]),
        outline: z.boolean(),
        shadow: z.boolean(),
        accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/u),
        fontFamily: z.string().trim().min(1).max(120).optional(),
        fontWeight: z.number().int().min(400).max(900).optional(),
        italic: z.boolean().optional(),
        primaryColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/u)
          .optional(),
        backgroundColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/u)
          .nullable()
          .optional(),
        outlineColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/u)
          .optional(),
        outlineWidth: z.number().min(0).max(8).optional(),
        shadowColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/u)
          .optional(),
        leftVerticalText: z.string().trim().max(120).optional(),
        rightVerticalText: z.string().trim().max(160).optional(),
        mainTitle: z.string().trim().max(60).optional(),
      })
      .strict(),
    watermark: z.string().trim().max(80).default(""),
  })
  .strict()
  .refine((input) => input.width % 2 === 0 && input.height % 2 === 0, {
    message: "Render dimensions must be even",
  });

export type RemotionRenderInput = z.infer<typeof remotionRenderInputSchema>;
