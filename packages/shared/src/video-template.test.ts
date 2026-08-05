import { describe, expect, it } from "vitest";

import { getKnowledgeBoardLayout } from "./video-template";

describe("knowledge board video template", () => {
  it.each([
    [1920, 1080],
    [1080, 1920],
  ])(
    "keeps image and subtitle in separate safe areas at %sx%s",
    (width, height) => {
      const layout = getKnowledgeBoardLayout(width, height);

      expect(layout.image.top).toBeGreaterThan(
        layout.header.top + layout.header.height,
      );
      expect(layout.image.top + layout.image.height).toBeLessThan(
        layout.dividerY,
      );
      expect(layout.subtitle.top).toBe(layout.dividerY);
      expect(layout.subtitle.top + layout.subtitle.height).toBe(height);
      expect(layout.image.left).toBeGreaterThan(0);
      expect(layout.image.left + layout.image.width).toBeLessThan(width);
      expect(layout.image.width / width).toBeCloseTo(0.86, 2);
    },
  );

  it("rejects invalid canvas dimensions", () => {
    expect(() => getKnowledgeBoardLayout(200, 200)).toThrow(
      "VIDEO_TEMPLATE_DIMENSIONS_TOO_SMALL",
    );
  });
});
