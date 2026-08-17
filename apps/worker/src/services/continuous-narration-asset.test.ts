import { describe, expect, it } from "vitest";

import { resolveContinuousNarrationMetadata } from "./continuous-narration-asset";

const metadata = {
  assetRole: "CONTINUOUS_NARRATION" as const,
  projectRevision: 4,
  sceneIds: ["scene-1", "scene-2"],
  sceneDurationsMs: [1_100, 1_300],
  durationMs: 2_400,
  voiceGenerationJobId: "voice-job-1",
};

describe("resolveContinuousNarrationMetadata", () => {
  it("accepts the master for the exact project revision and scene order", () => {
    expect(
      resolveContinuousNarrationMetadata(metadata, 4, ["scene-1", "scene-2"]),
    ).toEqual(metadata);
  });

  it("rejects a stale or differently ordered master", () => {
    expect(
      resolveContinuousNarrationMetadata(metadata, 3, ["scene-1", "scene-2"]),
    ).toBeUndefined();
    expect(
      resolveContinuousNarrationMetadata(metadata, 4, ["scene-2", "scene-1"]),
    ).toBeUndefined();
  });
});
