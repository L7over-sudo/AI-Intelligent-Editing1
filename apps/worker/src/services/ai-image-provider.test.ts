import { describe, expect, it, vi } from "vitest";

import {
  buildImageRequest,
  normalizeImageSize,
  OpenAIImageProvider,
} from "./ai-image-provider";

describe("hfsy image API adapter", () => {
  it("uses exact 1K dimensions for gpt-image-2", () => {
    const portrait = buildImageRequest(
      "https://www.hfsyapi.cn",
      "gpt-image-2",
      "4K",
      {
        prompt: "scene",
        aspectRatio: "PORTRAIT",
        accentColor: "#FF5C35",
      },
    );
    expect(portrait.body).toMatchObject({
      model: "gpt-image-2",
      size: "720x1280",
      response_format: "b64_json",
    });
    expect(normalizeImageSize("gpt-image-2", "4K")).toBe("1K");
  });

  it("builds nano banana requests with ratio and quality", () => {
    const request = buildImageRequest(
      "https://www.hfsyapi.cn/",
      "nano-banana-pro",
      "2K",
      {
        prompt: "scene",
        aspectRatio: "LANDSCAPE",
        accentColor: "#FF5C35",
        referenceImageUrls: ["https://example.com/reference.png"],
      },
    );
    expect(request.url).toBe(
      "https://www.hfsyapi.cn/v1beta/models/nano-banana-pro:generateContent",
    );
    expect(request.body).toMatchObject({
      generationConfig: {
        imageConfig: { imageSize: "2K", aspectRatio: "16:9" },
      },
    });
  });

  it("passes a local character reference as a safe image data URL", () => {
    const reference = `data:image/jpeg;base64,${Buffer.from(
      "reference",
    ).toString("base64")}`;
    const request = buildImageRequest(
      "https://www.hfsyapi.cn",
      "gpt-image-2",
      "1K",
      {
        prompt: "scene",
        aspectRatio: "PORTRAIT",
        accentColor: "#FF5C35",
        referenceImageUrls: [reference],
      },
    );

    expect(request.body).toMatchObject({
      reference_images: [reference],
    });
  });

  it("accepts b64_data responses without exposing the API key", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      calls.push({ url, ...(init ? { init } : {}) });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ b64_data: Buffer.from("image").toString("base64") }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    const provider = new OpenAIImageProvider({
      apiKey: "sk-test-image-key-123456789",
      model: "gpt-image-2",
      fetchImplementation: fakeFetch,
    });
    const image = await provider.generate({
      prompt: "scene",
      aspectRatio: "PORTRAIT",
      accentColor: "#FF5C35",
    });
    expect(Buffer.from(image).toString()).toBe("image");
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer sk-test-image-key-123456789",
    });
    const requestBody = JSON.parse(
      typeof calls[0]?.init?.body === "string" ? calls[0].init.body : "{}",
    ) as { prompt?: string };
    expect(requestBody.prompt).toContain(
      "Use the storyboard content only to understand the scene.",
    );
    expect(requestBody.prompt).toContain(
      "Do not copy the storyboard text verbatim into the image.",
    );
    expect(requestBody.prompt).toContain("Do not add logos or watermarks.");
    expect(requestBody.prompt).not.toContain("off-white");
    expect(requestBody.prompt).not.toContain("stick figure");
    expect(requestBody.prompt).not.toContain("accent color");
  });

  it("retries a transient 403 before returning the generated image", async () => {
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "temporary access limit" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_data: Buffer.from("image").toString("base64") }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const provider = new OpenAIImageProvider({
      apiKey: "sk-test-image-key-123456789",
      model: "gpt-image-2",
      fetchImplementation: fakeFetch,
      retryDelaysMs: [0],
      sleepImplementation: sleep,
    });

    await expect(
      provider.generate({
        prompt: "scene",
        aspectRatio: "LANDSCAPE",
        accentColor: "#FF5C35",
      }),
    ).resolves.toEqual(new Uint8Array(Buffer.from("image")));
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0);
  });
});
