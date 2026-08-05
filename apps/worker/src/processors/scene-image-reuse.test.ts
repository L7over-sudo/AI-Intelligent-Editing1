import { describe, expect, it } from "vitest";

import { isReusableSceneImage } from "./scene-image";

const criteria = {
  projectRevision: 2,
  sceneRevision: 3,
  characterProfileId: null,
  currentJobId: "job-new",
  resumeFromFailedJob: false,
};

const validMetadata = {
  projectRevision: 2,
  sceneRevision: 3,
  generationJobId: "job-prev",
  characterProfileId: null,
};

describe("isReusableSceneImage", () => {
  it("reuses an image produced by the current job", () => {
    expect(
      isReusableSceneImage(
        { ...validMetadata, generationJobId: criteria.currentJobId },
        criteria,
      ),
    ).toBe(true);
  });

  it("reuses a previous job image when resuming after a failed run", () => {
    expect(
      isReusableSceneImage(validMetadata, {
        ...criteria,
        resumeFromFailedJob: true,
      }),
    ).toBe(true);
  });

  it("does not reuse a previous job image without a failed-run resume", () => {
    expect(isReusableSceneImage(validMetadata, criteria)).toBe(false);
  });

  it("does not reuse an image from a different scene revision", () => {
    expect(
      isReusableSceneImage(
        { ...validMetadata, sceneRevision: 2 },
        { ...criteria, resumeFromFailedJob: true },
      ),
    ).toBe(false);
  });

  it("does not reuse an image from a different project revision", () => {
    expect(
      isReusableSceneImage(
        { ...validMetadata, projectRevision: 1 },
        { ...criteria, resumeFromFailedJob: true },
      ),
    ).toBe(false);
  });

  it("does not reuse an image generated for a different character profile", () => {
    expect(
      isReusableSceneImage(
        { ...validMetadata, characterProfileId: "profile-a" },
        { ...criteria, characterProfileId: "profile-b", resumeFromFailedJob: true },
      ),
    ).toBe(false);
    expect(
      isReusableSceneImage(
        { ...validMetadata, characterProfileId: "profile-a" },
        { ...criteria, resumeFromFailedJob: true },
      ),
    ).toBe(false);
  });

  it("rejects missing or malformed metadata", () => {
    expect(isReusableSceneImage(null, criteria)).toBe(false);
    expect(isReusableSceneImage("metadata", criteria)).toBe(false);
    expect(isReusableSceneImage([1, 2], criteria)).toBe(false);
  });

  it("treats an asset without a recorded character profile as non-reusable", () => {
    const legacyMetadata: Record<string, unknown> = { ...validMetadata };
    delete legacyMetadata.characterProfileId;
    expect(
      isReusableSceneImage(legacyMetadata, {
        ...criteria,
        resumeFromFailedJob: true,
      }),
    ).toBe(false);
  });
});
