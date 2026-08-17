import { describe, expect, it } from "vitest";

import { continuousNarrationAssetMetadataSchema } from "./continuous-voice";

describe("continuousNarrationAssetMetadataSchema", () => {
  it("accepts a project-wide narration timeline", () => {
    expect(
      continuousNarrationAssetMetadataSchema.parse({
        assetRole: "CONTINUOUS_NARRATION",
        projectRevision: 3,
        sceneIds: ["scene-1", "scene-2"],
        sceneDurationsMs: [1_200, 1_500],
        durationMs: 2_700,
        voiceGenerationJobId: "voice-job-1",
      }),
    ).toMatchObject({
      sceneIds: ["scene-1", "scene-2"],
      sceneDurationsMs: [1_200, 1_500],
    });
  });

  it("rejects mismatched scene and duration metadata", () => {
    expect(() =>
      continuousNarrationAssetMetadataSchema.parse({
        assetRole: "CONTINUOUS_NARRATION",
        projectRevision: 3,
        sceneIds: ["scene-1", "scene-2"],
        sceneDurationsMs: [1_200],
        durationMs: 1_200,
        voiceGenerationJobId: "voice-job-1",
      }),
    ).toThrow();
  });
});
