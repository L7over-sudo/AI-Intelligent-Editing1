import { z } from "zod";

import type { ImageSizePreset } from "@stickmotion/shared";

export const imageApiModelSchema = z.enum([
  "gpt-image-2",
  "gpt-image-2pro",
  "gpt-image-2-template",
  "nano-banana-2",
  "nano-banana-pro",
]);
export const imageApiSizeSchema = z.enum(["1K", "2K", "4K"]);

export type ImageApiModel = z.infer<typeof imageApiModelSchema>;
export type ImageApiSize = z.infer<typeof imageApiSizeSchema>;

export interface GenerateSceneImageInput {
  prompt: string;
  aspectRatio: "PORTRAIT" | "LANDSCAPE" | "WIDE";
  accentColor: string;
  imageSize?: ImageSizePreset;
  referenceImageUrls?: string[];
}

export interface ImageRequest {
  url: string;
  body: unknown;
  maxReferenceImages: number;
}

interface ExtractedImagePayload {
  base64?: string;
  url?: string;
  httpFallbackUrl?: string;
}

export const imageTextExclusionInstruction =
  "Use the storyboard content only to understand the scene. Do not copy the storyboard text verbatim into the image. Do not add logos or watermarks.";

export const ultrawideCompositionInstruction =
  "Use a balanced 21:9 ultrawide composition. Spread the visual story naturally across the full horizontal frame while keeping every key subject fully visible.";

const referenceImageSchema = z
  .string()
  .max(7_100_000)
  .refine(
    (value) =>
      value.startsWith("https://") ||
      /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(
        value,
      ),
    "Reference images must use HTTPS or a supported image data URL",
  );

interface ProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: ImageApiModel;
  imageSize?: ImageApiSize;
  fetchImplementation?: typeof fetch;
  retryDelaysMs?: readonly number[];
  sleepImplementation?: (milliseconds: number) => Promise<void>;
}

const gptSizes = {
  "gpt-image-2": {
    "1K": {
      PORTRAIT: "720x1280",
      LANDSCAPE: "1280x720",
      WIDE: "1344x576",
    },
  },
  "gpt-image-2pro": {
    "2K": { PORTRAIT: "1152x2048", LANDSCAPE: "2048x1152" },
    "4K": { PORTRAIT: "2160x3840", LANDSCAPE: "3840x2160" },
  },
} as const;

const presetRatioToExactSize: Partial<Record<ImageSizePreset, string>> = {
  "9:16": "720x1280",
  "16:9": "1280x720",
  "3:2": "1008x672",
  "21:9": "1344x576",
};

const exactSizeToAspectRatio: Record<string, string> = {
  "1024x1024": "1:1",
  "1040x832": "5:4",
  "720x1280": "9:16",
  "1280x720": "16:9",
  "1024x768": "4:3",
  "1008x672": "3:2",
  "832x1040": "4:5",
  "768x1024": "3:4",
  "672x1008": "2:3",
  "1344x576": "21:9",
};

const imageRedirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxImageRedirects = 3;

export function normalizeImageSize(
  model: ImageApiModel,
  requested: ImageApiSize,
): ImageApiSize {
  if (model === "gpt-image-2-template") return requested;
  if (model === "gpt-image-2") return "1K";
  if (model === "gpt-image-2pro" && requested === "1K") return "2K";
  return requested;
}

