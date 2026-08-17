import "server-only";

import { NextResponse } from "next/server";

import {
  isRetainedSearchPlatformId,
  researchApiErrorSchema,
  searchStatusResponseSchema,
} from "@/search-bridge";

const searchBridgeBaseUrl =
  process.env.SEARCH_BRIDGE_URL ?? "http://127.0.0.1:8790";

export async function GET() {
  try {
    const response = await fetch(`${searchBridgeBaseUrl}/api/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("SEARCH_BRIDGE_BAD_STATUS");
    const upstream = searchStatusResponseSchema.parse(await response.json());
    const payload = searchStatusResponseSchema.parse({
      ...upstream,
      platforms: upstream.platforms.filter((platform) =>
        isRetainedSearchPlatformId(platform.id),
      ),
    });
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[research-status]", error);
    const payload = researchApiErrorSchema.parse({
      error: "SEARCH_BRIDGE_UNAVAILABLE",
      message: "搜索服务正在自动启动，请稍后重试",
    });
    return NextResponse.json(payload, { status: 503 });
  }
}
