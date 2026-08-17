import { describe, expect, it, vi } from "vitest";

import {
  createIntelligentSearchPlan,
  deriveGroundedSearchQueries,
  isSearchPlanGrounded,
  searchPlannerModel,
} from "./search-planner";

const request = {
  platform: "douyin" as const,
  request: "帮我搜索抖音上的最近7天关于职场类的选题，点赞必须过4w",
  resultLimit: 12,
};

describe("intelligent search planner", () => {
  it("parses and validates a grounded model plan", async () => {
    const complete = vi.fn().mockResolvedValue({
      message: {
        role: "assistant",
        content:
          '```json\n{"queries":["职场"],"maxAgeHours":168,"minMetric":40000,"minPrice":null,"wantedOnly":false,"excludeTerms":[],"sort":"metric_desc","summary":"最近7天点赞超过4万的职场选题"}\n```',
      },
      model: searchPlannerModel,
    });

    await expect(
      createIntelligentSearchPlan({
        input: request,
        apiKey: "secret",
        baseUrl: "https://example.com",
        complete,
      }),
    ).resolves.toMatchObject({
      plan: {
        queries: ["职场", "职场选题"],
        maxAgeHours: 168,
        minMetric: 40_000,
      },
    });
  });

  it("rejects unrelated but syntactically valid plans", () => {
    expect(
      isSearchPlanGrounded(request.request, {
        queries: ["橄榄球世界杯"],
        maxAgeHours: null,
        minMetric: null,
        minPrice: null,
        wantedOnly: false,
        excludeTerms: [],
        sort: "relevance",
        summary: "无关内容",
      }),
    ).toBe(false);
  });

  it("derives a grounded topic when the provider drops Chinese query text", () => {
    expect(deriveGroundedSearchQueries(request.request, "douyin")).toEqual([
      "职场",
    ]);
    expect(
      deriveGroundedSearchQueries("帮我找英语资料，价格100元以上", "xianyu"),
    ).toEqual(["英语资料"]);
  });
});
