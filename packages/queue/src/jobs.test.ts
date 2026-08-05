import { describe, expect, it } from "vitest";

import {
  enqueueRender,
  enqueueScriptGeneration,
  enqueueVoiceGeneration,
} from "./index";

describe("local SQLite queue producers", () => {
  it("returns the durable database job id after validating each payload", async () => {
    await expect(
      enqueueScriptGeneration({ jobId: "script-1", projectId: "project-1", projectRevision: 1 }),
    ).resolves.toBe("script-1");
    await expect(
      enqueueVoiceGeneration({
        jobId: "voice-1",
        projectId: "project-1",
        sceneId: "scene-1",
        projectRevision: 1,
      }),
    ).resolves.toBe("voice-1");
    await expect(
      enqueueRender({
        jobId: "render-1",
        projectId: "project-1",
        projectRevision: 1,
        watermark: "AI VOICE",
        introTitle: true,
        outro: true,
      }),
    ).resolves.toBe("render-1");
  });

  it("rejects malformed local task payloads", async () => {
    await expect(
      enqueueScriptGeneration({ jobId: "", projectId: "project-1", projectRevision: 1 }),
    ).rejects.toThrow();
  });
});