import OpenAI, { toFile } from "openai";

import { alignTextToDuration, type SubtitleCueInput } from "@stickmotion/media";

export interface VoiceGenerationInput {
  text: string;
  voice: string;
  style: string;
}

export class OpenAIAudioProvider {
  readonly #client: OpenAI;
  readonly #ttsModel: string;
  readonly #transcribeModel: string;

  constructor(options?: {
    client?: OpenAI;
    ttsModel?: string;
    transcribeModel?: string;
  }) {
    this.#client = options?.client ?? new OpenAI();
    this.#ttsModel =
      options?.ttsModel ?? process.env.OPENAI_TTS_MODEL ?? "tts-1";
    this.#transcribeModel =
      options?.transcribeModel ??
      process.env.OPENAI_TRANSCRIBE_MODEL ??
      "gpt-4o-transcribe";
  }

  async generateVoice(input: VoiceGenerationInput): Promise<Uint8Array> {
    const response = await this.#client.audio.speech.create({
      model: this.#ttsModel,
      voice: input.voice,
      input: input.text,
      response_format: "wav",
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  async transcribeWithTimestamps(
    audio: Uint8Array,
    fallbackText: string,
    durationMs: number,
  ): Promise<SubtitleCueInput[]> {
    const result = await this.#client.audio.transcriptions.create({
      file: await toFile(audio, "scene.wav", { type: "audio/wav" }),
      model: this.#transcribeModel,
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });
    const segments = (
      result as unknown as {
        segments?: Array<{ start: number; end: number; text: string }>;
      }
    ).segments;

    if (!segments?.length) {
      return alignTextToDuration(fallbackText, durationMs);
    }

    return segments.map((segment) => ({
      startMs: Math.max(0, Math.round(segment.start * 1_000)),
      endMs: Math.min(durationMs, Math.round(segment.end * 1_000)),
      text: segment.text.trim(),
    }));
  }
}

