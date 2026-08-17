import { z } from "zod";

import { intelligentSearchPlanSchema } from "@stickmotion/shared";

export const searchPlatformIdSchema = z.enum([
  "xianyu",
  "douyin",
  "xiaohongshu",
  "bilibili",
  "youtube",
  "twitter",
  "reddit",
  "v2ex",
  "facebook",
  "instagram",
  "github",
  "linkedin",
  "xiaoyuzhou",
  "xueqiu",
  "rss",
  "web",
  "exa",
]);

export const retainedSearchPlatformIdSchema = z.enum([
  "xianyu",
  "douyin",
  "xiaohongshu",
  "bilibili",
  "exa",
]);

const retainedSearchPlatformIds = new Set<string>(
  retainedSearchPlatformIdSchema.options,
);

export function isRetainedSearchPlatformId(
  value: string,
): value is RetainedSearchPlatformId {
  return retainedSearchPlatformIds.has(value);
}

export const searchPlatformSchema = z.object({
  id: searchPlatformIdSchema,
  name: z.string().min(1).max(40),
  group: z.string().min(1).max(20),
  ready: z.boolean(),
  mode: z.enum(["search", "url"]),
  hint: z.string().min(1).max(120),
  guide: z.string().max(300).optional(),
});

export const searchStatusResponseSchema = z.object({
  ok: z.literal(true),
  bridgeConfigured: z.boolean(),
  catalogAvailable: z.boolean(),
  platforms: z.array(searchPlatformSchema).max(30),
  time: z.string().datetime(),
});

const safeResultUrlSchema = z
  .string()
  .max(2_048)
  .refine(
    (value) => value === "" || /^https?:\/\//i.test(value),
    "结果链接必须使用 HTTP 或 HTTPS",
  );

export const searchResultSchema = z.object({
  title: z.string().min(1).max(500),
  author: z.string().max(120).default(""),
  metric: z.number().finite().nonnegative().default(0),
  metricText: z.string().max(120).default(""),
  date: z.string().max(200).default(""),
  url: safeResultUrlSchema.default(""),
  summary: z.string().max(4_000).default(""),
  price: z.number().finite().nonnegative().optional(),
  priceText: z.string().max(120).optional(),
  ageHours: z.number().finite().nonnegative().optional(),
});

export const searchResponseSchema = z.object({
  ok: z.literal(true),
  platform: searchPlatformIdSchema,
  query: z.string().max(500),
  fetchedAt: z.string().datetime(),
  results: z.array(searchResultSchema).max(60),
  count: z.number().int().nonnegative().max(60),
  plan: intelligentSearchPlanSchema.optional(),
});

export const searchWorkspaceStorageKey = "stickmotion.search.workspace.v1";

export const storedSearchWorkspaceSchema = z.object({
  version: z.literal(1),
  platformId: retainedSearchPlatformIdSchema,
  query: z.string().max(500),
  limit: z.number().int().min(1).max(30),
  response: searchResponseSchema.optional(),
});

export function parseStoredSearchWorkspace(raw: string | null) {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = storedSearchWorkspaceSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export const searchQuerySchema = z
  .object({
    platform: retainedSearchPlatformIdSchema,
    q: z.string().trim().max(500).default(""),
    limit: z.coerce.number().int().min(1).max(30).default(12),
  })
  .superRefine((value, context) => {
    if (!value.q) {
      context.addIssue({
        code: "custom",
        path: ["q"],
        message: "请输入检索关键词或链接",
      });
    }
  });

export const searchBridgeErrorSchema = z.object({
  ok: z.literal(false),
  platform: searchPlatformIdSchema.optional(),
  setupRequired: z.boolean().optional(),
  error: z.string().min(1).max(500),
  guide: z.string().max(500).optional(),
});

export const researchApiErrorSchema = z.object({
  error: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  guide: z.string().max(500).optional(),
});

export const researchAuthorizationRequestSchema = z.object({
  platform: z.literal("xiaohongshu"),
  action: z.enum(["open", "check"]),
});

export const researchAuthorizationResponseSchema = z.object({
  ok: z.literal(true),
  platform: z.literal("xiaohongshu"),
  authorized: z.boolean(),
  message: z.string().min(1).max(500),
});

export type SearchPlatform = z.infer<typeof searchPlatformSchema>;
export type SearchPlatformId = z.infer<typeof searchPlatformIdSchema>;
export type RetainedSearchPlatformId = z.infer<
  typeof retainedSearchPlatformIdSchema
>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type StoredSearchWorkspace = z.infer<
  typeof storedSearchWorkspaceSchema
>;
