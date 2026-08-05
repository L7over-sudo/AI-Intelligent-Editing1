import { z } from "zod";

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
    type: z.enum(["NONE", "FADE", "SLIDE", "ZOOM", "PAN", "BOUNCE"]),
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
  isTextOpening: z.boolean().default(false),
} as const;

export const storyboardSceneSchema = z
  .object(storyboardSceneShape)
  .strict()
  .superRefine((scene, context) => {
    if (scene.isTextOpening) {
      if (scene.visualPrompt.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["visualPrompt"],
          message: "Text opening scenes must not have a visual prompt",
        });
      }
      if (scene.templateElements.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["templateElements"],
          message: "Text opening scenes must not have template elements",
        });
      }
      return;
    }
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
    scenes: z.array(storyboardSceneSchema).min(1),
  })
  .strict();

export const scenePatchSchema = z.object(storyboardSceneShape).partial().strict();

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
export type SceneTransition = z.infer<typeof transitionSchema>;

export function applyTransitionPreference(
  transition: SceneTransition,
  enabled: boolean,
): SceneTransition {
  return transitionSchema.parse(
    enabled ? transition : { type: "CUT", duration: 0 },
  );
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

const openingSentenceBoundaryPattern = /[。.!！？?；;…]/u;
const openingClosingMarkPattern = /[”’"'）)\]】》〉]/u;

export function splitFirstSentence(
  sourceText: string,
): { firstSentence: string; remainingText: string } {
  const normalized = sourceText.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return { firstSentence: "", remainingText: "" };

  const characters = Array.from(normalized);
  let buffer = "";
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    buffer += character;
    if (!openingSentenceBoundaryPattern.test(character)) continue;
    while (
      index + 1 < characters.length &&
      (openingSentenceBoundaryPattern.test(characters[index + 1]!) ||
        openingClosingMarkPattern.test(characters[index + 1]!))
    ) {
      index += 1;
      buffer += characters[index]!;
    }
    const firstSentence = buffer.trim();
    const remainingText = characters.slice(index + 1).join("").trim();
    return { firstSentence, remainingText };
  }

  return { firstSentence: normalized, remainingText: "" };
}

export function formatTextOpening(text: string): {
  singleLine: string;
  displayText: string;
  lines: readonly string[];
} {
  const singleLine = text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(singleLine);
  if (characters.length <= 13) {
    return {
      singleLine,
      displayText: singleLine,
      lines: singleLine ? [singleLine] : [],
    };
  }

  const midpoint = Math.ceil(characters.length / 2);
  let splitAt = midpoint;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < characters.length; index += 1) {
    if (characters[index] !== " ") continue;
    const distance = Math.abs(index - midpoint);
    if (distance < bestDistance) {
      bestDistance = distance;
      splitAt = index;
    }
  }
  if (splitAt < 3 || splitAt > characters.length - 3) {
    splitAt = midpoint;
  }

  const firstLine = characters.slice(0, splitAt).join("").trim();
  const secondLine = characters.slice(splitAt).join("").trim();
  const lines = [firstLine, secondLine].filter(Boolean);
  return {
    singleLine,
    displayText: lines.join("\n"),
    lines,
  };
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
}): string {
  return [
    "Create an engaging stick-figure video storyboard.",
    `Input kind: ${input.sourceKind}.`,
    `Aspect ratio: ${input.aspectRatio === "PORTRAIT" ? "9:16 vertical" : "16:9 horizontal"}.`,
    `Narration and subtitles language: ${input.language}.`,
    `Visual style: minimalist black-and-white SVG stick figures with one accent color ${input.accentColor}.`,
    `User image prompt: ${input.imagePrompt}. Apply it consistently to every scene image.`,
    "Use only the provided template asset IDs. Subtitle text must preserve narration punctuation for cue timing.",
    "Derive the natural video length from the complete narration; never pad or truncate to a preset duration.",
    "For FULL_TEXT, cover the complete source text. For TOPIC, choose a natural script length based on the idea complexity.",
    "For FULL_TEXT, preserve the original order. Short complete sentences normally use one visual scene.",
    "If one sentence exceeds about 32 CJK characters, split it into additional visual scenes at natural comma, colon, enumeration-comma, or semantic clause boundaries.",
    "Do not leave a visual scene with a dense paragraph. Prefer roughly 12 to 32 CJK characters per scene while avoiding tiny fragments.",
    "For TOPIC, write a naturally punctuated script and use the same scene-density rule.",
    "Every visual scene produces exactly one visualPrompt for one image and may contain one or more punctuation-delimited subtitle cues.",
    "Do not create one image per subtitle cue.",
    "Every visualPrompt must describe the scene visually. Use the storyboard content only to understand the scene.",
    "Do not copy the storyboard text verbatim into the image. Never add logos or watermarks.",
    "Sound effects should be sparse and semantically motivated.",
    "For FULL_TEXT, preserve meaning and factual claims; do not invent facts.",
    "The estimatedDuration field is provisional and will be recalculated from narration after generation.",
    "",
    "USER INPUT:",
    input.sourceText,
  ].join("\n");
}
