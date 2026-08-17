import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  intelligentSearchPlanRequestSchema,
  intelligentSearchPlanResponseSchema,
} from "@stickmotion/shared";

import {
  researchApiErrorSchema,
  searchBridgeErrorSchema,
  searchQuerySchema,
  searchResponseSchema,
} from "@/search-bridge";
import { apiError } from "@/server/http";
import {
  applyIntelligentSearchPlan,
  mergeSearchResults,
} from "@/server/intelligent-search";

const searchBridgeBaseUrl =
  process.env.SEARCH_BRIDGE_URL ?? "http://127.0.0.1:8790";
const searchPlannerUrl =
  process.env.SEARCH_PLANNER_URL ?? "http://127.0.0.1:4317/search/plan";

const plannerErrorSchema = z.object({ error: z.string().max(100) });

async function requestSearchPlan(input: {
  platform: "xianyu" | "douyin" | "xiaohongshu" | "bilibili" | "exa";
  request: string;
  resultLimit: number;
}) {
  const response = await fetch(searchPlannerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(intelligentSearchPlanRequestSchema.parse(input)),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const failure = plannerErrorSchema.safeParse(payload);
    throw new Error(failure.success ? failure.data.error : "SEARCH_PLAN_FAILED");
  }
  return intelligentSearchPlanResponseSchema.parse(payload);
}

async function requestPlatformResults(
  platform: string,
  queryText: string,
  limit: number,
) {
  const query = new URLSearchParams({
    platform,
    q: queryText,
    limit: String(limit),
  });
  const response = await fetch(
    `${searchBridgeBaseUrl}/api/search?${query.toString()}`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(190_000),
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const upstreamError = searchBridgeErrorSchema.safeParse(payload);
    const error = new Error("SEARCH_PLATFORM_FAILED") as Error & {
      upstream?: z.infer<typeof searchBridgeErrorSchema>;
    };
    if (upstreamError.success) error.upstream = upstreamError.data;
    throw error;
  }
  return searchResponseSchema.parse(payload);
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const input = searchQuerySchema.parse({
      platform: requestUrl.searchParams.get("platform") ?? undefined,
      q: requestUrl.searchParams.get("q") ?? undefined,
      limit: requestUrl.searchParams.get("limit") ?? undefined,
    });
    let planning;
    try {
      planning = await requestSearchPlan({
        platform: input.platform,
        request: input.q,
        resultLimit: input.limit,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "SEARCH_PLAN_FAILED";
      const payload = researchApiErrorSchema.parse({
        error: code,
        message:
          code === "DIALOGUE_API_KEY_REQUIRED"
            ? "请先在设置中配置对话 API，才能使用 AI 智能搜索"
            : "AI 没有生成可靠的搜索方案，请稍后重试",
      });
      return NextResponse.json(payload, { status: 502 });
    }

    const groups = [];
    let platformFailure:
      | (Error & { upstream?: z.infer<typeof searchBridgeErrorSchema> })
      | undefined;
    for (const plannedQuery of planning.plan.queries) {
      try {
        const result = await requestPlatformResults(
          input.platform,
          plannedQuery,
          60,
        );
        groups.push(result.results);
      } catch (error) {
        platformFailure = error as Error & {
          upstream?: z.infer<typeof searchBridgeErrorSchema>;
        };
      }
    }

    if (groups.length === 0) {
      const upstreamError = platformFailure?.upstream;
      const setupRequired = upstreamError?.setupRequired;
      const verificationRequired =
        upstreamError?.error === "DOUYIN_VERIFICATION_REQUIRED";
      const payload = researchApiErrorSchema.parse({
        error: verificationRequired
          ? "DOUYIN_VERIFICATION_REQUIRED"
          : setupRequired
            ? "SEARCH_SETUP_REQUIRED"
            : "SEARCH_FAILED",
        message: verificationRequired
          ? "抖音要求完成安全验证，当前不能可靠读取搜索结果"
          : setupRequired
            ? "该平台需要账号授权后才能使用"
            : "当前平台暂时无法完成检索，请稍后重试",
        guide: verificationRequired
          ? "请在已打开的 Chrome 抖音页面完成验证码，保持浏览器开启，然后重新点击智能搜索。"
          : upstreamError?.guide,
      });
      return NextResponse.json(payload, {
        status: setupRequired ? 422 : 502,
      });
    }

    const results = applyIntelligentSearchPlan(
      mergeSearchResults(groups),
      planning.plan,
    ).slice(0, input.limit);
    const payload = searchResponseSchema.parse({
      ok: true,
      platform: input.platform,
      query: input.q,
      fetchedAt: new Date().toISOString(),
      results,
      count: results.length,
      plan: planning.plan,
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      const payload = researchApiErrorSchema.parse({
        error: "SEARCH_TIMEOUT",
        message: "搜索超时，请缩小结果数量后重试",
      });
      return NextResponse.json(payload, { status: 504 });
    }
    if (error instanceof TypeError) {
      const payload = researchApiErrorSchema.parse({
        error: "SEARCH_BRIDGE_UNAVAILABLE",
        message: "搜索服务正在自动启动，请稍后重试",
      });
      return NextResponse.json(payload, { status: 503 });
    }
    return apiError(error);
  }
}
