import { describe, expect, it } from "vitest";

import {
  voiceCloneReferenceMetadataSchema,
  voiceCloneUploadSchema,
  voiceServiceUrlSchema,
} from "./voice-clone";

describe("voice clone schemas", () => {
  it("accepts an HTTP or HTTPS voice service", () => {
    expect(voiceServiceUrlSchema.parse("http://127.0.0.1:9880")).toBe(
      "http://127.0.0.1:9880",
    );
    expect(voiceServiceUrlSchema.parse("https://example.com/voice")).toBe(
      "https://example.com/voice",
    );
    expect(() => voiceServiceUrlSchema.parse("ftp://example.com")).toThrow();
  });

  it("requires explicit voice ownership consent", () => {
    expect(() =>
      voiceCloneUploadSchema.parse({
        profileName: "测试声音",
        fileName: "voice.wav",
        contentType: "audio/wav",
        byteSize: 1024,
        serviceUrl: "https://example.com/voice",
        consentConfirmed: false,
      }),
    ).toThrow();
  });

  it("accepts a one-minute high-fidelity reference upload", () => {
    const parsed = voiceCloneUploadSchema.parse({
      profileName: "一分钟声音",
      fileName: "one-minute.wav",
      contentType: "audio/wav",
      byteSize: 50 * 1024 * 1024,
      serviceUrl: "https://example.com/voice",
      consentConfirmed: true,
    });
    expect(parsed.byteSize).toBe(50 * 1024 * 1024);
    expect(parsed.provider).toBe("qwen3-tts-clone");
  });

  it("keeps the Qwen built-in speaker in reference metadata", () => {
    const metadata = voiceCloneReferenceMetadataSchema.parse({
      provider: "qwen3-tts-custom",
      purpose: "voice-clone-reference",
      originalFileName: "vivian.wav",
      builtin: true,
      speaker: "Vivian",
      consentConfirmedAt: "2026-08-19T00:00:00.000Z",
    });
    expect(metadata.speaker).toBe("Vivian");
  });
});
