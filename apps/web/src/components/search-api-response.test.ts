import { describe, expect, it } from "vitest";

import { readSearchApiPayload } from "./search-api-response";

describe("readSearchApiPayload", () => {
  it("returns JSON payloads", async () => {
    const response = Response.json({ ok: true });

    await expect(readSearchApiPayload(response)).resolves.toEqual({ ok: true });
  });

  it("turns an HTML 404 into a readable search error", async () => {
    const response = new Response("<!DOCTYPE html>", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    await expect(readSearchApiPayload(response)).rejects.toThrow(
      "搜索接口未加载，请重启本地服务后重试",
    );
  });

  it("handles malformed JSON without exposing parser details", async () => {
    const response = new Response("{", {
      headers: { "content-type": "application/json" },
    });

    await expect(readSearchApiPayload(response)).rejects.toThrow(
      "搜索服务返回的数据格式不正确，请稍后重试",
    );
  });
});
