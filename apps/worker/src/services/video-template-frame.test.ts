import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  createKnowledgeBoardFrame,
  prepareKnowledgeBoardImage,
} from "./video-template-frame";

describe("knowledge board FFmpeg frame", () => {
  it.each([
    [1920, 1080],
    [1080, 1920],
  ])("renders an exact %sx%s PNG canvas", async (width, height) => {
    const source = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: "#d6e8ff",
      },
    })
      .png()
      .toBuffer();

    const frame = await createKnowledgeBoardFrame({
      source,
      width,
      height,
      headerText: "— 思维提升 | 表达沟通 | 职场成长 —",
    });
    const metadata = await sharp(frame).metadata();

    expect(metadata.width).toBe(width);
    expect(metadata.height).toBe(height);
    expect(metadata.format).toBe("png");
  });

  it("removes near-white outer margins while keeping safe padding", async () => {
    const source = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: "#ffffff",
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 300,
              height: 180,
              channels: 3,
              background: "#111111",
            },
          },
          left: 170,
          top: 90,
        },
      ])
      .png()
      .toBuffer();

    const prepared = await prepareKnowledgeBoardImage(source);
    const metadata = await sharp(prepared).metadata();

    expect(metadata.width).toBeLessThan(400);
    expect(metadata.height).toBeLessThan(280);
    expect(metadata.width).toBeGreaterThan(300);
    expect(metadata.height).toBeGreaterThan(180);
  });

  it("does not crop a non-white full-frame image", async () => {
    const source = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: "#4a7bc8",
      },
    })
      .png()
      .toBuffer();

    const prepared = await prepareKnowledgeBoardImage(source);
    const metadata = await sharp(prepared).metadata();

    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(360);
  });
});
