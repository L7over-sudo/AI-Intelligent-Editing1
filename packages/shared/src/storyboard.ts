import { z } from "zod";

import type { VideoTemplate } from "./video-template";

export const templateAssetIdSchema = z.enum([
  "person-standing",
  "person-pointing",
  "person-thinking",
  "person-running",
  "person-celebrating",
  "desk",
  "laptop",
  "phone",
  "document",
  "arrow",
  "speech-bubble",
  "question-mark",
  "clock",
  "chart",
  "door",
]);

export const templateElementSchema = z
  .object({
    assetId: templateAssetIdSchema,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    scale: z.number().min(0.2).max(3),
    rotation: z.number().min(-180).max(180),
    emphasis: z.boolean(),
    label: z.string().max(40),
  })
  .strict();

export const animationSchema = z
  .object({
    type: z.enum(["NONE", "FADE", "SLIDE", "ZOOM", "PAN", "BOUNCE", "RISE"]),
    direction: z.enum(["NONE", "LEFT", "RIGHT", "UP", "DOWN", "IN", "OUT"]),
    intensity: z.number().min(0).max(1),
  })
  .strict();

export const transitionSchema = z
  .object({
    type: z.enum(["CUT", "FADE", "DISSOLVE", "PUSH", "ZOOM"]),
    duration: z.number().min(0).max(1.5),
  })
  .strict();

export const soundEffectTagSchema = z.enum([
  "pop",
  "click",
  "whoosh",
  "success",
  "error",
  "typing",
  "clock",
  "impact",
  "laughter",
  "applause",
  "cheer",
  "surprise",
  "question",
  "notification",
  "camera",
  "phone",
  "footsteps",
  "door",
  "money",
  "food",
  "cooking",
  "water",
  "nature",
  "traffic",
  "crowd",
  "animal",
  "magic",
  "tension",
  "sad",
  "game",
  "mechanical",
  "sci_fi",
]);

export const soundEffectSchema = z
  .object({
    tag: soundEffectTagSchema,
    offsetRatio: z.number().min(0).max(1),
    gainDb: z.number().min(-24).max(6),
  })
  .strict();

const storyboardSceneShape = {
  narration: z.string().trim().min(1).max(1_200),
  subtitle: z.string().trim().min(1).max(1_200),
  estimatedDuration: z.number().min(1.5),
  visualPrompt: z.string().trim(),
  templateElements: z.array(templateElementSchema).max(12),
  animation: animationSchema,
  transition: transitionSchema,
  soundEffects: z.array(soundEffectSchema).max(5),
} as const;

export const storyboardSceneSchema = z
  .object(storyboardSceneShape)
  .strict()
  .superRefine((scene, context) => {
    if (scene.visualPrompt.length < 8) {
      context.addIssue({
        code: "custom",
        path: ["visualPrompt"],
        message: "Visual scenes require a prompt of at least 8 characters",
      });
    }
    if (scene.templateElements.length < 1) {
      context.addIssue({
        code: "custom",
        path: ["templateElements"],
        message: "Visual scenes require at least one template element",
      });
    }
  });

export const storyboardSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(500),
    // Cover copy is normalized after the storyboard response is parsed. Keep
    // these fields permissive here so a formatting mistake from the model can
    // never discard otherwise valid scenes.
    coverTitle: z.string().trim().max(120).optional(),
    coverSubtitle: z.string().trim().max(240).optional(),
    scenes: z.array(storyboardSceneSchema).min(1),
  })
  .strict();

export const scenePatchSchema = z
  .object(storyboardSceneShape)
  .partial()
  .strict();

export const sceneReorderSchema = z
  .object({
    sceneIds: z.array(z.string().min(1)).min(1),
    expectedProjectRevision: z.number().int().positive(),
  })
  .strict();

export const scriptGenerationInputSchema = z
  .object({
    jobId: z.string().min(1),
    projectId: z.string().min(1),
    projectRevision: z.number().int().positive(),
  })
  .strict();

export type Storyboard = z.infer<typeof storyboardSchema>;
export type StoryboardScene = z.infer<typeof storyboardSceneSchema>;
export type ScriptGenerationInput = z.infer<typeof scriptGenerationInputSchema>;
export type SoundEffectTag = z.infer<typeof soundEffectTagSchema>;
export type SceneAnimation = z.infer<typeof animationSchema>;
export type SceneTransition = z.infer<typeof transitionSchema>;

const fallbackTransitionTypes = [
  "FADE",
  "DISSOLVE",
  "FADE",
  "DISSOLVE",
] as const satisfies readonly SceneTransition["type"][];

const sparsePushInterval = 6;

export function applyTransitionPreference(
  transition: SceneTransition,
  enabled: boolean,
  sceneIndex = 0,
  sceneCount = Number.POSITIVE_INFINITY,
): SceneTransition {
  if (!enabled || sceneIndex >= sceneCount - 1) {
    return { type: "CUT", duration: 0 };
  }

  const fallbackType =
    fallbackTransitionTypes[sceneIndex % fallbackTransitionTypes.length] ??
    "FADE";
  const type =
    transition.type === "CUT" ||
    transition.type === "PUSH" ||
    transition.type === "ZOOM"
      ? fallbackType
      : transition.type;
  const duration = Math.min(
    1.5,
    Math.max(0.25, transition.duration > 0 ? transition.duration : 0.35),
  );

  return transitionSchema.parse({ type, duration });
}

