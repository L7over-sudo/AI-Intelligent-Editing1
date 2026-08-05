import { describe, expect, it, vi } from "vitest";
import { wavDurationMs } from "@stickmotion/media";

import { VoxCPMAudioProvider } from "./voxcpm-audio-provider";

function makePcmWav(durationMs = 100): Uint8Array {
  const sampleRate = 8_000;
  const dataLength = Math.round((sampleRate * durationMs) / 1_000) * 2;
  const output = new Uint8Array(44 + dataLength);
  const view = new DataView(output.buffer);
  const encoder = new TextEncoder();
  output.set(encoder.encode("RIFF"), 0);
  view.setUint32(4, 36 + dataLength, true);
  output.set(encoder.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  output.set(encoder.encode("data"), 36);
  view.setUint32(40, dataLength, true);
  return output;
}

describe("VoxCPMAudioProvider", () => {
  it("calls the local clone endpoint with high-fidelity reference data", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(makePcmWav().buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": "audio/wav" },
      }),
    );
    const provider = new VoxCPMAudioProvider(fetchMock);

    const audio = await provider.generateVoice({
      text: "这是一段克隆配音。",
      referenceAudioPath: "D:\\media\\voice.wav",
      promptText: "这是参考声音里准确说出的原文。",
      serviceUrl: "http://127.0.0.1:9880",
    });

    expect(wavDurationMs(audio)).toBe(100);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9880/v1/voice-clone",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    const body = typeof request?.body === "string" ? request.body : "{}";
    expect(JSON.parse(body)).toMatchObject({
      text: "这是一段克隆配音。",
      reference_audio_path: "D:\\media\\voice.wav",
      prompt_text: "这是参考声音里准确说出的原文。",
      inference_timesteps: 20,
      normalize: true,
    });
  });

  it("rejects non-local service URLs", async () => {
    const provider = new VoxCPMAudioProvider(vi.fn<typeof fetch>());
    await expect(
      provider.generateVoice({
        text: "test",
        referenceAudioPath: "D:\\media\\voice.wav",
        promptText: "",
        serviceUrl: "https://example.com",
      }),
    ).rejects.toThrow();
  });

  it("reports a stable error when the local service is unavailable", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    const provider = new VoxCPMAudioProvider(fetchMock);

    await expect(
      provider.generateVoice({
        text: "test",
        referenceAudioPath: "D:\\media\\voice.wav",
        promptText: "",
        serviceUrl: "http://127.0.0.1:9880",
      }),
    ).rejects.toThrow("VOXCPM_SERVICE_UNAVAILABLE");
  });

  it("keeps a bounded local service error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: "VOXCPM_GPU_MEMORY_LOW" }), {
        status: 507,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new VoxCPMAudioProvider(fetchMock);

    await expect(
      provider.generateVoice({
        text: "test",
        referenceAudioPath: "D:\\media\\voice.wav",
        promptText: "",
        serviceUrl: "http://127.0.0.1:9880",
      }),
    ).rejects.toThrow("VOXCPM_TTS_FAILED_507: VOXCPM_GPU_MEMORY_LOW");
  });

  it("generates a full scene in one request to preserve voice continuity", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(makePcmWav().buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-type": "audio/wav" },
        }),
      ),
    );
    const provider = new VoxCPMAudioProvider(fetchMock);

    const audio = await provider.generateVoice({
      text: "first, second.",
      referenceAudioPath: "D:\\media\\voice.wav",
      promptText: "reference",
      serviceUrl: "http://127.0.0.1:9880",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const texts = fetchMock.mock.calls.map((call) => {
      const body = call[1]?.body;
      const parsed: unknown = JSON.parse(
        typeof body === "string" ? body : "{}",
      );
      if (typeof parsed !== "object" || parsed === null) return undefined;
      const text = (parsed as Record<string, unknown>).text;
      return typeof text === "string" ? text : undefined;
    });
    expect(texts).toEqual(["first, second."]);
    expect(wavDurationMs(audio)).toBe(100);
  });
});
