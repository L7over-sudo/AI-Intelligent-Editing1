import { describe, expect, it } from "vitest";

import {
  fitReferencePrompt,
  shouldAutoTranscribe,
} from "./voxcpm-reference";

describe("VoxCPM2 reference preparation", () => {
  it("keeps an exact transcript unchanged", () => {
    expect(fitReferencePrompt("这是参考音频里准确说出的原文。")).toBe(
      "这是参考音频里准确说出的原文。",
    );
  });

  it("bounds unexpectedly long reference text", () => {
    expect(Array.from(fitReferencePrompt("长".repeat(900))).length).toBe(700);
  });

  it("automatically transcribes blank or article-length input", () => {
    expect(shouldAutoTranscribe("")).toBe(true);
    expect(shouldAutoTranscribe("这是参考声音的准确原文。")).toBe(false);
    expect(shouldAutoTranscribe("长".repeat(501))).toBe(true);
  });
});
