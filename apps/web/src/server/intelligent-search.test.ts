import { describe, expect, it } from "vitest";

import {
  applyIntelligentSearchPlan,
  mergeSearchResults,
} from "./intelligent-search";

const plan = {
  queries: ["职场"],
  maxAgeHours: 168,
  minMetric: 40_000,
  minPrice: null,
  wantedOnly: false,
  excludeTerms: ["音乐"],
  sort: "metric_desc" as const,
  summary: "最近7天点赞超过4万的职场选题",
};

describe("intelligent search result processing", () => {
  it("applies the AI plan and sorts matching results", () => {
    const results = applyIntelligentSearchPlan(
      [
        {
          title: "职场沟通",
          author: "甲",
          metric: 52_000,
          metricText: "5.2万",
          date: "2天前",
          ageHours: 48,
          url: "https://example.com/1",
          summary: "",
        },
        {
          title: "职场音乐",
          author: "乙",
          metric: 100_000,
          metricText: "10万",
          date: "1天前",
          ageHours: 24,
          url: "https://example.com/2",
          summary: "",
        },
        {
          title: "职场新人",
          author: "丙",
          metric: 41_000,
          metricText: "4.1万",
          date: "3天前",
          ageHours: 72,
          url: "https://example.com/3",
          summary: "",
        },
      ],
      plan,
    );
    expect(results.map((item) => item.title)).toEqual([
      "职场沟通",
      "职场新人",
    ]);
  });

  it("deduplicates results returned by multiple search terms", () => {
    const repeated = {
      title: "重复结果",
      author: "账号",
      metric: 1,
      metricText: "1",
      date: "",
      url: "https://example.com/same",
      summary: "",
    };
    expect(mergeSearchResults([[repeated], [repeated]])).toHaveLength(1);
  });
});
