import { describe, expect, it } from "vitest";

import {
  localVoiceServiceUrlSchema,
  voiceCloneUploadSchema,
} from "./voice-clone";

describe("voice clone schemas", () => {
  it("accepts only a loopback VoxCPM2 service", () => {
    expect(localVoiceServiceUrlSchema.parse("http://127.0.0.1:9880")).toBe(
      "http://127.0.0.1:9880",
    );
    expect(() =>
      localVoiceServiceUrlSchema.parse("https://example.com"),
    ).toThrow();
    expect(() =>
      localVoiceServiceUrlSchema.parse("http://192.168.1.20:9880"),
    ).toThrow();
  });

  it("requires explicit voice ownership consent", () => {
    expect(() =>
      voiceCloneUploadSchema.parse({
        profileName: "测试声音",
        fileName: "voice.wav",
        contentType: "audio/wav",
        byteSize: 1024,
        promptText: "这是参考音频里说出的原文。",
        promptLanguage: "zh",
        serviceUrl: "http://localhost:9880",
        consentConfirmed: false,
      }),
    ).toThrow();
  });

  it("accepts a one-minute high-fidelity reference upload", () => {
    expect(
      voiceCloneUploadSchema.parse({
        profileName: "一分钟声音",
        fileName: "one-minute.wav",
        contentType: "audio/wav",
        byteSize: 50 * 1024 * 1024,
        promptText: "",
        promptLanguage: "zh",
        serviceUrl: "http://127.0.0.1:9880",
        consentConfirmed: true,
      }).byteSize,
    ).toBe(50 * 1024 * 1024);
  });
});