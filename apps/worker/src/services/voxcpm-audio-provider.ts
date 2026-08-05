import {
  alignTextToSpeechPauses,
  type SubtitleCueInput,
} from "@stickmotion/media";
import { localVoiceServiceUrlSchema } from "@stickmotion/shared";

export interface ClonedVoiceInput {
  text: string;
  referenceAudioPath: string;
  promptText: string;
  serviceUrl: string;
  cfgValue?: number;
  inferenceTimesteps?: number;
}

export interface VoiceAudioProvider {
  generateVoice(input: ClonedVoiceInput): Promise<Uint8Array>;
  transcribeWithTimestamps(
    audio: Uint8Array,
    fallbackText: string,
    durationMs: number,
  ): Promise<SubtitleCueInput[]>;
}

export class VoxCPMAudioProvider implements VoiceAudioProvider {
  readonly #fetch: typeof fetch;

  constructor(fetchImplementation: typeof fetch = fetch) {
    this.#fetch = fetchImplementation;
  }

  async generateVoice(input: ClonedVoiceInput): Promise<Uint8Array> {
    const serviceUrl = localVoiceServiceUrlSchema.parse(input.serviceUrl);
    const text = input.text.trim();
    if (!text) throw new Error("VOXCPM_TEXT_REQUIRED");
    return this.#generateSegment(input, serviceUrl, text);
  }

  async #generateSegment(
    input: ClonedVoiceInput,
    serviceUrl: string,
    text: string,
  ): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await this.#fetch(`${serviceUrl}/v1/voice-clone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          reference_audio_path: input.referenceAudioPath,
          prompt_text: input.promptText,
          cfg_value: input.cfgValue ?? 2,
          inference_timesteps: input.inferenceTimesteps ?? 20,
          normalize: true,
        }),
      });
    } catch {
      throw new Error("VOXCPM_SERVICE_UNAVAILABLE");
    }
    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(
        message
          ? `VOXCPM_TTS_FAILED_${response.status}: ${message}`
          : `VOXCPM_TTS_FAILED_${response.status}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("audio/")) {
      throw new Error("VOXCPM_AUDIO_RESPONSE_REQUIRED");
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0 || audio.byteLength > 100 * 1024 * 1024) {
      throw new Error("VOXCPM_AUDIO_SIZE_INVALID");
    }
    return audio;
  }

  transcribeWithTimestamps(
    _audio: Uint8Array,
    fallbackText: string,
    durationMs: number,
  ): Promise<SubtitleCueInput[]> {
    return Promise.resolve(alignTextToSpeechPauses(fallbackText, durationMs));
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as {
      detail?: unknown;
      message?: unknown;
    };
    return [parsed.detail, parsed.message]
      .filter((value): value is string => typeof value === "string")
      .join(": ")
      .replaceAll(/\s+/gu, " ")
      .slice(0, 800);
  } catch {
    return body.replaceAll(/\s+/gu, " ").slice(0, 800);
  }
}
