import { describe, expect, it } from "vitest";

import {
  getKnowledgeBoardHeaderDecorationLayout,
  getKnowledgeBoardLayout,
  videoTemplateSchema,
} from "./video-template";

describe("knowledge board video template", () => {
  it("includes the impact-caption template as a trusted template id", () => {
    expect(videoTemplateSchema.parse("IMPACT_CAPTIONS")).toBe(
      "IMPACT_CAPTIONS",
    );
  });
  it.each([
    [1920, 1080],
    [1080, 1920],
  ])(
    "keeps image and subtitle in separate safe areas at %sx%s",
    (width, height) => {
      const layout = getKnowledgeBoardLayout(width, height);

      expect(layout.title.top + layout.title.height).toBeLessThanOrEqual(
        layout.header.top,
      );
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

  it("matches the Jianying preset 34 landscape proportions", () => {
    const layout = getKnowledgeBoardLayout(1920, 1080);

    expect(layout.title.top / 1080).toBeCloseTo(0.025, 3);
    expect(layout.header.top / 1080).toBeCloseTo(0.145, 3);
    expect(layout.image.top / 1080).toBeCloseTo(0.213, 3);
    expect(layout.dividerY / 1080).toBeCloseTo(0.815, 3);
  });

  it("places header dashes close to the editable text", () => {
    const decoration = getKnowledgeBoardHeaderDecorationLayout(
      1920,
      "THINKING|COMMUNICATION|CAREER|GROWTH",
      38,
    );
    const textLeft = 960 - decoration.estimatedTextWidth / 2;
    const textRight = 960 + decoration.estimatedTextWidth / 2;

    expect(
      textLeft - (decoration.leftDashX + decoration.dashWidth),
    ).toBeCloseTo(decoration.gap, 0);
    expect(decoration.rightDashX - textRight).toBeCloseTo(
      decoration.gap,
      0,
    );
  });

  it("rejects invalid canvas dimensions", () => {
    expect(() => getKnowledgeBoardLayout(200, 200)).toThrow(
      "VIDEO_TEMPLATE_DIMENSIONS_TOO_SMALL",
    );
  });
});