export function buildImageRequest(
  baseUrl: string,
  model: ImageApiModel,
  imageSize: ImageApiSize,
  input: GenerateSceneImageInput,
): ImageRequest {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/u, "");
  const references = z
    .array(referenceImageSchema)
    .parse(input.referenceImageUrls ?? []);
  const size = normalizeImageSize(model, imageSize);
  const selectedPreset =
    input.imageSize && input.imageSize !== "AUTO" ? input.imageSize : undefined;
  const selectedDimension = selectedPreset?.includes("x")
    ? selectedPreset
    : undefined;
  const selectedRatio =
    selectedPreset && !selectedPreset.includes("x")
      ? selectedPreset
      : undefined;

  if (model.startsWith("gpt-image-")) {
    const gptRequestModel: "gpt-image-2" | "gpt-image-2pro" =
      model === "gpt-image-2-template"
        ? size === "1K"
          ? "gpt-image-2"
          : "gpt-image-2pro"
        : model === "gpt-image-2"
          ? "gpt-image-2"
          : "gpt-image-2pro";
    const maxReferenceImages = gptRequestModel === "gpt-image-2pro" ? 4 : 6;
    if (references.length > maxReferenceImages) {
      throw new Error("IMAGE_REFERENCE_LIMIT_EXCEEDED");
    }
    const sizes =
      gptRequestModel === "gpt-image-2"
        ? gptSizes["gpt-image-2"]["1K"]
        : gptSizes["gpt-image-2pro"][size as "2K" | "4K"];
    const requestedSize =
      selectedDimension ??
      (selectedRatio ? presetRatioToExactSize[selectedRatio] : undefined) ??
      (input.aspectRatio === "PORTRAIT"
        ? sizes.PORTRAIT
        : input.aspectRatio === "WIDE" && "WIDE" in sizes
          ? sizes.WIDE
          : sizes.LANDSCAPE);
    return {
      url: `${normalizedBaseUrl}/v1/images/generations`,
      maxReferenceImages,
      body: {
        model: gptRequestModel,
        prompt: input.prompt,
        size: requestedSize,
        ...(references.length > 0 ? { reference_images: references } : {}),
        n: 1,
        // This relay documents b64_json as an image URL. Use b64_data so the
        // Worker receives the image directly and does not depend on a second
        // CDN download request.
        response_format: "b64_data",
      },
    };
  }

  const maxReferenceImages = 7;
  if (references.length > maxReferenceImages) {
    throw new Error("IMAGE_REFERENCE_LIMIT_EXCEEDED");
  }
  const nanoAspectRatio =
    selectedRatio ??
    (selectedDimension
      ? exactSizeToAspectRatio[selectedDimension]
      : undefined) ??
    (input.aspectRatio === "PORTRAIT"
      ? "9:16"
      : input.aspectRatio === "WIDE"
        ? "21:9"
        : "16:9");
  return {
    url: `${normalizedBaseUrl}/v1beta/models/${model}:generateContent`,
    maxReferenceImages,
    body: {
      contents: [
        {
          parts: [
            { text: input.prompt },
            ...references.map((fileUri) => {
              const dataMimeType =
                /^data:(image\/(?:jpeg|png|webp));base64,/u.exec(fileUri)?.[1];
              return {
                fileData: {
                  mimeType: dataMimeType ?? "image/png",
                  fileUri,
                },
              };
            }),
          ],
        },
      ],
      generationConfig: {
        imageConfig: {
          imageSize: size,
          aspectRatio: nanoAspectRatio,
        },
      },
    },
  };
}

const gptResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            b64_data: z.string().optional(),
            b64_json: z.string().optional(),
            url: z.string().url().optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const nanoResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(
                  z
                    .object({
                      fileData: z
                        .object({ fileUri: z.string().url() })
                        .passthrough()
                        .optional(),
                      inlineData: z
                        .object({ data: z.string() })
                        .passthrough()
                        .optional(),
                    })
                    .passthrough(),
                ),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .optional(),
    fileData: z.object({ fileUri: z.string().url() }).passthrough().optional(),
  })
  .passthrough();

