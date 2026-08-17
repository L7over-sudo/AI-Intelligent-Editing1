import { describe, expect, it } from "vitest";

import { allowsTemplateSafeFfmpegFallback } from "./render-fallback-policy";

describe("allowsTemplateSafeFfmpegFallback", () => {
  it("never replaces the knowledge-board template with the FFmpeg fallback", () => {
    expect(allowsTemplateSafeFfmpegFallback("KNOWLEDGE_BOARD", undefined)).toBe(
      false,
    );
  });

  it("keeps the legacy full-bleed fallback unless it is explicitly disabled", () => {
    expect(allowsTemplateSafeFfmpegFallback("FULL_BLEED", undefined)).toBe(true);
    expect(allowsTemplateSafeFfmpegFallback("FULL_BLEED", "false")).toBe(false);
  });
});
