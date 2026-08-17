import { z } from "zod";

import {
  normalizeCoverCopy,
  type CoverCopy,
  type DialogueCompletionResponse,
} from "@stickmotion/shared";

import { requestDialogueCompletion } from "./dialogue-provider";

export const coverCopyModel = "claude-sonnet-5";

const generatedCoverCopySchema = z
  .object({
    // Treat model length as recoverable formatting. normalizeCoverCopy is the
    // authoritative boundary and converts it to >=10 / <=12 characters.
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().min(1).max(240),
  })
  .strict();

const coverCopySystemPrompt = [
  "你是短视频封面标题编辑。",
  "请通读完整文案后真正总结一个主标题和一个副标题，不得直接截取原文开头。",
  "主标题必须正好4个字符，是完整中文短语；应概括核心人物、事件或冲突。",
  "副标题必须不少于10个字、最多12个字符，是完整判断，只能一行，并补充主标题没有说完的核心观点。",
  "严禁砍掉词尾或输出残缺词，例如不能把00后员工写成00后员。",
  "主标题和副标题不要重复，不要使用标点、引号、话题标签或账号名。",
  '只返回严格JSON：{"title":"主标题","subtitle":"副标题"}',
].join("\n");

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
    throw new Error("COVER_COPY_RESPONSE_INVALID");
  }
  try {
    return JSON.parse(source.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    throw new Error("COVER_COPY_RESPONSE_INVALID");
  }
}

export async function summarizeCoverCopy(options: {
  sourceText: string;
  apiKey: string;
  baseUrl: string;
  complete?: CompleteDialogue;
}): Promise<{ copy: CoverCopy; model: string }> {
  const complete = options.complete ?? requestDialogueCompletion;
  let previousResponse = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await complete({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: coverCopyModel,
      input: {
        temperature: attempt === 0 ? 0.2 : 0,
        messages: [
          { role: "system", content: coverCopySystemPrompt },
          {
            role: "user",
            content: `请根据以下完整文案生成封面标题：\n\n${options.sourceText}`,
          },
          ...(attempt === 1
            ? [
                {
                  role: "assistant" as const,
                  content: previousResponse,
                },
                {
                  role: "user" as const,
                  content:
                    "上一次结果不符合长度或语义完整性要求。请重新总结，确保主副标题都是完整表达，再只返回JSON。",
                },
              ]
            : []),
        ],
      },
    });
    previousResponse = response.message.content;
    let parsedObject: unknown;
    try {
      parsedObject = parseJsonObject(previousResponse);
    } catch {
      continue;
    }
    const parsed = generatedCoverCopySchema.safeParse(parsedObject);
    if (!parsed.success) continue;

    return {
      copy: normalizeCoverCopy({
        sourceText: options.sourceText,
        title: parsed.data.title,
        subtitle: parsed.data.subtitle,
      }),
      model: coverCopyModel,
    };
  }
  throw new Error("COVER_COPY_RESPONSE_INVALID");
}
