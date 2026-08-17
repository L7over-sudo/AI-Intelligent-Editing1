import { z } from "zod";

import {
  intelligentSearchPlanSchema,
  type DialogueCompletionResponse,
  type IntelligentSearchPlan,
  type IntelligentSearchPlanRequest,
} from "@stickmotion/shared";

import { requestDialogueCompletion } from "./dialogue-provider";

export const searchPlannerModel = "gpt-5.6-terra";

const generatedSearchPlanSchema = intelligentSearchPlanSchema.extend({
  queries: z.array(z.string().trim().min(1).max(80)).max(4),
});

type CompleteDialogue = (options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  input: {
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    temperature: number;
  };
}) => Promise<DialogueCompletionResponse>;

function parseJsonObject(source: string): unknown {
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("SEARCH_PLAN_RESPONSE_INVALID");
  }
  try {
    return JSON.parse(source.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    throw new Error("SEARCH_PLAN_RESPONSE_INVALID");
  }
}

function compactText(source: string): string {
  return source.toLocaleLowerCase("zh-CN").replace(/[^\p{L}\p{N}]+/gu, "");
}

function unicodeEscape(source: string): string {
  return Array.from(source, (character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x7f) return character;
    if (codePoint <= 0xffff) {
      return `\\u${codePoint.toString(16).padStart(4, "0")}`;
    }
    const adjusted = codePoint - 0x10000;
    const high = 0xd800 + (adjusted >> 10);
    const low = 0xdc00 + (adjusted & 0x3ff);
    return `\\u${high.toString(16)}\\u${low.toString(16)}`;
  }).join("");
}

