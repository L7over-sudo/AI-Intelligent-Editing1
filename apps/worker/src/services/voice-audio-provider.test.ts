import { afterEach, describe, expect, it, vi } from "vitest";

import { synthesizeVoiceAudio } from "./voice-audio-provider";

const reference = new Uint8Array([1, 2, 3, 4]);
const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

function healthResponse(loaded = true, ready = true): Response {
  return new Response(JSON.stringify({ status: "ok", loaded, ready }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("synthesizeVoiceAudio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the Qwen provider and built-in speaker", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.endsWith("/api/health")) return healthResponse();
      return new Response(wav, {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeVoiceAudio({
      serviceUrl: "http://127.0.0.1:7852",
      provider: "qwen3-tts-custom",
      speaker: "Vivian",
      text: " 测试语音 ",
      referenceAudio: reference,
    });

    expect(result).toEqual(wav);
    const call = fetchMock.mock.calls[1];
    if (!call) throw new Error("fetch was not called");
    const [, init] = call as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get("provider")).toBe("qwen3-tts-custom");
    expect(form.get("speaker")).toBe("Vivian");
    expect(form.get("text")).toBe("测试语音");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("does not synthesize while the selected model is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => healthResponse(false, false)),
    );
    await expect(
      synthesizeVoiceAudio({
        serviceUrl: "http://127.0.0.1:7852",
        provider: "qwen3-tts-clone",
        text: "测试",
        referenceAudio: reference,
      }),
    ).rejects.toThrow("VOICE_SERVICE_NOT_READY");
  });
});
