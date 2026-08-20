import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  applyVideoTemplateImageStyle,
  batchSceneImages,
  buildCharacterReferenceDataUrl,
  getSceneImageAspectRatio,
  normalizeGeneratedSceneImage,
} from "./scene-image";

describe("scene image batching", () => {
  it("groups scenes into batches of six while preserving order", () => {
    expect(
      batchSceneImages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
    ).toEqual([[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [13]]);
  });

  it("never runs more than six scene tasks at once", async () => {
    let active = 0;
    let maximumActive = 0;

    for (const batch of batchSceneImages([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ])) {
      await Promise.all(
        batch.map(async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      );
    }

    expect(maximumActive).toBe(6);
  });

  it("rejects an invalid batch size", () => {
    expect(() => batchSceneImages([1], 0)).toThrow(
      "SCENE_IMAGE_BATCH_SIZE_INVALID",
    );
  });

  it("uses 21:9 generation for every knowledge-board scene", () => {
    expect(getSceneImageAspectRatio("LANDSCAPE", "KNOWLEDGE_BOARD")).toBe(
      "WIDE",
    );
    expect(getSceneImageAspectRatio("LANDSCAPE", "FULL_BLEED")).toBe(
      "LANDSCAPE",
    );
    expect(getSceneImageAspectRatio("PORTRAIT", "KNOWLEDGE_BOARD")).toBe(
      "WIDE",
    );
  });

  it("forces knowledge-board image generation to use stick figures", () => {
    const prompt = applyVideoTemplateImageStyle(
      "cinematic photorealistic office portrait",
      "KNOWLEDGE_BOARD",
    );
    expect(prompt).toContain("火柴人");
    expect(prompt).toContain("最高优先级");
    expect(prompt).toContain("禁止真人照片");
    expect(applyVideoTemplateImageStyle("cinematic office", "FULL_BLEED")).toBe(
      "cinematic office",
    );
  });

  it("keeps the complete source image inside the fixed 21:9 frame", async () => {
    const source = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 3,
        background: "#ff0000",
      },
    })
      .png()
      .toBuffer();

    const normalized = await normalizeGeneratedSceneImage(source, "WIDE");
    expect(await sharp(normalized).metadata()).toMatchObject({
      width: 1344,
      height: 576,
    });

    const leftPixel = await sharp(normalized)
      .extract({ left: 0, top: 288, width: 1, height: 1 })
      .raw()
      .toBuffer();
    const centerPixel = await sharp(normalized)
      .extract({ left: 672, top: 288, width: 1, height: 1 })
      .raw()
      .toBuffer();

    expect(Array.from(leftPixel.subarray(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(centerPixel.subarray(0, 3))).toEqual([255, 0, 0]);
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
