import { describe, expect, it } from "vitest";

import { retainedProfileAssetObjectKey } from "./profile-asset-retention";

describe("profile asset retention", () => {
  it("moves legacy project voice references into the durable user library", () => {
    expect(
      retainedProfileAssetObjectKey({
        ownerId: "user_1",
        assetId: "voice_1",
        kind: "VOICE",
        objectKey: "projects/project_1/voice-reference/reference.mp3",
      }),
    ).toBe("users/user_1/voice-profiles/voice_1.mp3");
  });

  it("keeps character references separate from voice files", () => {
    expect(
      retainedProfileAssetObjectKey({
        ownerId: "user_1",
        assetId: "character_1",
        kind: "CHARACTER_REFERENCE",
        objectKey: "projects/project_1/reference/person.webp",
      }),
    ).toBe("users/user_1/character-profiles/character_1.webp");
  });

  it("rejects unsafe identifiers", () => {
    expect(() =>
      retainedProfileAssetObjectKey({
        ownerId: "../owner",
        assetId: "voice_1",
        kind: "VOICE",
        objectKey: "projects/project_1/reference.mp3",
      }),
    ).toThrow();
  });
});
