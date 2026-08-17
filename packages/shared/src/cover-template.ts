import { z } from "zod";

const coverImageDataUrlSchema = z
  .string()
  .max(3_000_000)
  .refine(
    (value) =>
      value === "" ||
      /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(
        value,
      ),
    "Cover avatar must be a supported image data URL",
  );

export const coverTemplateDataSchema = z
  .object({
    title: z.string().max(20),
    subtitle: z.string().max(40),
    account: z.string().max(30),
    footer: z.string().max(40).optional(),
    avatarUrl: coverImageDataUrlSchema,
  })
  .strict();

export const coverTemplateSelectionSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(40),
    templateId: z.enum(["black-white-opinion", "monochrome-career-character"]),
    templateName: z.string().trim().min(1).max(40),
    cover: coverTemplateDataSchema,
    avatarAssetId: z.string().min(1).optional(),
  })
  .strict();

export const coverCopySchema = z
  .object({
    title: z
      .string()
      .trim()
      .refine(
        (value) => Array.from(value).length === 4,
        "Cover title must contain exactly four complete characters",
      ),
    subtitle: z
      .string()
      .trim()
      .refine(
        (value) => Array.from(value).length >= 10,
        "Cover subtitle must contain at least ten complete characters",
      )
      .refine(
        (value) => Array.from(value).length <= 12,
        "Cover subtitle must contain no more than twelve complete characters",
      ),
  })
  .strict();

export type CoverTemplateData = z.infer<typeof coverTemplateDataSchema>;
export type CoverTemplateSelection = z.infer<
  typeof coverTemplateSelectionSchema
>;
export type CoverCopy = z.infer<typeof coverCopySchema>;

export const coverOutputRatioSchema = z.enum(["3:4", "16:9"]);
export type CoverOutputRatio = z.infer<typeof coverOutputRatioSchema>;

