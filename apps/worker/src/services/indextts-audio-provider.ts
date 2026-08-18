import { localVoiceServiceUrlSchema } from "@stickmotion/shared";
import { z } from "zod";

export const INDEX_TTS_SYNTHESIS_TIMEOUT_MS = 10 * 60_000;
export const INDEX_TTS_HEALTH_TIMEOUT_MS = 5_000;
export const INDEX_TTS_REFERENCE_MAX_BYTES = 200 * 1024 * 1024;

const indexTtsHealthSchema = z
  .object({
    status: z.string(),
    loaded: z.boolean(),
    ready: z.boolean().optional(),
  })
  .passthrough();

export interface IndexTTSAudioRequest {
  serviceUrl: string;
  text: string;
  referenceAudio: Uint8Array;
  emoText?: string;
  timeoutMs?: number;
}

export function indexTtsServiceUrl(value: string): string {
  return localVoiceServiceUrlSchema.parse(value);
}

async function assertIndexTtsReady(serviceUrl: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    INDEX_TTS_HEALTH_TIMEOUT_MS,
  );
  try {
    let response: Response;
    try {
      response = await fetch(`${serviceUrl}/api/health`, {
        method: "GET",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("INDEXTTS_SERVICE_TIMEOUT", { cause: error });
      }
      throw new Error("INDEXTTS_SERVICE_UNAVAILABLE", { cause: error });
    }
    if (!response.ok) {
      throw new Error(`INDEXTTS_SERVICE_HTTP_ERROR_${response.status}`);
    }
    const health = indexTtsHealthSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!health.success || !health.data.loaded || health.data.ready === false) {
      throw new Error("INDEXTTS_SERVICE_NOT_READY");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeIndexTTSAudio(
  request: IndexTTSAudioRequest,
): Promise<Uint8Array> {
  const serviceUrl = indexTtsServiceUrl(request.serviceUrl);
  const text = request.text.trim();
  if (!text) throw new Error("VOICE_TEXT_REQUIRED");
  if (request.referenceAudio.byteLength === 0) {
    throw new Error("VOICE_REFERENCE_REQUIRED");
  }
  if (request.referenceAudio.byteLength > INDEX_TTS_REFERENCE_MAX_BYTES) {
    throw new Error("VOICE_REFERENCE_TOO_LARGE");
  }

  await assertIndexTtsReady(serviceUrl);

  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? INDEX_TTS_SYNTHESIS_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append("text", text);
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
        throw new Error("INDEXTTS_SERVICE_TIMEOUT", { cause: error });
      }
      throw new Error("INDEXTTS_SERVICE_UNAVAILABLE", { cause: error });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `INDEXTTS_SERVICE_HTTP_ERROR_${response.status}${
          detail ? `: ${detail.slice(0, 200)}` : ""
        }`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^audio\/wav(?:;|$)/iu.test(contentType.trim())) {
      throw new Error("INDEXTTS_SERVICE_BAD_RESPONSE");
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) {
      throw new Error("INDEXTTS_SERVICE_BAD_RESPONSE");
    }
    return audio;
  } finally {
    clearTimeout(timeout);
  }
}
