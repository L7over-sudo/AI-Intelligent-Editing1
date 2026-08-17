import { z } from "zod";

import {
  dialogueCompletionResponseSchema,
  type DialogueCompletionInput,
  type DialogueCompletionResponse,
} from "@stickmotion/shared";

const providerResponseSchema = z
  .object({
    model: z.string().trim().min(1).max(120).optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const providerErrorResponseSchema = z
  .object({
    error: z
      .union([
        z.string(),
        z
          .object({
            code: z.union([z.string(), z.number()]).optional(),
            message: z.string().optional(),
            type: z.string().optional(),
          })
          .passthrough(),
      ])
      .optional(),
    message: z.string().optional(),
  })
  .passthrough();

const dialogueRequestTimeoutMs = 60_000;
const dialogueMaxOutputTokens = 4_096;
const retryableProviderStatuses = new Set([408, 429, 500, 502, 503, 504]);

export class DialogueProviderError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export function buildDialogueEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/u, "");
  url.pathname = path.endsWith("/v1")
    ? `${path}/chat/completions`
    : `${path}/v1/chat/completions`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function providerErrorMessage(payload: unknown): string {
  const parsed = providerErrorResponseSchema.safeParse(payload);
  if (!parsed.success) return "";
  if (typeof parsed.data.error === "string") return parsed.data.error;
  return parsed.data.error?.message ?? parsed.data.message ?? "";
}

export function classifyDialogueProviderError(
  status: number,
  payload: unknown,
): { code: string; status: number } {
  if (status === 401 || status === 403) {
    return { code: "DIALOGUE_API_AUTH_FAILED", status };
  }
  if (status === 408 || status === 504) {
    return { code: "DIALOGUE_PROVIDER_TIMEOUT", status: 504 };
  }
  if (status === 429) {
    return { code: "DIALOGUE_RATE_LIMITED", status };
  }

  const message = providerErrorMessage(payload).toLowerCase();
  if (
    status === 404 ||
    /(?:model.{0,40}(?:not found|not exist|unavailable|unsupported|invalid)|(?:not found|invalid).{0,40}model)/u.test(
      message,
    )
  ) {
    return { code: "DIALOGUE_MODEL_UNAVAILABLE", status: 400 };
  }
  if (
    /(?:context|prompt|input).{0,50}(?:too long|length|token|maximum|max)|(?:too many|maximum|max).{0,30}token/u.test(
      message,
    )
  ) {
    return { code: "DIALOGUE_CONTEXT_TOO_LONG", status: 400 };
  }
  if (
    /(?:content|safety|moderation|policy).{0,40}(?:reject|block|violation)/u.test(
      message,
    )
  ) {
    return { code: "DIALOGUE_CONTENT_REJECTED", status: 400 };
  }
  if (status >= 500) {
    return { code: "DIALOGUE_PROVIDER_UNAVAILABLE", status: 502 };
  }
  return { code: "DIALOGUE_REQUEST_REJECTED", status: 400 };
}

export async function requestDialogueCompletion(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  input: DialogueCompletionInput;
  fetchImplementation?: typeof fetch;
}): Promise<DialogueCompletionResponse> {
  if (!options.apiKey) {
    throw new DialogueProviderError("DIALOGUE_API_KEY_REQUIRED", 503);
  }

  const fetchImplementation = options.fetchImplementation ?? fetch;
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImplementation(
        buildDialogueEndpoint(options.baseUrl),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            messages: options.input.messages,
            temperature: options.input.temperature,
            stream: false,
            max_tokens: dialogueMaxOutputTokens,
          }),
          signal: AbortSignal.timeout(dialogueRequestTimeoutMs),
        },
      );
    } catch {
      if (attempt === 0) continue;
      throw new DialogueProviderError("DIALOGUE_PROVIDER_UNREACHABLE", 502);
    }

    if (response.ok) break;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (attempt === 0 && retryableProviderStatuses.has(response.status)) {
      continue;
    }
    const classified = classifyDialogueProviderError(response.status, payload);
    throw new DialogueProviderError(classified.code, classified.status);
  }

  if (!response?.ok) {
    throw new DialogueProviderError("DIALOGUE_PROVIDER_UNAVAILABLE", 502);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DialogueProviderError("DIALOGUE_RESPONSE_INVALID", 502);
  }
  const parsed = providerResponseSchema.safeParse(payload);
  const content = parsed.success
    ? parsed.data.choices[0]?.message.content.trim()
    : "";
  if (!parsed.success || !content) {
    throw new DialogueProviderError("DIALOGUE_RESPONSE_INVALID", 502);
  }

  return dialogueCompletionResponseSchema.parse({
    message: { role: "assistant", content },
    model: parsed.data.model ?? options.model,
  });
}