function cleanCoverText(value: string): string {
  return value
    .replace(/[\r\n]+/gu, "")
    .replace(/[，。！？!?；;：:、,.…“”"'（）()【】[\]《》<>]/gu, "")
    .replace(/\s+/gu, "")
    .trim();
}

function stripCoverLead(value: string): string {
  return cleanCoverText(value).replace(
    /^(?:你有没有发现|你有没有|有没有发现|有没有|你是否发现|为什么会|为什么|如何|怎样|当你发现)/u,
    "",
  );
}

function firstCoverSentence(value: string): string {
  return value.split(/[。！？!?；;]/u)[0]?.trim() ?? value.trim();
}

function deriveCoverCopy(sourceText: string): CoverCopy | null {
  const sentence = firstCoverSentence(sourceText.replace(/[\r\n\s]+/gu, ""));
  const strippedSentence = stripCoverLead(sentence);
  const yuePattern =
    /越([^，,。！？!?；;]{1,8}?)(?:的(?:事情|事|时候))[^。！？!?；;]*?越(?:容易|更容易|会|更会)?([^，,。！？!?；;]{1,8})/u;
  const yueFallbackPattern =
    /越([^，,。！？!?；;]{1,8})[^。！？!?；;]*?越(?:容易|更容易|会|更会)?([^，,。！？!?；;]{1,8})/u;
  const yueMatch =
    yuePattern.exec(strippedSentence) ??
    yueFallbackPattern.exec(strippedSentence);
  if (yueMatch?.[1] && yueMatch[2]) {
    const first = cleanCoverText(yueMatch[1]);
    const second = cleanCoverText(yueMatch[2]);
    if (first && second) {
      const title = `${first}${second}`;
      const subtitle = `越${first}越容易${second}`;
      const parsed = coverCopySchema.safeParse({ title, subtitle });
      if (parsed.success) return parsed.data;
    }
  }

  const notButMatch =
    /([^，,。！？!?；;]{1,12})不是([^，,。！？!?；;]{1,12})而是([^，,。！？!?；;]{1,12})/u.exec(
      stripCoverLead(sentence),
    );
  if (notButMatch?.[1] && notButMatch[3]) {
    const before = cleanCoverText(notButMatch[1]);
    const after = cleanCoverText(notButMatch[3]);
    const keyword = before.match(
      /成本|焦虑|拖延|工资|管理|选择|关系|情绪/u,
    )?.[0];
    if (after && keyword) {
      const title = `${keyword}真相`;
      const subtitle = `不是${cleanCoverText(notButMatch[2] ?? "")}而是${after}`;
      const parsed = coverCopySchema.safeParse({ title, subtitle });
      if (parsed.success) return parsed.data;
    }
  }

  return null;
}

function isWeakCoverCopy(value: string): boolean {
  return /^(?:你有没有|有没有|为什么|如何|怎样|当你发现)/u.test(
    cleanCoverText(value),
  );
}

function fallbackCoverTitle(sourceText: string): string {
  const source = cleanCoverText(sourceText);
  const topicRules: Array<[RegExp, string]> = [
    [/(?=.*会说话)(?=.*会回话)/u, "回话本事"],
    [/(?=.*职场)(?=.*爆发)(?=.*表达)/u, "表达边界"],
    [/(?=.*00后)(?=.*员工)/u, "职场新规"],
    [/(?=.*00后)(?=.*职场)/u, "职场新规"],
    [/(?=.*实习生)(?=.*离职)/u, "实习离职"],
    [/(?=.*性骚扰)(?=.*职场)/u, "职场骚扰"],
    [/(?=.*裁员)(?=.*女性)/u, "女性裁员"],
    [/(?=.*踩点)(?=.*上班)/u, "踩点上班"],
    [/(?=.*公司)(?=.*成本)/u, "成本真相"],
    [/(?=.*工作)(?=.*边界)/u, "工作边界"],
    [/(?=.*职场)(?=.*冲突)/u, "职场冲突"],
    [/(?=.*拖延)/u, "重要拖延"],
    [/(?=.*焦虑)/u, "焦虑真相"],
    [/(?=.*管理)/u, "管理真相"],
  ];
  return topicRules.find(([pattern]) => pattern.test(source))?.[1] ?? "文案核心";
}

function fallbackCoverSubtitle(sourceText: string): string {
  const source = cleanCoverText(sourceText);
  const topicRules: Array<[RegExp, string]> = [
    [/(?=.*会说话)(?=.*会回话)/u, "会回话才是职场真本事"],
    [/(?=.*职场)(?=.*爆发)(?=.*表达)/u, "真正成熟的表达要趁早"],
    [/(?=.*00后)(?=.*老板)/u, "年轻人与老板之间的冲突"],
    [/(?=.*00后)(?=.*员工)/u, "年轻员工正在重写职场规则"],
    [/(?=.*踩点)(?=.*上班)/u, "守住边界也要扛起责任"],
    [/(?=.*公司)(?=.*成本)/u, "管理问题正在拖垮公司"],
    [/(?=.*工作)(?=.*边界)/u, "无边界的工作让人崩溃"],
    [/(?=.*拖延)/u, "越重要的事越容易拖延"],
    [/(?=.*焦虑)/u, "焦虑背后才是真正的问题"],
    [/(?=.*管理)/u, "管理方式决定团队走向"],
  ];
  return (
    topicRules.find(([pattern]) => pattern.test(source))?.[1] ??
    "看懂事情背后的真正原因"
  );
}

function fitCoverTitle(value: string, sourceText: string): string {
  const candidate = cleanCoverText(value);
  const derived = deriveCoverCopy(sourceText);
  const candidateLength = Array.from(candidate).length;
  if (candidateLength === 4 && !isWeakCoverCopy(candidate)) {
    return candidate;
  }
  if (derived && Array.from(derived.title).length === 4) {
    return derived.title;
  }
  return fallbackCoverTitle(sourceText);
}

function fitCoverSubtitle(value: string, sourceText: string): string {
  const candidate = cleanCoverText(value);
  const derived = deriveCoverCopy(sourceText);
  if (derived && (!candidate || isWeakCoverCopy(candidate))) {
    return derived.subtitle;
  }
  const candidateLength = Array.from(candidate).length;
  if (
    candidateLength >= 10 &&
    candidateLength <= 12 &&
    !isWeakCoverCopy(candidate)
  ) {
    return candidate;
  }
  return fallbackCoverSubtitle(sourceText);
}

export function normalizeCoverCopy(input: {
  title?: string;
  subtitle?: string;
  sourceText: string;
}): CoverCopy {
  return coverCopySchema.parse({
    title: fitCoverTitle(input.title ?? "", input.sourceText),
    subtitle: fitCoverSubtitle(input.subtitle ?? "", input.sourceText),
  });
}
