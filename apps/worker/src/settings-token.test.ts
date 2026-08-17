import { describe, expect, it } from "vitest";

import { openAISettingsInputSchema } from "./settings-server";

describe("third-party image API token", () => {
  it("accepts vendor tokens without assuming an OpenAI key length", () => {
    const input = openAISettingsInputSchema.parse({
      clearApiKey: false,
      apiBaseUrl: "https://api.openai.com/v1",
      clearImageApiKey: false,
      imageApiKey: "x",
      imageApiBaseUrl: "https://www.hfsyapi.cn",
      imageModel: "gpt-image-2",
      imageSize: "1K",
      scriptModel: "local-unused",
    });

    expect(input.imageApiKey).toBe("x");
  });
});