export function deriveGroundedSearchQueries(
  request: string,
  platform: IntelligentSearchPlanRequest["platform"],
): string[] {
  if (platform === "exa") return [request.trim()];

  const topicMatch = request.match(
    /(?:关于|有关)\s*([\p{L}\p{N}]{2,30}?)(?:类|相关)?(?:的)?(?:选题|内容|视频|作品|商品|话题|笔记)/u,
  );
  if (topicMatch?.[1]) return [topicMatch[1].trim()];

  const platformNames =
    /(?:抖音|小红书|B站|哔哩哔哩|闲鱼|全网|Exa)(?:上|里|平台)?/giu;
  const cleaned = request
    .replace(platformNames, " ")
    .replace(/(?:最近|近)\s*\d+\s*(?:小时|天|周|个月)/gu, " ")
    .replace(
      /(?:点赞|播放量?|互动量?|价格|售价|想要数?)[^，,。；;]*/gu,
      " ",
    )
    .replace(
      /^(?:请|麻烦)?\s*(?:帮我)?\s*(?:搜索|搜一下|查找|找一下|找)\s*/u,
      "",
    )
    .replace(/(?:相关)?(?:选题|内容|视频|作品|商品|话题|笔记)/gu, " ")
    .replace(/[，,。；;：:、]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length >= 2 ? [cleaned.slice(0, 80)] : [];
}

function expandSearchQueries(
  queries: string[],
  request: string,
  resultLimit: number,
) {
  if (resultLimit < 8 || queries.length !== 1) return queries;
  const intent = request.match(
    /(?:选题|话题|案例|教程|测评|资料|商品|视频|笔记|作品)/u,
  )?.[0];
  if (!intent || queries[0]?.includes(intent)) return queries;
  return [queries[0] ?? "", `${queries[0] ?? ""}${intent}`].filter(Boolean);
}

export function isSearchPlanGrounded(
  request: string,
  plan: IntelligentSearchPlan,
): boolean {
  const compactRequest = compactText(request);
  return plan.queries.every((query) => {
    const compactQuery = compactText(query);
    if (compactQuery.length < 2) return false;
    const fragments = Array.from(
      { length: compactQuery.length - 1 },
      (_, index) => compactQuery.slice(index, index + 2),
    );
    return fragments.some((fragment) => compactRequest.includes(fragment));
  });
}

function platformCapability(platform: IntelligentSearchPlanRequest["platform"]) {
  switch (platform) {
    case "douyin":
      return "结果可按发布时间、点赞数筛选；搜索词应短且适合抖音站内搜索。";
    case "xianyu":
      return "结果可按价格、想要人数筛选；搜索词应是商品名称。";
    case "xiaohongshu":
      return "结果可按互动量筛选；搜索词应短且适合笔记搜索。";
    case "bilibili":
      return "结果可按播放或互动量筛选；搜索词应短且适合视频搜索。";
    case "exa":
      return "这是全网语义搜索，可以使用完整、清晰的问题作为搜索词。";
  }
}

export async function createIntelligentSearchPlan(options: {
  input: IntelligentSearchPlanRequest;
  apiKey: string;
  baseUrl: string;
  complete?: CompleteDialogue;
}): Promise<{ plan: IntelligentSearchPlan; model: string }> {
  const complete = options.complete ?? requestDialogueCompletion;
  const systemMessage = [
    "你是供程序调用的搜索规划器，不负责回答用户的问题。",
    "把用户的自然语言请求转换成站内搜索词和动态筛选计划。",
    "queries 必须有1到4个简短核心主题词，不能留空，不能包含平台名、帮我搜索、时间、数量或筛选指令。",
    "用户需要8条以上结果时，queries必须给出4个围绕同一核心主题、互补而不重复的站内搜索词。",
    "例如用户要最近7天的职场选题，queries应为[\"职场\"]。",
    "仅当用户明确提出条件时才填写筛选值，否则使用null或false。",
    "把最近N天换算为N*24小时；4w、4万都换算为40000。",
    "excludeTerms只放用户明确要求排除的词，不能自行猜测。",
    "sort没有明确排序要求时使用relevance；要求高互动时使用metric_desc。",
    "禁止Markdown、解释或额外字段，只输出一个严格JSON对象。",
    'JSON格式：{"queries":["核心词"],"maxAgeHours":null,"minMetric":null,"minPrice":null,"wantedOnly":false,"excludeTerms":[],"sort":"relevance","summary":"一句话说明实际搜索方案"}',
  ].join("\n");
  const userMessage = [
    `任务编号：search-plan-${Date.now()}`,
    `今天日期：${new Date().toISOString().slice(0, 10)}`,
    `平台：${options.input.platform}`,
    `平台能力：${platformCapability(options.input.platform)}`,
    `需要返回：${options.input.resultLimit}条`,
    `原始请求Unicode转义（请先解码再规划）：${unicodeEscape(options.input.request)}`,
    "只输出JSON。",
  ].join("\n");

  async function run(messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>) {
    return complete({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: searchPlannerModel,
      input: { temperature: 0, messages },
    });
  }

  function validatedPlan(content: string) {
    try {
      const parsed = generatedSearchPlanSchema.safeParse(
        parseJsonObject(content),
      );
      if (!parsed.success) return undefined;
      const groundedQueries = isSearchPlanGrounded(
        options.input.request,
        parsed.data,
      )
        ? parsed.data.queries
        : deriveGroundedSearchQueries(
            options.input.request,
            options.input.platform,
          );
      const queries = expandSearchQueries(
        groundedQueries,
        options.input.request,
        options.input.resultLimit,
      );
      const grounded = intelligentSearchPlanSchema.safeParse({
        ...parsed.data,
        queries,
        sort:
          parsed.data.minMetric !== null && parsed.data.sort === "relevance"
            ? "metric_desc"
            : parsed.data.sort,
      });
      return grounded.success ? grounded.data : undefined;
    } catch {
      // A single corrective retry below handles malformed JSON.
    }
    return undefined;
  }

  let response = await run([
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ]);
  let plan = validatedPlan(response.message.content);
  if (!plan) {
    response = await run([
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
      { role: "assistant", content: response.message.content },
      {
        role: "user",
        content: [
          "上一份JSON未通过校验。",
          "queries不能为空，必须从原始请求中提取与原文直接相关的核心主题词。",
          `原始请求Unicode转义：${unicodeEscape(options.input.request)}`,
          "修正后仍然只输出完整JSON。",
        ].join("\n"),
      },
    ]);
    plan = validatedPlan(response.message.content);
  }
  if (!plan) {
    console.warn(
      "[search-planner] rejected model output:",
      response.message.content.slice(0, 2_000),
    );
    throw new Error("SEARCH_PLAN_RESPONSE_INVALID");
  }
  return { plan, model: searchPlannerModel };
}