export function applyAnimationPreference(
  animation: SceneAnimation,
  sceneIndex: number,
): SceneAnimation {
  if (animation.type === "ZOOM") {
    return {
      type: "FADE",
      direction: "IN",
      intensity: Math.min(animation.intensity, 0.35),
    };
  }
  if (
    animation.type !== "SLIDE" ||
    animation.direction !== "LEFT" ||
    sceneIndex % sparsePushInterval === sparsePushInterval - 1
  ) {
    return animation;
  }

  return {
    type: "FADE",
    direction: "IN",
    intensity: Math.min(animation.intensity, 0.35),
  };
}

export function getStoryboardDuration(storyboard: Storyboard): number {
  return storyboard.scenes.reduce(
    (total, scene) => total + scene.estimatedDuration,
    0,
  );
}

export function estimateNarrationDuration(narration: string): number {
  const text = narration.trim();
  const cjkCharacters =
    text.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    )?.length ?? 0;
  const nonCjkText = text.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    " ",
  );
  const words =
    nonCjkText.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?/gu)?.length ?? 0;
  const pauses = text.match(/[，。！？；：,.!?;:…]/gu)?.length ?? 0;
  const seconds = cjkCharacters / 4 + words / 2.6 + pauses * 0.12;
  return Math.max(1.5, Math.round(seconds * 10) / 10);
}

export function applyNarrationTiming(storyboard: Storyboard): Storyboard {
  return storyboardSchema.parse({
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => ({
      ...scene,
      estimatedDuration: estimateNarrationDuration(scene.narration),
    })),
  });
}

export function createStoryboardPrompt(input: {
  sourceText: string;
  sourceKind: "TOPIC" | "FULL_TEXT";
  aspectRatio: "PORTRAIT" | "LANDSCAPE";
  language: string;
  accentColor: string;
  imagePrompt: string;
  videoTemplate?: VideoTemplate;
}): string {
  return [
    "Create an engaging stick-figure video storyboard.",
    `Input kind: ${input.sourceKind}.`,
    `Aspect ratio: ${
      input.videoTemplate === "KNOWLEDGE_BOARD"
        ? "21:9 ultrawide horizontal"
        : input.aspectRatio === "PORTRAIT"
          ? "9:16 vertical"
          : "16:9 horizontal"
    }.`,
    ...(input.videoTemplate === "IMPACT_CAPTIONS"
      ? [
          "This is a text-led 16:9 video: every subtitle cue is revealed in sequence as large impact text, while earlier cues remain visible until the visual scene changes.",
          "Cover the complete source in its original order. Use concise natural clauses so every important part of the full text appears on screen; never skip content merely to create sparse highlights.",
          "Use strong contrast, question, answer, warning, or conclusion wording only where the source supports it; do not invent clickbait claims.",
        ]
      : []),
    ...(input.videoTemplate === "KNOWLEDGE_BOARD"
      ? [
          "Knowledge Board has a non-negotiable visual style: every generated scene must use classic minimalist black-and-white stick figures with round heads, thin ink-line bodies and simple hand-drawn props on a clean white or very light background.",
          "Never use photography, photorealistic people, realistic anatomy, anime characters, 3D renders or cinematic photo backgrounds for Knowledge Board, even if the user image prompt or a character reference requests them.",
        ]
      : []),
    `Narration and subtitles language: ${input.language}.`,
    `Visual style: minimalist black-and-white SVG stick figures with one accent color ${input.accentColor}.`,
    `User image prompt: ${input.imagePrompt}. Apply it consistently to every scene image.`,
    "Use only the provided template asset IDs. Subtitle text must preserve narration punctuation for cue timing.",
    "Derive the natural video length from the complete narration; never pad or truncate to a preset duration.",
    "For FULL_TEXT, cover the complete source text. For TOPIC, choose a natural script length based on the idea complexity.",
    "For FULL_TEXT, preserve the original order. Short complete sentences normally use one visual scene.",
    "If one sentence exceeds about 28 CJK characters, split it into additional visual scenes at natural comma, colon, enumeration-comma, or semantic clause boundaries.",
    "Do not leave a visual scene with a dense paragraph. Prefer roughly 12 to 28 CJK characters per scene while avoiding tiny fragments.",
    "For TOPIC, write a naturally punctuated script and use the same scene-density rule.",
    "Every visual scene produces exactly one visualPrompt for one image and may contain one or more punctuation-delimited subtitle cues.",
    "Do not create one image per subtitle cue.",
    "Every visualPrompt must describe the scene visually. Use the storyboard content only to understand the scene.",
    "Do not copy the storyboard text verbatim into the image. Never add logos or watermarks.",
    "Sound effects should be sparse and semantically motivated.",
    "For FULL_TEXT, preserve meaning and factual claims; do not invent facts.",
    "Also derive a coverTitle of exactly 4 Chinese characters without punctuation, and a coverSubtitle of no more than 12 Chinese characters without punctuation. Make both directly reflect the user's copy and its central conflict.",
    "The estimatedDuration field is provisional and will be recalculated from narration after generation.",
    "",
    "USER INPUT:",
    input.sourceText,
  ].join("\n");
}
