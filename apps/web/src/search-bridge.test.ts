import { describe, expect, it } from "vitest";

import {
  parseStoredSearchWorkspace,
  researchAuthorizationRequestSchema,
  searchQuerySchema,
  searchResultSchema,
} from "./search-bridge";

describe("search bridge schemas", () => {
  it("accepts only the submitted query and result limit", () => {
    expect(
      searchQuerySchema.parse({
        platform: "douyin",
        q: "关于职场，最近7天，点赞5万以上",
        limit: "12",
        recent7: "true",
        minLikes: "40000",
      }),
    ).toMatchObject({
      platform: "douyin",
      q: "关于职场，最近7天，点赞5万以上",
      limit: 12,
    });
  });

  it("requires full URLs for URL reader platforms", () => {
    expect(() =>
      searchQuerySchema.parse({ platform: "web", q: "example.com" }),
    ).toThrow();
  });

  it("rejects unsafe result links", () => {
    expect(() =>
      searchResultSchema.parse({
        title: "不安全链接",
        url: "javascript:alert(1)",
      }),
    ).toThrow();
  });

  it("restores a validated completed search after a page refresh", () => {
    const stored = parseStoredSearchWorkspace(
      JSON.stringify({
        version: 1,
        platformId: "douyin",
        query: "职场管理",
        limit: 12,
        recent7: true,
        minLikes: 50_000,
        minPrice: 0,
        wantOnly: false,
        response: {
          ok: true,
          platform: "douyin",
          query: "职场管理",
          fetchedAt: "2026-08-09T04:00:00.000Z",
          results: [
            {
              title: "管理案例",
              author: "测试账号",
              metric: 100,
              metricText: "100",
              date: "今天",
              url: "https://www.douyin.com/video/1",
              summary: "摘要",
            },
          ],
          count: 1,
        },
      }),
    );

    expect(stored).toMatchObject({
      platformId: "douyin",
      query: "职场管理",
      limit: 12,
      response: { count: 1 },
    });
    expect(stored).not.toHaveProperty("recent7");
    expect(stored).not.toHaveProperty("minLikes");
    expect(stored).not.toHaveProperty("minPrice");
    expect(stored).not.toHaveProperty("wantOnly");
  });

  it("drops legacy built-in filter conditions from saved records", () => {
    const stored = parseStoredSearchWorkspace(
      JSON.stringify({
        version: 1,
        platformId: "douyin",
        query: "职场管理",
        limit: 12,
        recent7: true,
        minLikes: 50_000,
        minPrice: 100,
        wantOnly: true,
      }),
    );

    expect(stored).toEqual({
      version: 1,
      platformId: "douyin",
      query: "职场管理",
      limit: 12,
    });
  });

  it("ignores invalid local search records", () => {
    expect(parseStoredSearchWorkspace("not-json")).toBeUndefined();
    expect(
      parseStoredSearchWorkspace(
        JSON.stringify({ version: 1, platformId: "unknown" }),
      ),
    ).toBeUndefined();
  });

  it("only accepts the five retained search platforms", () => {
    for (const platform of [
      "xianyu",
      "douyin",
      "xiaohongshu",
      "bilibili",
      "exa",
    ]) {
      expect(
        searchQuerySchema.parse({ platform, q: "职场", limit: 12 }).platform,
      ).toBe(platform);
    }
    expect(() =>
      searchQuerySchema.parse({ platform: "youtube", q: "职场" }),
    ).toThrow();
    expect(
      parseStoredSearchWorkspace(
        JSON.stringify({
          version: 1,
          platformId: "youtube",
          query: "职场",
          limit: 12,
        }),
      ),
    ).toBeUndefined();
  });

  it("only accepts explicit Xiaohongshu authorization actions", () => {
    expect(
      researchAuthorizationRequestSchema.parse({
        platform: "xiaohongshu",
        action: "check",
      }),
    ).toEqual({ platform: "xiaohongshu", action: "check" });
    expect(() =>
      researchAuthorizationRequestSchema.parse({
        platform: "twitter",
        action: "open",
      }),
    ).toThrow();
  });
});
