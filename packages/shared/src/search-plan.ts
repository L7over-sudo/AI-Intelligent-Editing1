import { z } from "zod";

export const intelligentSearchPlatformSchema = z.enum([
  "xianyu",
  "douyin",
  "xiaohongshu",
  "bilibili",
  "exa",
]);

export const intelligentSearchPlanRequestSchema = z
  .object({
    platform: intelligentSearchPlatformSchema,
    request: z.string().trim().min(1).max(500),
    resultLimit: z.number().int().min(1).max(30),
  })
  .strict();

export const intelligentSearchPlanSchema = z
  .object({
    queries: z.array(z.string().trim().min(1).max(80)).min(1).max(4),
    maxAgeHours: z.number().int().min(1).max(24 * 365).nullable(),
    minMetric: z.number().int().min(0).max(1_000_000_000).nullable(),
    minPrice: z.number().min(0).max(1_000_000).nullable(),
    wantedOnly: z.boolean(),
    excludeTerms: z.array(z.string().trim().min(1).max(30)).max(8),
    sort: z.enum(["relevance", "metric_desc", "date_desc", "price_asc"]),
    summary: z.string().trim().min(1).max(200),
  })
  .strict();

export const intelligentSearchPlanResponseSchema = z
  .object({
    plan: intelligentSearchPlanSchema,
    model: z.string().trim().min(1).max(120),
  })
  .strict();

export type IntelligentSearchPlan = z.infer<
  typeof intelligentSearchPlanSchema
>;
export type IntelligentSearchPlanRequest = z.infer<
  typeof intelligentSearchPlanRequestSchema
>;
