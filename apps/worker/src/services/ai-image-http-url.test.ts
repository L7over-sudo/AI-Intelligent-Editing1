import { describe, expect, it, vi } from "vitest";

import {
  normalizeImageDownloadUrl,
  OpenAIImageProvider,
} from "./ai-image-provider";

describe("image provider HTTP URL compatibility", () => {
  it("upgrades a public provider URL to HTTPS before downloading", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                url: "http://images.example.com/generated/scene.png?token=ok",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": "3",
          },
        }),
      );
    const provider = new OpenAIImageProvider({
      apiKey: "sk-test-image-key",
      model: "gpt-image-2",
      fetchImplementation: fetchMock,
    });

    await expect(
      provider.generate({
        prompt: "scene",
        aspectRatio: "LANDSCAPE",
        accentColor: "#19B9C6",
      }),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://images.example.com/generated/scene.png?token=ok",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({ redirect: "error" });
  });

  it("rejects local and private image download URLs", () => {
    expect(() =>
      normalizeImageDownloadUrl("http://127.0.0.1/private.png"),
    ).toThrow("IMAGE_DOWNLOAD_URL_FORBIDDEN");
    expect(() =>
      normalizeImageDownloadUrl("http://192.168.1.2/private.png"),
    ).toThrow("IMAGE_DOWNLOAD_URL_FORBIDDEN");
  });
});
