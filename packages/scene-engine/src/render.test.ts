import { describe, expect, it } from "vitest";

import { escapeXml, renderSvgScene } from "./render";

describe("renderSvgScene", () => {
  it("renders controlled assets and an escaped subtitle", () => {
    const svg = renderSvgScene({
      width: 1080,
      height: 1920,
      accentColor: "#FF5C35",
      subtitle: "专注 < 走神 & 放弃",
      elements: [
        {
          assetId: "person-pointing",
          x: 0.4,
          y: 0.55,
          scale: 1.2,
          rotation: 0,
          emphasis: false,
          label: "",
        },
        {
          assetId: "speech-bubble",
          x: 0.68,
          y: 0.3,
          scale: 1,
          rotation: 0,
          emphasis: true,
          label: "<开始>",
        },
      ],
    });

    expect(svg).toContain('width="1080"');
    expect(svg).toContain("#FF5C35");
    expect(svg).toContain("&lt;开始&gt;");
    expect(svg).toContain("专注 &lt; 走神 &amp; 放弃");
    expect(svg).not.toContain("<开始>");
  });

  it("rejects untrusted asset ids", () => {
    expect(() =>
      renderSvgScene({
        width: 1080,
        height: 1920,
        accentColor: "#FF5C35",
        elements: [
          {
            assetId: "script" as "person-standing",
            x: 0.5,
            y: 0.5,
            scale: 1,
            rotation: 0,
            emphasis: false,
            label: "",
          },
        ],
      }),
    ).toThrow();
  });
});

describe("escapeXml", () => {
  it("escapes all XML special characters", () => {
    expect(escapeXml(`<a x="1">'&</a>`)).toBe(
      "&lt;a x=&quot;1&quot;&gt;&apos;&amp;&lt;/a&gt;",
    );
  });
});

