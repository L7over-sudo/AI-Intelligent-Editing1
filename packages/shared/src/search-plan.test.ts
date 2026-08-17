import { describe, expect, it } from "vitest";

import {
  intelligentSearchPlanRequestSchema,
  intelligentSearchPlanSchema,
} from "./search-plan";

describe("intelligent search plan schemas", () => {
  it("accepts a bounded dynamic search plan", () => {
    expect(
      intelligentSearchPlanSchema.parse({
        queries: ["职场", "职场话题"],
        maxAgeHours: 168,
        minMetric: 40_000,
        minPrice: null,
        wantedOnly: false,
        excludeTerms: ["音乐"],
        sort: "metric_desc",
        summary: "搜索最近7天点赞超过4万的职场选题",
      }),
    ).toMatchObject({ maxAgeHours: 168, minMetric: 40_000 });
  });

  it("rejects unsupported platforms and oversized plans", () => {
    expect(() =>
      intelligentSearchPlanRequestSchema.parse({
        platform: "youtube",
        request: "人工智能",
        resultLimit: 12,
      }),
    ).toThrow();
    expect(() =>
      intelligentSearchPlanSchema.parse({
        queries: ["一", "二", "三", "四", "五"],
        maxAgeHours: null,
        minMetric: null,
        minPrice: null,
        wantedOnly: false,
        excludeTerms: [],
        sort: "relevance",
        summary: "过多搜索词",
      }),
    ).toThrow();
  });
});
