import { z } from "zod";

const storedCoverTemplateSchema = z
  .object({
    backgroundText: z.string().max(16).optional(),
    title: z.string().max(20).optional(),
    subtitle: z.string().max(40).optional(),
    account: z.string().max(30).optional(),
    footer: z.string().max(40).optional(),
    templateName: z.string().trim().min(1).max(40).optional(),
    saved: z.literal(true).optional(),
    avatarUrl: z
      .string()
      .max(3_000_000)
      .refine(
        (value) =>
          value === "" ||
          /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/iu.test(value),
        "头像必须是受支持的图片数据",
      )
      .optional(),
  })
  .strict();

const coverTemplateDataSchema = z
  .object({
    title: z.string().max(20),
    subtitle: z.string().max(40),
    account: z.string().max(30),
    footer: z.string().max(40).optional(),
    avatarUrl: z
      .string()
      .refine(
        (value) =>
          value === "" ||
          /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/iu.test(value),
        "头像必须是受支持的图片数据",
      ),
  })
  .strict();

const savedCoverTemplateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(40),
    templateId: z.string().min(1).max(100).optional(),
    templateName: z.string().trim().min(1).max(40).optional(),
    cover: coverTemplateDataSchema,
  })
  .strict();

const savedCoverTemplatesSchema = z
  .array(savedCoverTemplateSchema)
  .max(10);

export interface CoverTemplateData {
  title: string;
  subtitle: string;
  account: string;
  footer: string;
  avatarUrl: string;
}

export interface SavedCoverTemplate {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  cover: CoverTemplateData;
}

export const coverTemplateId = "black-white-opinion";
export const coverTemplateName = "账号名片";
export const characterCoverTemplateId = "monochrome-career-character";
export const characterCoverTemplateName = "黑白人物职场";
export const defaultSavedCoverName = "DY";
export const coverTemplateStorageKey = "stickmotion-cover-template";
export const noCoverTemplateId = "__NO_COVER__";

export const defaultCoverTemplate: CoverTemplateData = {
  title: "上班崩溃",
  subtitle: "没边界的工作最让人崩溃",
  account: "@杰妍社进化论",
  footer: "",
  avatarUrl: "",
};

export const defaultCharacterCoverTemplate: CoverTemplateData = {
  title: "性骚扰 裁员与女性困境",
  subtitle: "公司价值观背后的职场真相",
  account: "少内耗｜多思考｜快成长",
  footer: "认知觉醒｜人生感悟｜思维升级",
  avatarUrl: "",
};

export const officialCoverTemplates = [
  {
    id: coverTemplateId,
    name: coverTemplateName,
    defaultCover: defaultCoverTemplate,
  },
  {
    id: characterCoverTemplateId,
    name: characterCoverTemplateName,
    defaultCover: defaultCharacterCoverTemplate,
  },
] as const;

export type OfficialCoverTemplateId =
  (typeof officialCoverTemplates)[number]["id"];

export function isOfficialCoverTemplateId(
  value: string | undefined,
): value is OfficialCoverTemplateId {
  return officialCoverTemplates.some((template) => template.id === value);
}

export function parseStoredCoverTemplate(raw: string | null): CoverTemplateData {
  if (!raw) return defaultCoverTemplate;

  const savedTemplates = parseSavedCoverTemplates(raw);
  const latestTemplate = savedTemplates[savedTemplates.length - 1];
  if (latestTemplate) return latestTemplate.cover;

  try {
    const result = storedCoverTemplateSchema.safeParse(JSON.parse(raw));
    if (!result.success) return defaultCoverTemplate;
    return {
      title: result.data.title ?? defaultCoverTemplate.title,
      subtitle: result.data.subtitle ?? defaultCoverTemplate.subtitle,
      account: result.data.account ?? defaultCoverTemplate.account,
      footer: result.data.footer ?? defaultCoverTemplate.footer,
      avatarUrl: result.data.avatarUrl ?? defaultCoverTemplate.avatarUrl,
    };
  } catch {
    return defaultCoverTemplate;
  }
}

export function parseSavedCoverTemplate(
  raw: string | null,
): SavedCoverTemplate | null {
  return parseSavedCoverTemplates(raw)[0] ?? null;
}

export function parseSavedCoverTemplates(
  raw: string | null,
): SavedCoverTemplate[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = savedCoverTemplatesSchema.safeParse(parsed);
    if (result.success) {
      return result.data.map((template) => ({
        ...template,
        templateId: template.templateId ?? coverTemplateId,
        templateName: template.templateName ?? coverTemplateName,
        cover: {
          ...template.cover,
          footer: template.cover.footer ?? "",
        },
      }));
    }

    const legacy = storedCoverTemplateSchema.safeParse(parsed);
    if (!legacy.success || legacy.data.saved !== true) return [];
    return [
      {
        id: "legacy-cover-template",
        name: legacy.data.templateName ?? defaultSavedCoverName,
        templateId: coverTemplateId,
        templateName: coverTemplateName,
        cover: {
          title: legacy.data.title ?? defaultCoverTemplate.title,
          subtitle: legacy.data.subtitle ?? defaultCoverTemplate.subtitle,
          account: legacy.data.account ?? defaultCoverTemplate.account,
          footer: legacy.data.footer ?? defaultCoverTemplate.footer,
          avatarUrl: legacy.data.avatarUrl ?? defaultCoverTemplate.avatarUrl,
        },
      },
    ];
  } catch {
    return [];
  }
}

export function findSelectedCoverTemplate(
  templates: readonly SavedCoverTemplate[],
  selectedTemplateId: string,
): SavedCoverTemplate | undefined {
  if (selectedTemplateId === noCoverTemplateId) return undefined;
  return templates.find((template) => template.id === selectedTemplateId);
}

export function coverTextSize(
  text: string,
  preferredSize: number,
  availableWidth: number,
): string {
  const characterCount = Math.max(1, Array.from(text.trim() || "占").length);
  return `${Math.min(preferredSize, availableWidth / characterCount).toFixed(2)}cqw`;
}

export function coverDownloadFileName(title: string): string {
  const safeTitle = Array.from(title.trim())
    .filter((character) => /[\p{L}\p{N}_-]/u.test(character))
    .join("")
    .slice(0, 40);
  return `${safeTitle || "封面"}.png`;
}
