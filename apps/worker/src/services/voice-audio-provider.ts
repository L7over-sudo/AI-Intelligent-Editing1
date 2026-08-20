import { voiceServiceUrlSchema } from "@stickmotion/shared";
import { z } from "zod";

export const VOICE_SYNTHESIS_TIMEOUT_MS = 10 * 60_000;
export const VOICE_HEALTH_TIMEOUT_MS = 5_000;
export const VOICE_REFERENCE_MAX_BYTES = 200 * 1024 * 1024;

const voiceServiceHealthSchema = z
  .object({
    status: z.string().optional(),
    loaded: z.boolean().optional(),
    ready: z.boolean().optional(),
  })
  .passthrough();

export interface VoiceAudioRequest {
  serviceUrl: string;
  provider: string;
  text: string;
  referenceAudio: Uint8Array;
  speaker?: string;
  emoText?: string;
  timeoutMs?: number;
}

export function voiceServiceUrl(value: string): string {
  return voiceServiceUrlSchema.parse(value);
}

async function assertVoiceServiceReady(serviceUrl: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOICE_HEALTH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${serviceUrl}/api/health`, {
        method: "GET",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("VOICE_SERVICE_TIMEOUT", { cause: error });
      }
      throw new Error("VOICE_SERVICE_UNAVAILABLE", { cause: error });
    }
    if (!response.ok) {
      throw new Error(`VOICE_SERVICE_HTTP_ERROR_${response.status}`);
    }
    const health = voiceServiceHealthSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (
      !health.success ||
      health.data.ready === false ||
      health.data.loaded === false
    ) {
      throw new Error("VOICE_SERVICE_NOT_READY");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeVoiceAudio(
  request: VoiceAudioRequest,
): Promise<Uint8Array> {
  const serviceUrl = voiceServiceUrl(request.serviceUrl);
  const text = request.text.trim();
  if (!text) throw new Error("VOICE_TEXT_REQUIRED");
  if (request.referenceAudio.byteLength === 0) {
    throw new Error("VOICE_REFERENCE_REQUIRED");
  }
  if (request.referenceAudio.byteLength > VOICE_REFERENCE_MAX_BYTES) {
    throw new Error("VOICE_REFERENCE_TOO_LARGE");
  }

  await assertVoiceServiceReady(serviceUrl);

  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? VOICE_SYNTHESIS_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append("provider", request.provider);
    form.append("text", text);
    const speaker = request.speaker?.trim();
    if (speaker) form.append("speaker", speaker);
    form.append(
      "file",
      new Blob([request.referenceAudio as BlobPart], {
        type: "audio/wav",
      }),
      "reference.wav",
    );
    const emoText = request.emoText?.trim();
    if (emoText) form.append("emo_text", emoText);

    let response: Response;
    try {
      response = await fetch(`${serviceUrl}/api/synthesize`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("VOICE_SERVICE_TIMEOUT", { cause: error });
      }
      throw new Error("VOICE_SERVICE_UNAVAILABLE", { cause: error });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `VOICE_SERVICE_HTTP_ERROR_${response.status}${
          detail ? `: ${detail.slice(0, 200)}` : ""
        }`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^audio\/wav(?:;|$)/iu.test(contentType.trim())) {
      throw new Error("VOICE_SERVICE_BAD_RESPONSE");
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) {
      throw new Error("VOICE_SERVICE_BAD_RESPONSE");
    }
    return audio;
  } finally {
    clearTimeout(timeout);
  }
}
