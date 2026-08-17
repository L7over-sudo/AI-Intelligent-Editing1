import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  applyNarrationTiming,
  createStoryboardPrompt,
  normalizeCoverCopy,
  storyboardSchema,
  type Storyboard,
  type VideoTemplate,
} from "@stickmotion/shared";

export interface StoryboardRequest {
  sourceText: string;
  sourceKind: "TOPIC" | "FULL_TEXT";
  aspectRatio: "PORTRAIT" | "LANDSCAPE";
  language: string;
  accentColor: string;
  imagePrompt: string;
  videoTemplate?: VideoTemplate;
}

export interface StoryboardProvider {
  generate(request: StoryboardRequest): Promise<Storyboard>;
}

export class OpenAIStoryboardProvider implements StoryboardProvider {
  readonly #client: OpenAI;
  readonly #model: string;

  constructor(options?: { client?: OpenAI; model?: string }) {
    this.#client = options?.client ?? new OpenAI();
    this.#model =
      options?.model ?? process.env.OPENAI_SCRIPT_MODEL ?? "claude-sonnet-5";
  }

  async generate(request: StoryboardRequest): Promise<Storyboard> {
    const response = await this.#client.responses.parse({
      model: this.#model,
      instructions: [
        "You are a video scriptwriter and storyboard director.",
        "Return only the requested structured output.",
        "All positions use normalized 0..1 coordinates.",
        "Do not include copyrighted characters, brands, or unverified claims.",
      ].join(" "),
      input: createStoryboardPrompt(request),
      text: {
        format: zodTextFormat(storyboardSchema, "stickmotion_storyboard"),
      },
    });

    if (!response.output_parsed) {
      throw new Error("OPENAI_STRUCTURED_OUTPUT_MISSING");
    }

    const storyboard = storyboardSchema.parse(response.output_parsed);
    const coverCopy = normalizeCoverCopy({
      sourceText: request.sourceText,
      ...(storyboard.coverTitle !== undefined
        ? { title: storyboard.coverTitle }
        : {}),
      ...(storyboard.coverSubtitle !== undefined
        ? { subtitle: storyboard.coverSubtitle }
        : {}),
    });
    return applyNarrationTiming({
      ...storyboard,
      coverTitle: coverCopy.title,
      coverSubtitle: coverCopy.subtitle,
    });
  }
}
