import { describe, expect, it, vi } from "vitest";

import {
  buildDialogueEndpoint,
  classifyDialogueProviderError,
  requestDialogueCompletion,
} from "./dialogue-provider";

describe("dialogue chat completions adapter", () => {
  it("builds the documented endpoint with or without a v1 suffix", () => {
    expect(buildDialogueEndpoint("https://www.hfsyapi.cn")).toBe(
      "https://www.hfsyapi.cn/v1/chat/completions",
    );
    expect(buildDialogueEndpoint("https://www.hfsyapi.cn/v1/")).toBe(
      "https://www.hfsyapi.cn/v1/chat/completions",
    );
  });

  it("sends an isolated bearer token and boolean stream parameter", async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "text-model",
          choices: [
            { message: { role: "assistant", content: "你好，有什么可以帮你？" } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      requestDialogueCompletion({
        apiKey: "dialogue-only-key",
        baseUrl: "https://www.hfsyapi.cn",
        model: "text-model",
        input: {
          messages: [{ role: "user", content: "你好" }],
          temperature: 0.7,
        },
        fetchImplementation: fakeFetch,
      }),
    ).resolves.toEqual({
      message: { role: "assistant", content: "你好，有什么可以帮你？" },
      model: "text-model",
    });

    const init = fakeFetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer dialogue-only-key",
    });
    const requestBody: unknown =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as unknown)
        : {};
    expect(requestBody).toMatchObject({
      model: "text-model",
      messages: [{ role: "user", content: "你好" }],
      stream: false,
      max_tokens: 4096,
    });
  });

  it("classifies provider failures without assuming every 4xx is a model error", () => {
    expect(
      classifyDialogueProviderError(404, {
        error: { message: "requested model was not found" },
      }),
    ).toEqual({ code: "DIALOGUE_MODEL_UNAVAILABLE", status: 400 });
    expect(
      classifyDialogueProviderError(400, {
        error: { message: "maximum context token length exceeded" },
      }),
    ).toEqual({ code: "DIALOGUE_CONTEXT_TOO_LONG", status: 400 });
    expect(classifyDialogueProviderError(429, {})).toEqual({
      code: "DIALOGUE_RATE_LIMITED",
      status: 429,
    });
    expect(
      classifyDialogueProviderError(400, {
        error: { message: "invalid request" },
      }),
    ).toEqual({ code: "DIALOGUE_REQUEST_REJECTED", status: 400 });
  });

  it("retries one transient provider failure", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "busy" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "text-model",
            choices: [{ message: { role: "assistant", content: "ok" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    await expect(
      requestDialogueCompletion({
        apiKey: "dialogue-only-key",
        baseUrl: "https://www.hfsyapi.cn",
        model: "text-model",
        input: {
          messages: [{ role: "user", content: "hello" }],
          temperature: 0.7,
        },
        fetchImplementation: fakeFetch,
      }),
    ).resolves.toMatchObject({ message: { content: "ok" } });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing dialogue key before making a provider request", async () => {
    const fakeFetch = vi.fn<typeof fetch>();
    await expect(
      requestDialogueCompletion({
        apiKey: "",
        baseUrl: "https://www.hfsyapi.cn",
        model: "text-model",
        input: {
          messages: [{ role: "user", content: "你好" }],
          temperature: 0.7,
        },
        fetchImplementation: fakeFetch,
      }),
    ).rejects.toThrow("DIALOGUE_API_KEY_REQUIRED");
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});
