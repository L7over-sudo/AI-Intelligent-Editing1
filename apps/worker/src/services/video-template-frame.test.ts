import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  getKnowledgeBoardLayout,
  KNOWLEDGE_BOARD_IMAGE_SIZE,
} from "@stickmotion/shared";

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
      mainTitle: "\u6807\u9898",
      leftVerticalText: "\u65e0\u9650\u8fdb\u5316\u7684Jay",
      rightVerticalText:
        "\u4e2a\u4eba\u89c2\u70b9\n\n\u65e0\u4e0d\u826f\u5f15\u5bfc",
    });
    const metadata = await sharp(frame).metadata();

    expect(metadata.width).toBe(width);
    expect(metadata.height).toBe(height);
    expect(metadata.format).toBe("png");
  });

  it("keeps the complete image undistorted inside the expanded safe area", async () => {
    const source = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: "#4a7bc8",
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 640,
              height: 30,
              channels: 3,
              background: "#e53935",
            },
          },
          top: 0,
          left: 0,
        },
        {
          input: {
            create: {
              width: 640,
              height: 30,
              channels: 3,
              background: "#43a047",
            },
          },
          top: 330,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    const width = 1920;
    const height = 1080;
    const layout = getKnowledgeBoardLayout(width, height);
    const frame = await createKnowledgeBoardFrame({
      source,
      width,
      height,
      headerText: "",
    });
    const centerPixels = await sharp(frame)
      .extract({
        left: Math.round(width / 2),
        top: layout.image.top + 8,
        width: 1,
        height: layout.image.height - 16,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    const bottomOffset = (layout.image.height - 17) * 3;

    expect([...centerPixels.subarray(0, 3)]).toEqual([229, 57, 53]);
    expect([...centerPixels.subarray(bottomOffset, bottomOffset + 3)]).toEqual([
      67, 160, 71,
    ]);
  });

  it("uses a pure #FFFFFF template background", async () => {
    const source = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();
    const frame = await createKnowledgeBoardFrame({
      source,
      width: 1920,
      height: 1080,
      headerText: "",
    });
    const pixel = await sharp(frame)
      .extract({ left: 10, top: 10, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();

    expect([...pixel]).toEqual([255, 255, 255]);
  });

  it("normalizes every source to the fixed 21:9 canvas without trimming", async () => {
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
              width: 40,
              height: 360,
              channels: 3,
              background: "#111111",
            },
          },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();

    const prepared = await prepareKnowledgeBoardImage(source);
    const metadata = await sharp(prepared).metadata();
    expect(metadata.width).toBe(KNOWLEDGE_BOARD_IMAGE_SIZE.width);
    expect(metadata.height).toBe(KNOWLEDGE_BOARD_IMAGE_SIZE.height);

    const pixels = await sharp(prepared)
      .extract({
        left: 0,
        top: Math.round(KNOWLEDGE_BOARD_IMAGE_SIZE.height / 2),
        width: 1,
        height: 1,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...pixels]).toEqual([255, 255, 255]);

    const imageLeft = Math.round((KNOWLEDGE_BOARD_IMAGE_SIZE.width - 1024) / 2);
    const darkPixels = await sharp(prepared)
      .extract({
        left: imageLeft,
        top: Math.round(KNOWLEDGE_BOARD_IMAGE_SIZE.height / 2),
        width: 1,
        height: 1,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...darkPixels]).toEqual([17, 17, 17]);
  });

  it("keeps a non-white full-frame image inside the fixed 21:9 canvas", async () => {
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

    expect(metadata.width).toBe(KNOWLEDGE_BOARD_IMAGE_SIZE.width);
    expect(metadata.height).toBe(KNOWLEDGE_BOARD_IMAGE_SIZE.height);
  });
});
