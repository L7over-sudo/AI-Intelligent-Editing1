import { describe, expect, it, vi } from "vitest";

import type { ImageSizePreset } from "@stickmotion/shared";

import {
  buildImageRequest,
  normalizeImageSize,
  OpenAIImageProvider,
} from "./ai-image-provider";

describe("hfsy image API adapter", () => {
  it("does not reuse the dialogue API key when the image key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "dialogue-key-must-stay-isolated");
    vi.stubEnv("IMAGE_API_KEY", "");
    const fakeFetch = vi.fn<typeof fetch>();

    try {
      const provider = new OpenAIImageProvider({
        fetchImplementation: fakeFetch,
      });

      await expect(
        provider.generate({
          prompt: "scene",
          aspectRatio: "PORTRAIT",
          accentColor: "#FF5C35",
        }),
      ).rejects.toThrow("IMAGE_API_KEY_REQUIRED");
      expect(fakeFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

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
      response_format: "b64_data",
    });
    expect(normalizeImageSize("gpt-image-2", "4K")).toBe("1K");
  });

  it("uses the native 21:9 size for a wide gpt-image-2 scene", () => {
    const wide = buildImageRequest(
      "https://www.hfsyapi.cn",
      "gpt-image-2",
      "1K",
      {
        prompt: "scene",
        aspectRatio: "WIDE",
        accentColor: "#FF5C35",
      },
    );

    expect(wide.body).toMatchObject({
      model: "gpt-image-2",
      size: "1344x576",
      response_format: "b64_data",
    });
  });

  it("uses a user-selected exact size for gpt-image-2", () => {
    const request = buildImageRequest(
      "https://www.hfsyapi.cn",
      "gpt-image-2",
      "1K",
      {
        prompt: "scene",
        aspectRatio: "PORTRAIT",
        accentColor: "#FF5C35",
        imageSize: "1040x832",
      },
    );

    expect(request.body).toMatchObject({
      model: "gpt-image-2",
      size: "1040x832",
    });
  });

  it("maps a selected ratio to its exact gpt-image-2 size", () => {
    const request = buildImageRequest(
      "https://www.hfsyapi.cn",
      "gpt-image-2",
      "1K",
      {
        prompt: "scene",
        aspectRatio: "PORTRAIT",
        accentColor: "#FF5C35",
        imageSize: "3:2",
      },
    );

    expect(request.body).toMatchObject({
      model: "gpt-image-2",
      size: "1008x672",
    });
  });

  it("routes the combined GPT template to the right model by size", () => {
    const oneK = buildImageRequest(
      "https://www.hfsyapi.cn",
      "gpt-image-2-template",
      "1K",
      {
        prompt: "scene",
        aspectRatio: "LANDSCAPE",
        accentColor: "#FF5C35",
      },
    );
    expect(oneK.body).toMatchObject({
      model: "gpt-image-2",
      size: "1280x720",
    });

    const fourK = buildImageRequest(
      "https://www.hfsyapi.cn",
      "gpt-image-2-template",
      "4K",
      {
        prompt: "scene",
        aspectRatio: "LANDSCAPE",
        accentColor: "#FF5C35",
      },
    );
    expect(fourK.body).toMatchObject({
      model: "gpt-image-2pro",
      size: "3840x2160",
    });
    expect(normalizeImageSize("gpt-image-2-template", "4K")).toBe("4K");
  });

  it("maps every selectable size preset to a supported request", () => {
    const presets: Array<{
      preset: ImageSizePreset;
      gptSize: string;
      nanoAspectRatio: string;
    }> = [
      { preset: "9:16", gptSize: "720x1280", nanoAspectRatio: "9:16" },
      { preset: "16:9", gptSize: "1280x720", nanoAspectRatio: "16:9" },
      { preset: "3:2", gptSize: "1008x672", nanoAspectRatio: "3:2" },
      { preset: "21:9", gptSize: "1344x576", nanoAspectRatio: "21:9" },
      { preset: "1024x1024", gptSize: "1024x1024", nanoAspectRatio: "1:1" },
      { preset: "1040x832", gptSize: "1040x832", nanoAspectRatio: "5:4" },
      { preset: "1024x768", gptSize: "1024x768", nanoAspectRatio: "4:3" },
      { preset: "832x1040", gptSize: "832x1040", nanoAspectRatio: "4:5" },
      { preset: "768x1024", gptSize: "768x1024", nanoAspectRatio: "3:4" },
      { preset: "672x1008", gptSize: "672x1008", nanoAspectRatio: "2:3" },
    ];

    for (const item of presets) {
      const gptRequest = buildImageRequest(
        "https://www.hfsyapi.cn",
        "gpt-image-2",
        "1K",
        {
          prompt: "scene",
          aspectRatio: "LANDSCAPE",
          accentColor: "#FF5C35",
          imageSize: item.preset,
        },
      );
      expect(gptRequest.body).toMatchObject({ size: item.gptSize });

      const nanoRequest = buildImageRequest(
        "https://www.hfsyapi.cn",
        "nano-banana-pro",
        "2K",
        {
          prompt: "scene",
          aspectRatio: "LANDSCAPE",
          accentColor: "#FF5C35",
          imageSize: item.preset,
        },
      );
      expect(nanoRequest.body).toMatchObject({
        generationConfig: {
          imageConfig: {
            imageSize: "2K",
            aspectRatio: item.nanoAspectRatio,
          },
        },
      });
    }
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

  it("maps an exact nano banana size preset to its aspect ratio", () => {
    const request = buildImageRequest(
      "https://www.hfsyapi.cn",
      "nano-banana-pro",
      "2K",
      {
        prompt: "scene",
        aspectRatio: "LANDSCAPE",
        accentColor: "#FF5C35",
        imageSize: "1344x576",
      },
    );

    expect(request.body).toMatchObject({
      generationConfig: {
        imageConfig: { imageSize: "2K", aspectRatio: "21:9" },
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

  it("retries and wraps a network failure while downloading a generated URL", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ url: "https://cdn.example.com/image.png" }] }),
          { status: 200 },
        ),
      )
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const provider = new OpenAIImageProvider({
      apiKey: "sk-test-image-key-123456789",
      model: "gpt-image-2",
      fetchImplementation: fakeFetch,
      retryDelaysMs: [0],
      sleepImplementation: () => Promise.resolve(),
    });

    await expect(
      provider.generate({
        prompt: "scene",
        aspectRatio: "LANDSCAPE",
        accentColor: "#FF5C35",
      }),
    ).rejects.toThrow("IMAGE_DOWNLOAD_NETWORK_FAILED");
    expect(fakeFetch).toHaveBeenCalledTimes(3);
  });

  it("retries a transient image download status", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ url: "https://cdn.example.com/image.png" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("image", { status: 200 }));
    const provider = new OpenAIImageProvider({
      apiKey: "sk-test-image-key-123456789",
      model: "gpt-image-2",
      fetchImplementation: fakeFetch,
      retryDelaysMs: [0],
      sleepImplementation: () => Promise.resolve(),
    });

    await expect(
      provider.generate({
        prompt: "scene",
        aspectRatio: "LANDSCAPE",
        accentColor: "#FF5C35",
      }),
    ).resolves.toEqual(new Uint8Array(Buffer.from("image")));
    expect(fakeFetch).toHaveBeenCalledTimes(3);
  });

  it("follows a validated HTTPS image redirect", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ url: "https://cdn.example.com/image" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/image.png" },
        }),
      )
      .mockResolvedValueOnce(new Response("image", { status: 200 }));
    const provider = new OpenAIImageProvider({
      apiKey: "sk-test-image-key-123456789",
      model: "gpt-image-2",
      fetchImplementation: fakeFetch,
      retryDelaysMs: [0],
      sleepImplementation: () => Promise.resolve(),
    });

    await expect(
      provider.generate({
        prompt: "scene",
        aspectRatio: "LANDSCAPE",
        accentColor: "#FF5C35",
      }),
    ).resolves.toEqual(new Uint8Array(Buffer.from("image")));
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    expect(fakeFetch.mock.calls[1]?.[1]).toMatchObject({ redirect: "manual" });
    expect(fakeFetch.mock.calls[2]?.[0]).toBe(
      "https://cdn.example.com/image.png",
    );
  });
});
