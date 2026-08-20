import {
  applyNarrationTiming,
  normalizeCoverCopy,
  storyboardSchema,
  type Storyboard,
  type StoryboardScene,
} from "@stickmotion/shared";

import type {
  StoryboardProvider,
  StoryboardRequest,
} from "./storyboard-provider";

const MAX_SCHEMA_SCENE_CHARACTERS = 1_200;
const TARGET_SCENE_CHARACTERS = 28;
const MIN_TRAILING_SCENE_CHARACTERS = 8;
const sentenceBoundaryPattern = /[。.!！？?；;…]/u;
const clauseBoundaryPattern = /[，,：:、]/u;
const closingMarkPattern = /[”’"'）)\]】》〉]/u;

function splitLongClause(clause: string): string[] {
  const characters = Array.from(clause);
  const chunks: string[] = [];
  for (
    let index = 0;
    index < characters.length;
    index += TARGET_SCENE_CHARACTERS
  ) {
    const chunk = characters
      .slice(index, index + TARGET_SCENE_CHARACTERS)
      .join("")
      .trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function splitLongSentence(sentence: string): string[] {
  const characters = Array.from(sentence);
  if (characters.length <= TARGET_SCENE_CHARACTERS) return [sentence];

  const clauses: string[] = [];
  let clause = "";
  for (let index = 0; index < characters.length; index += 1) {
    clause += characters[index]!;
    if (!clauseBoundaryPattern.test(characters[index]!)) continue;
    while (
      index + 1 < characters.length &&
      closingMarkPattern.test(characters[index + 1]!)
    ) {
      index += 1;
      clause += characters[index]!;
    }
    clauses.push(clause);
    clause = "";
  }
  if (clause.trim()) clauses.push(clause);

  const pieces = clauses.flatMap((item) =>
    Array.from(item).length > TARGET_SCENE_CHARACTERS
      ? splitLongClause(item)
      : [item],
  );
  const scenes: string[] = [];
  let buffer = "";
  for (const piece of pieces) {
    const candidate = `${buffer}${piece}`.trim();
    if (buffer && Array.from(candidate).length > TARGET_SCENE_CHARACTERS) {
      scenes.push(buffer.trim());
      buffer = piece;
    } else {
      buffer = candidate;
    }
  }
  if (buffer.trim()) scenes.push(buffer.trim());

  const trailing = scenes.at(-1);
  const previous = scenes.at(-2);
  if (
    trailing &&
    previous &&
    Array.from(trailing).length < MIN_TRAILING_SCENE_CHARACTERS &&
    Array.from(`${previous}${trailing}`).length <= TARGET_SCENE_CHARACTERS
  ) {
    scenes.splice(-2, 2, `${previous}${trailing}`);
  }
  return scenes;
}

function splitSourceText(sourceText: string): string[] {
  const normalized = sourceText.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];

  const characters = Array.from(normalized);
  const sentences: string[] = [];
  let buffer = "";
  const flush = () => {
    const sentence = buffer.trim();
    if (sentence) sentences.push(sentence);
    buffer = "";
  };

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (character === "\n") {
      flush();
      continue;
    }

    buffer += character;
    if (!sentenceBoundaryPattern.test(character)) continue;
    while (
      index + 1 < characters.length &&
      (sentenceBoundaryPattern.test(characters[index + 1]!) ||
        closingMarkPattern.test(characters[index + 1]!))
    ) {
      index += 1;
      buffer += characters[index]!;
    }
    flush();
  }
  flush();

  return sentences.flatMap((sentence) => {
    const sentenceCharacters = Array.from(sentence);
    if (sentenceCharacters.length <= MAX_SCHEMA_SCENE_CHARACTERS) {
      return splitLongSentence(sentence);
    }
    const safeChunks: string[] = [];
    for (
      let index = 0;
      index < sentenceCharacters.length;
      index += MAX_SCHEMA_SCENE_CHARACTERS
    ) {
      safeChunks.push(
        sentenceCharacters
          .slice(index, index + MAX_SCHEMA_SCENE_CHARACTERS)
          .join("")
          .trim(),
      );
    }
    return safeChunks.filter(Boolean).flatMap(splitLongSentence);
  });
}

function subtitleFor(narration: string): string {
  return narration.trim() || "旁白";
}
const poses = [
  "person-pointing",
  "person-thinking",
  "person-standing",
  "person-running",
  "person-celebrating",
] as const;

const supportingAssets = [
  "speech-bubble",
  "question-mark",
  "arrow",
  "clock",
  "chart",
] as const;

const animations: StoryboardScene["animation"][] = [
  { type: "FADE", direction: "IN", intensity: 0.35 },
  { type: "PAN", direction: "RIGHT", intensity: 0.3 },
  { type: "FADE", direction: "IN", intensity: 0.3 },
  { type: "SLIDE", direction: "LEFT", intensity: 0.3 },
];

const transitions: StoryboardScene["transition"]["type"][] = [
  "FADE",
  "DISSOLVE",
  "FADE",
  "DISSOLVE",
];

function makeScene(
  narration: string,
  index: number,
  imagePrompt: string,
  aspectRatio: StoryboardRequest["aspectRatio"],
  videoTemplate: StoryboardRequest["videoTemplate"],
): StoryboardScene {
  const excerpt = Array.from(narration).slice(0, 180).join("");
  const globalPrompt = imagePrompt.trim() || "根据当前分镜内容生成画面";
  const ratioHint =
    videoTemplate === "KNOWLEDGE_BOARD"
      ? "21:9 超宽横屏构图"
      : aspectRatio === "PORTRAIT"
        ? "9:16 竖屏构图"
        : "16:9 横屏构图";
  // The scene content must always reach the image model, so it is placed first
  // and the user’s (potentially very long) global style template is trimmed to
  // fit. Truncating from the end previously cut the scene excerpt away and
  // produced identical, scene-agnostic prompts for every shot.
  const sceneInstruction = `场景内容仅用于理解画面，不要把分镜原文直接显示在画面中：${excerpt}`;
  const fixedTemplateStyle =
    videoTemplate === "KNOWLEDGE_BOARD"
      ? "知识白板固定风格：只使用黑白极简火柴人或简笔人物，圆形头部、细线身体和四肢，搭配少量手绘道具，纯白或极浅背景；禁止真人、摄影写实、真实人体、动漫人物、3D 渲染和复杂彩色背景；即使其他提示词要求不同风格，也必须以火柴人风格为最高优先级"
      : "";
  // No character cap: keep the full scene content and the user's full image
  // prompt template so scene-specific details always reach the image model.
  const visualPrompt = `${sceneInstruction}。${ratioHint}。${globalPrompt}。${fixedTemplateStyle}。不要添加 Logo 或水印。`;

  return {
    narration,
    subtitle: subtitleFor(narration),
    estimatedDuration: 1.5,
    visualPrompt,
    templateElements: [
      {
        assetId: poses[index % poses.length]!,
        x: 0.43,
        y: 0.55,
        scale: 1,
        rotation: 0,
        emphasis: true,
        label: "",
      },
      {
        assetId: supportingAssets[index % supportingAssets.length]!,
        x: 0.7,
        y: 0.32,
        scale: 0.72,
        rotation: index % 2 === 0 ? -6 : 6,
        emphasis: index % 2 === 0,
        label: "",
      },
    ],
    animation: animations[index % animations.length]!,
    transition: {
      type: transitions[index % transitions.length]!,
      duration: index === 0 ? 0.25 : 0.45,
    },
    soundEffects: [],
  };
}

export class LocalStoryboardProvider implements StoryboardProvider {
  async generate(request: StoryboardRequest): Promise<Storyboard> {
    await Promise.resolve();
    const chunks = splitSourceText(request.sourceText);
    const titleSource = chunks[0] ?? request.sourceText;
    const title = Array.from(titleSource).slice(0, 36).join("").trim();
    const summary = Array.from(request.sourceText.trim())
      .slice(0, 160)
      .join("");
    const coverCopy = normalizeCoverCopy({ sourceText: request.sourceText });

    return applyNarrationTiming(
      storyboardSchema.parse({
        title: title || "未命名视频",
        summary: summary || "本地生成的视频分镜",
        coverTitle: coverCopy.title,
        coverSubtitle: coverCopy.subtitle,
        scenes: chunks.map((narration, index) =>
          makeScene(
            narration,
            index,
            request.imagePrompt,
            request.aspectRatio,
            request.videoTemplate,
          ),
        ),
      }),
    );
  }
}
