import { describe, expect, it } from "vitest";

import {
  sceneImageGenerationInputSchema,
  sceneImageSelectionSchema,
} from "./scene-image-job";

describe("scene image job schemas", () => {
  it("accepts an explicit user scene selection", () => {
    expect(
      sceneImageSelectionSchema.parse({ sceneIds: ["scene-1", "scene-2"] }),
    ).toEqual({ sceneIds: ["scene-1", "scene-2"] });
  });

  it("rejects an empty selection", () => {
    expect(() =>
      sceneImageSelectionSchema.parse({ sceneIds: [] }),
    ).toThrow();
  });

  it("keeps project revision on worker payloads", () => {
    expect(
      sceneImageGenerationInputSchema.parse({
        jobId: "job-1",
        projectId: "project-1",
        projectRevision: 3,
        sceneIds: ["scene-1"],
      }).projectRevision,
    ).toBe(3);
  });
});
