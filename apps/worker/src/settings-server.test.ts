import { describe, expect, it } from "vitest";

import {
  musicLibrarySettingsInputSchema,
  openAISettingsInputSchema,
  parseEnvFile,
  updateEnvFile,
} from "./settings-server";

describe("worker-only API settings", () => {
  it("updates image settings without changing unrelated entries", () => {
    const source =
      "DATABASE_URL=file:./storage/app.db\nIMAGE_API_KEY=old-secret\n";
    const updated = updateEnvFile(source, {
      IMAGE_API_KEY: "new-secret",
      IMAGE_API_MODEL: "nano-banana-pro",
      IMAGE_API_SIZE: "2K",
    });
    expect(updated).toContain("DATABASE_URL=file:./storage/app.db");
    expect(updated).toContain("IMAGE_API_KEY=new-secret");
    expect(updated).toContain("IMAGE_API_MODEL=nano-banana-pro");
  });

  it("accepts valid gpt-image-2 and 1K settings", () => {
    const parsed = openAISettingsInputSchema.parse({
      clearApiKey: false,
      apiBaseUrl: "https://api.openai.com/v1",
      clearImageApiKey: false,
      imageApiBaseUrl: "https://www.hfsyapi.cn",
      imageModel: "gpt-image-2",
      imageSize: "1K",
      scriptModel: "gpt-4.1-mini",
    });
    expect(parsed.imageApiKey).toBeUndefined();
    expect(parseEnvFile("IMAGE_API_KEY=secret\n").get("IMAGE_API_KEY")).toBe(
      "secret",
    );
  });

  it("accepts a music library root and persists it in the env file", () => {
    const root = "E:\\codex\\素材库\\音乐库";
    expect(musicLibrarySettingsInputSchema.parse({ root }).root).toBe(root);
    expect(updateEnvFile("IMAGE_API_KEY=secret\n", { MUSIC_LIBRARY_ROOT: root })).toContain(
      `MUSIC_LIBRARY_ROOT=${root}`,
    );
  });

  it("rejects unsupported model and resolution combinations", () => {
    expect(() =>
      openAISettingsInputSchema.parse({
        clearApiKey: false,
        apiBaseUrl: "https://api.openai.com/v1",
        clearImageApiKey: false,
        imageApiBaseUrl: "https://www.hfsyapi.cn",
        imageModel: "gpt-image-2pro",
        imageSize: "1K",
        scriptModel: "gpt-4.1-mini",
      }),
    ).toThrow();
  });

  it("accepts the combined GPT 1K/2K/4K template", () => {
    const parsed = openAISettingsInputSchema.parse({
      clearApiKey: false,
      apiBaseUrl: "https://api.openai.com/v1",
      clearImageApiKey: false,
      imageApiBaseUrl: "https://www.hfsyapi.cn",
      imageModel: "gpt-image-2-template",
      imageSize: "4K",
      scriptModel: "gpt-4.1-mini",
    });
    expect(parsed.imageModel).toBe("gpt-image-2-template");
    expect(parsed.imageSize).toBe("4K");
  });

});
