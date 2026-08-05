import { describe, expect, it } from "vitest";

import {
  batchSceneImages,
  buildCharacterReferenceDataUrl,
} from "./scene-image";

describe("scene image batching", () => {
  it("groups scenes into batches of four while preserving order", () => {
    expect(batchSceneImages([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9],
    ]);
  });

  it("never runs more than four scene tasks at once", async () => {
    let active = 0;
    let maximumActive = 0;

    for (const batch of batchSceneImages([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      await Promise.all(
        batch.map(async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      );
    }

    expect(maximumActive).toBe(4);
  });

  it("rejects an invalid batch size", () => {
    expect(() => batchSceneImages([1], 0)).toThrow(
      "SCENE_IMAGE_BATCH_SIZE_INVALID",
    );
  });

  it("creates a supported local character-reference data URL", () => {
    expect(
      buildCharacterReferenceDataUrl(
        "image/png",
        new Uint8Array(Buffer.from("image")),
      ),
    ).toBe(`data:image/png;base64,${Buffer.from("image").toString("base64")}`);
    expect(() =>
      buildCharacterReferenceDataUrl(
        "image/gif",
        new Uint8Array(Buffer.from("image")),
      ),
    ).toThrow("CHARACTER_REFERENCE_CONTENT_TYPE_UNSUPPORTED");
  });

});
