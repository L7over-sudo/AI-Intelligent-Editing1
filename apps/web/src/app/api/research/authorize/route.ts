import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

import {
  researchApiErrorSchema,
  researchAuthorizationRequestSchema,
  researchAuthorizationResponseSchema,
} from "@/search-bridge";
import { apiError } from "@/server/http";

const searchBridgeBaseUrl =
  process.env.SEARCH_BRIDGE_URL ?? "http://127.0.0.1:8790";
const xiaohongshuLoginUrl = "https://www.xiaohongshu.com/explore";

function resolveChromePath() {
  const candidates = [
    process.env.PROGRAMFILES
      ? join(
          process.env.PROGRAMFILES,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : "",
    process.env["PROGRAMFILES(X86)"]
      ? join(
          process.env["PROGRAMFILES(X86)"],
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : "",
    process.env.LOCALAPPDATA
      ? join(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : "",
  ];
  return candidates.find(
    (candidate) => candidate && existsSync(candidate),
  );
}

export async function POST(request: Request) {
  try {
    const input = researchAuthorizationRequestSchema.parse(
      await request.json(),
    );

    if (input.action === "open") {
      const chromePath = resolveChromePath();
      if (!chromePath) {
        const payload = researchApiErrorSchema.parse({
          error: "CHROME_NOT_FOUND",
          message: "没有找到 Google Chrome，请先安装 Chrome",
        });
        return NextResponse.json(payload, { status: 422 });
      }
      const chrome = spawn(chromePath, [xiaohongshuLoginUrl], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      chrome.unref();
      return NextResponse.json(
        researchAuthorizationResponseSchema.parse({
          ok: true,
          platform: input.platform,
          authorized: false,
          message: "Chrome 已打开，请登录小红书后回到这里检测授权",
        }),
      );
    }

    const response = await fetch(
      `${searchBridgeBaseUrl}/api/authorize?platform=${input.platform}`,
      {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(190_000),
      },
    );
    const upstreamPayload: unknown = await response.json();
    if (!response.ok) {
      const upstreamError = researchApiErrorSchema.safeParse(upstreamPayload);
      return NextResponse.json(
        researchApiErrorSchema.parse({
          error: "AUTHORIZATION_CHECK_FAILED",
          message: upstreamError.success
            ? upstreamError.data.message
            : "没有检测到可用的小红书登录会话",
        }),
        { status: 422 },
      );
    }
    return NextResponse.json(
      researchAuthorizationResponseSchema.parse(upstreamPayload),
    );
  } catch (error) {
    return apiError(error);
  }
}
