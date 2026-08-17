import { afterEach, describe, expect, it, vi } from "vitest";

import { synthesizeIndexTTSAudio } from "./indextts-audio-provider";

const reference = new Uint8Array([1, 2, 3, 4]);
const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

function stubFetch(implementation: () => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(implementation));
}

describe("synthesizeIndexTTSAudio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a non-loopback service URL", async () => {
    await expect(
      synthesizeIndexTTSAudio({
        serviceUrl: "http://example.com:7851",
        text: "测试",
        referenceAudio: reference,
      }),
    ).rejects.toThrow(/IndexTTS2 服务地址/);
  });

  it("rejects a service URL with a path", async () => {
    await expect(
      synthesizeIndexTTSAudio({
        serviceUrl: "http://127.0.0.1:7851/api",
        text: "测试",
        referenceAudio: reference,
      }),
    ).rejects.toThrow(/IndexTTS2 服务地址/);
  });

  it("posts multipart audio and returns wav bytes", async () => {
    const fetchMock = vi.fn(
      () =>
        new Response(wav, {
          status: 200,
          headers: { "content-type": "audio/wav" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeIndexTTSAudio({
      serviceUrl: "http://127.0.0.1:7851",
      text: " 测试语音 ",
      referenceAudio: reference,
      emoText: " 开心 ",
    });

    expect(result).toEqual(wav);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:7851/api/synthesize");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("text")).toBe("测试语音");
    expect(form.get("emo_text")).toBe("开心");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("throws a stable code on HTTP errors", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    await expect(
      synthesizeIndexTTSAudio({
        serviceUrl: "http://127.0.0.1:7851",
        text: "测试",
        referenceAudio: reference,
      }),
    ).rejects.toThrow("INDEXTTS_SERVICE_HTTP_ERROR_500");
  });

  it("throws when the response is not wav audio", async () => {
    stubFetch(
      () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      synthesizeIndexTTSAudio({
        serviceUrl: "http://127.0.0.1:7851",
        text: "测试",
        referenceAudio: reference,
      }),
    ).rejects.toThrow("INDEXTTS_SERVICE_BAD_RESPONSE");
  });

  it("throws when the service cannot be reached", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(
      synthesizeIndexTTSAudio({
        serviceUrl: "http://127.0.0.1:7851",
        text: "测试",
        referenceAudio: reference,
      }),
    ).rejects.toThrow("INDEXTTS_SERVICE_UNAVAILABLE");
  });

  it("rejects empty text and empty reference audio", async () => {
    await expect(
      synthesizeIndexTTSAudio({
        serviceUrl: "http://127.0.0.1:7851",
        text: "   ",
        referenceAudio: reference,
      }),
    ).rejects.toThrow("VOICE_TEXT_REQUIRED");
    await expect(
      synthesizeIndexTTSAudio({
        serviceUrl: "http://127.0.0.1:7851",
        text: "测试",
        referenceAudio: new Uint8Array(),
      }),
    ).rejects.toThrow("VOICE_REFERENCE_REQUIRED");
  });
});
