import { describe, expect, it } from "vitest";

import {
  createPromptTemplateSchema,
  updatePromptTemplateSchema,
} from "./prompt-template";

describe("prompt template schemas", () => {
  it("trims and accepts a reusable image prompt", () => {
    expect(
      createPromptTemplateSchema.parse({
        name: "  Minimal ink  ",
        content: "  monochrome stick figure, clean background  ",
      }),
    ).toEqual({
      name: "Minimal ink",
      content: "monochrome stick figure, clean background",
    });
  });

  it("requires at least one field when updating", () => {
    expect(() => updatePromptTemplateSchema.parse({})).toThrow();
  });

  it("accepts prompt template content without a character limit", () => {
    const content = "画".repeat(20_000);
    expect(
      createPromptTemplateSchema.parse({
        name: "Long prompt",
        content,
      }).content,
    ).toBe(content);
  });
});