export function normalizeImageDownloadUrl(
  value: string | undefined,
): string | undefined {
  if (!value || !/^https?:\/\//u.test(value)) return undefined;
  const url = new URL(value);
  assertPublicImageHost(url);
  url.protocol = "https:";
  return url.href;
}

function normalizeHttpImageFallbackUrl(
  value: string | undefined,
): string | undefined {
  if (!value || !/^http:\/\//u.test(value)) return undefined;
  const url = new URL(value);
  assertPublicImageHost(url);
  return url.href;
}

function assertPublicImageHost(url: URL): void {
  const hostname = url.hostname.toLowerCase();
  const privateIpv4 =
    /^127\./u.test(hostname) ||
    /^10\./u.test(hostname) ||
    /^192\.168\./u.test(hostname) ||
    /^169\.254\./u.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    privateIpv4
  ) {
    throw new Error("IMAGE_DOWNLOAD_URL_FORBIDDEN");
  }
}

function extractImagePayload(
  model: ImageApiModel,
  unsafeResponse: unknown,
): ExtractedImagePayload {
  const extractUrl = (value: string | undefined) => {
    const url = normalizeImageDownloadUrl(value);
    if (!url) return undefined;
    const httpFallbackUrl = normalizeHttpImageFallbackUrl(value);
    return {
      url,
      ...(httpFallbackUrl ? { httpFallbackUrl } : {}),
    };
  };

  if (model.startsWith("gpt-image-")) {
    const item = gptResponseSchema.parse(unsafeResponse).data[0];
    if (!item) throw new Error("IMAGE_DATA_MISSING");
    const value = item.b64_data ?? item.b64_json;
    const valueUrl = extractUrl(value);
    if (valueUrl) return valueUrl;
    if (value) return { base64: value };
    const itemUrl = extractUrl(item.url);
    if (itemUrl) return itemUrl;
    throw new Error("IMAGE_DATA_MISSING");
  }

  const response = nanoResponseSchema.parse(unsafeResponse);
  const parts = response.candidates?.flatMap(
    (candidate) => candidate.content.parts,
  );
  const inline = parts?.find((part) => part.inlineData)?.inlineData?.data;
  if (inline) return { base64: inline };
  const url =
    parts?.find((part) => part.fileData)?.fileData?.fileUri ??
    response.fileData?.fileUri;
  const normalizedUrl = extractUrl(url);
  if (normalizedUrl) return normalizedUrl;
  throw new Error("IMAGE_DATA_MISSING");
}

export class OpenAIImageProvider {
  readonly model: ImageApiModel;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #imageSize: ImageApiSize;
  readonly #fetch: typeof fetch;
  readonly #retryDelaysMs: readonly number[];
  readonly #sleep: (milliseconds: number) => Promise<void>;
  #retryQueue: Promise<void> = Promise.resolve();
  #activeGenerationRequests = 0;
  readonly #idleWaiters = new Set<() => void>();

  constructor(options?: ProviderOptions) {
    this.#apiKey =
      options?.apiKey ?? process.env.IMAGE_API_KEY ?? "";
    this.#baseUrl =
      options?.baseUrl ??
      process.env.IMAGE_API_BASE_URL ??
      "https://www.hfsyapi.cn";
    this.model = imageApiModelSchema.parse(
      options?.model ??
        process.env.IMAGE_API_MODEL ??
        process.env.OPENAI_IMAGE_MODEL ??
        "gpt-image-2",
    );
    this.#imageSize = normalizeImageSize(
      this.model,
      imageApiSizeSchema.parse(
        options?.imageSize ?? process.env.IMAGE_API_SIZE ?? "1K",
      ),
    );
    this.#fetch = options?.fetchImplementation ?? fetch;
    this.#retryDelaysMs = options?.retryDelaysMs ?? [1_200, 3_200, 6_500];
    this.#sleep =
      options?.sleepImplementation ??
      ((milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }));
  }

  async generate(input: GenerateSceneImageInput): Promise<Uint8Array> {
    if (!this.#apiKey) throw new Error("IMAGE_API_KEY_REQUIRED");
    const wantsUltrawide =
      input.aspectRatio === "WIDE" ||
      input.imageSize === "21:9" ||
      input.imageSize === "1344x576";
    const prompt = [
      input.prompt,
      ...(wantsUltrawide ? [ultrawideCompositionInstruction] : []),
      imageTextExclusionInstruction,
    ].join(" ");
    const request = buildImageRequest(
      this.#baseUrl,
      this.model,
      this.#imageSize,
      { ...input, prompt },
    );
    const response = await this.#requestGeneration(request);
    const payload = extractImagePayload(
      this.model,
      (await response.json()) as unknown,
    );
    if (payload.base64) {
      return Uint8Array.from(Buffer.from(payload.base64, "base64"));
    }
    if (!payload.url) throw new Error("IMAGE_DATA_MISSING");
    return this.#downloadImage(payload.url, payload.httpFallbackUrl);
  }

  async #downloadImage(
    url: string,
    httpFallbackUrl?: string,
  ): Promise<Uint8Array> {
    try {
      return await this.#downloadImageUrl(url);
    } catch (error) {
      if (!httpFallbackUrl || !isImageDownloadNetworkFailure(error)) {
        throw error;
      }
      return this.#downloadImageUrl(httpFallbackUrl);
    }
  }

  async #downloadImageUrl(url: string): Promise<Uint8Array> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const imageResponse = await this.#fetchImageResponse(url);
        if (!imageResponse.ok) {
          if (
            isRetryableImageStatus(imageResponse.status) &&
            attempt < this.#retryDelaysMs.length
          ) {
            await this.#waitBeforeRetry(this.#retryDelaysMs[attempt] ?? 0);
            continue;
          }
          throw new Error(`IMAGE_DOWNLOAD_FAILED_${imageResponse.status}`);
        }
        const contentLength = Number(
          imageResponse.headers.get("content-length") ?? "0",
        );
        if (contentLength > 12 * 1024 * 1024) {
          throw new Error("IMAGE_DOWNLOAD_TOO_LARGE");
        }
        const image = new Uint8Array(await imageResponse.arrayBuffer());
        if (image.byteLength > 12 * 1024 * 1024) {
          throw new Error("IMAGE_DOWNLOAD_TOO_LARGE");
        }
        return image;
      } catch (error) {
        if (isStableImageDownloadError(error)) throw error;
        if (attempt < this.#retryDelaysMs.length) {
          await this.#waitBeforeRetry(this.#retryDelaysMs[attempt] ?? 0);
          continue;
        }
        throw new Error("IMAGE_DOWNLOAD_NETWORK_FAILED", { cause: error });
      }
    }
  }

  async #fetchImageResponse(url: string): Promise<Response> {
    let currentUrl = url;
    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await this.#fetch(currentUrl, {
        redirect: "manual",
      });
      if (!imageRedirectStatuses.has(response.status)) return response;
      if (redirectCount >= maxImageRedirects) {
        throw new Error("IMAGE_DOWNLOAD_REDIRECT_LIMIT");
      }
      const location = response.headers.get("location");
      if (!location) throw new Error("IMAGE_DOWNLOAD_REDIRECT_INVALID");
      try {
        currentUrl = normalizeImageDownloadUrl(
          new URL(location, currentUrl).href,
        ) as string;
      } catch (error) {
        if (error instanceof Error && error.message === "IMAGE_DOWNLOAD_URL_FORBIDDEN") {
          throw error;
        }
        throw new Error("IMAGE_DOWNLOAD_REDIRECT_INVALID", { cause: error });
      }
    }
  }
  async #requestGeneration(request: ImageRequest): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetchGeneration(request.url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(request.body),
        });
      } catch (error) {
        if (attempt < this.#retryDelaysMs.length) {
          await this.#waitBeforeRetry(this.#retryDelaysMs[attempt] ?? 0);
          continue;
        }
        throw new Error("IMAGE_API_NETWORK_FAILED", { cause: error });
      }
      if (response.ok) return response;

      const detail = await safeImageApiError(response);
      if (
        isRetryableImageStatus(response.status) &&
        attempt < this.#retryDelaysMs.length
      ) {
        if (this.#activeGenerationRequests > 0) {
          await this.#waitForGenerationIdle();
        }
        await this.#waitBeforeRetry(this.#retryDelaysMs[attempt] ?? 0);
        continue;
      }
      throw new Error(
        `IMAGE_API_REQUEST_FAILED_${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
  }

  async #fetchGeneration(url: string, init: RequestInit): Promise<Response> {
    this.#activeGenerationRequests += 1;
    try {
      return await this.#fetch(url, init);
    } finally {
      this.#activeGenerationRequests -= 1;
      if (this.#activeGenerationRequests === 0) {
        for (const resolve of this.#idleWaiters) resolve();
        this.#idleWaiters.clear();
      }
    }
  }

  #waitForGenerationIdle(): Promise<void> {
    if (this.#activeGenerationRequests === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.#idleWaiters.add(resolve);
    });
  }

  async #waitBeforeRetry(milliseconds: number): Promise<void> {
    const scheduled = this.#retryQueue.then(() => this.#sleep(milliseconds));
    this.#retryQueue = scheduled.catch(() => undefined);
    await scheduled;
  }
}

function isRetryableImageStatus(status: number): boolean {
  return [403, 408, 425, 429, 500, 502, 503, 504].includes(status);
}

function isStableImageDownloadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith("IMAGE_DOWNLOAD_FAILED_") ||
      error.message.startsWith("IMAGE_DOWNLOAD_REDIRECT_") ||
      error.message === "IMAGE_DOWNLOAD_TOO_LARGE" ||
      error.message === "IMAGE_DOWNLOAD_URL_FORBIDDEN")
  );
}

function isImageDownloadNetworkFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "IMAGE_DOWNLOAD_NETWORK_FAILED"
  );
}

async function safeImageApiError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return body
    .replace(/<[^>]*>/gu, " ")
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[redacted]")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}
