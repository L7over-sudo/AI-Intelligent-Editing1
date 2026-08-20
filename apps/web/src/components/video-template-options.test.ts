import { describe, expect, it } from "vitest";

import { videoTemplateOptions } from "./video-template-options";

describe("video template options", () => {
  it("keeps impact captions between the original template choices", () => {
    expect(videoTemplateOptions.map((template) => template.value)).toEqual([
      "KNOWLEDGE_BOARD",
      "IMPACT_CAPTIONS",
      "FULL_BLEED",
    ]);
    expect(videoTemplateOptions[1]).toMatchObject({
      label: "爆点大字",
      description: "全文重点逐句弹入并在同屏累积",
    });
  });
});
