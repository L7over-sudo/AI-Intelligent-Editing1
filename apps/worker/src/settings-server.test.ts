import { describe, expect, it } from "vitest";

import {
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
      clearImageApiKey: false,
      imageApiBaseUrl: "https://www.hfsyapi.cn",
      imageModel: "gpt-image-2",
      imageSize: "1K",
      scriptModel: "gpt-4.1-mini",
      ttsModel: "gpt-4o-mini-tts",
      transcribeModel: "gpt-4o-mini-transcribe",
    });
    expect(parsed.imageApiKey).toBeUndefined();
    expect(parseEnvFile("IMAGE_API_KEY=secret\n").get("IMAGE_API_KEY")).toBe(
      "secret",
    );
  });

  it("rejects unsupported model and resolution combinations", () => {
    expect(() =>
      openAISettingsInputSchema.parse({
        clearApiKey: false,
        clearImageApiKey: false,
        imageApiBaseUrl: "https://www.hfsyapi.cn",
        imageModel: "gpt-image-2pro",
        imageSize: "1K",
        scriptModel: "gpt-4.1-mini",
        ttsModel: "gpt-4o-mini-tts",
        transcribeModel: "gpt-4o-mini-transcribe",
      }),
    ).toThrow();
  });
});
