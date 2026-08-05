import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import {
  imageApiModelSchema,
  imageApiSizeSchema,
  normalizeImageSize,
} from "./services/ai-image-provider";
import { ensureSoundEffectLibrary } from "./services/sound-effect-library";
import {
  defaultSubtitleTemplateRoot,
  ensureSubtitleTemplateCatalog,
  findSubtitleTemplate,
  resolveSubtitleTemplateFile,
} from "./services/subtitle-template-library";

const modelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:-]+$/u, "模型名称包含不支持的字符");

export const openAISettingsInputSchema = z
  .object({
    apiKey: z.string().trim().min(20).max(500).optional(),
    clearApiKey: z.boolean().default(false),
    imageApiKey: z.string().trim().min(1).max(500).optional(),
    clearImageApiKey: z.boolean().default(false),
    imageApiBaseUrl: z
      .string()
      .trim()
      .url()
      .startsWith("https://")
      .max(300),
    imageModel: imageApiModelSchema,
    imageSize: imageApiSizeSchema,
    scriptModel: modelNameSchema,
    ttsModel: modelNameSchema,
    transcribeModel: modelNameSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const normalized = normalizeImageSize(input.imageModel, input.imageSize);
    if (normalized !== input.imageSize) {
      context.addIssue({
        code: "custom",
        path: ["imageSize"],
        message:
          input.imageModel === "gpt-image-2"
            ? "gpt-image-2 仅支持 1K"
            : "gpt-image-2pro 仅支持 2K 或 4K",
      });
    }
  });

const settingKeys = {
  apiKey: "OPENAI_API_KEY",
  imageApiKey: "IMAGE_API_KEY",
  imageApiBaseUrl: "IMAGE_API_BASE_URL",
  imageModel: "IMAGE_API_MODEL",
  imageSize: "IMAGE_API_SIZE",
  scriptModel: "OPENAI_SCRIPT_MODEL",
  ttsModel: "OPENAI_TTS_MODEL",
  transcribeModel: "OPENAI_TRANSCRIBE_MODEL",
} as const;

const defaultSettings = {
  imageApiBaseUrl: "https://www.hfsyapi.cn",
  imageModel: "gpt-image-2",
  imageSize: "1K",
  scriptModel: "gpt-4.1-mini",
  ttsModel: "gpt-4o-mini-tts",
  transcribeModel: "gpt-4o-mini-transcribe",
} as const;

const workspaceEnvPath = path.resolve(process.cwd(), "../..", ".env");
const maxBodyBytes = 16 * 1024;

export function parseEnvFile(source: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    const key = match?.[1];
    const rawValue = match?.[2];
    if (!key || rawValue === undefined) continue;
    values.set(key, rawValue.replace(/^(['"])(.*)\1$/u, "$2").trim());
  }
  return values;
}

export function updateEnvFile(
  source: string,
  updates: Readonly<Record<string, string>>,
): string {
  const remaining = new Map(Object.entries(updates));
  const lines = source.split(/\r?\n/u).map((line) => {
    const key = /^([A-Z][A-Z0-9_]*)=/u.exec(line)?.[1];
    if (!key || !remaining.has(key)) return line;
    const value = remaining.get(key) ?? "";
    remaining.delete(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of remaining) lines.push(`${key}=${value}`);
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

async function readEnvSource(): Promise<string> {
  try {
    return await readFile(workspaceEnvPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function safeSettings() {
  const values = parseEnvFile(await readEnvSource());
  const imageModel = imageApiModelSchema.catch("gpt-image-2").parse(
    values.get(settingKeys.imageModel) ??
      values.get("OPENAI_IMAGE_MODEL") ??
      defaultSettings.imageModel,
  );
  const imageSize = normalizeImageSize(
    imageModel,
    imageApiSizeSchema.catch("1K").parse(
      values.get(settingKeys.imageSize) ?? defaultSettings.imageSize,
    ),
  );
  const imageApiKeyConfigured = Boolean(
    values.get(settingKeys.imageApiKey) ?? values.get(settingKeys.apiKey),
  );
  return {
    apiKeyConfigured: Boolean(values.get(settingKeys.apiKey)),
    imageApiKeyConfigured,
    imageApiUsesOpenAIKeyFallback:
      !values.get(settingKeys.imageApiKey) &&
      Boolean(values.get(settingKeys.apiKey)),
    imageApiBaseUrl:
      values.get(settingKeys.imageApiBaseUrl) ??
      defaultSettings.imageApiBaseUrl,
    imageModel,
    imageSize,
    scriptModel:
      values.get(settingKeys.scriptModel) || defaultSettings.scriptModel,
    ttsModel: values.get(settingKeys.ttsModel) || defaultSettings.ttsModel,
    transcribeModel:
      values.get(settingKeys.transcribeModel) ||
      defaultSettings.transcribeModel,
    workerReloadsAutomatically: true as const,
  };
}

async function saveSettings(unsafeInput: unknown) {
  const input = openAISettingsInputSchema.parse(unsafeInput);
  const source = await readEnvSource();
  const current = parseEnvFile(source);
  const updates: Record<string, string> = {
    [settingKeys.imageApiBaseUrl]: input.imageApiBaseUrl,
    [settingKeys.imageModel]: input.imageModel,
    [settingKeys.imageSize]: input.imageSize,
    [settingKeys.scriptModel]: input.scriptModel,
    [settingKeys.ttsModel]: input.ttsModel,
    [settingKeys.transcribeModel]: input.transcribeModel,
  };
  if (input.clearApiKey) {
    updates[settingKeys.apiKey] = "";
  } else if (input.apiKey) {
    updates[settingKeys.apiKey] = input.apiKey;
  } else if (!current.has(settingKeys.apiKey)) {
    updates[settingKeys.apiKey] = "";
  }
  if (input.clearImageApiKey) {
    updates[settingKeys.imageApiKey] = "";
  } else if (input.imageApiKey) {
    updates[settingKeys.imageApiKey] = input.imageApiKey;
  } else if (!current.has(settingKeys.imageApiKey)) {
    updates[settingKeys.imageApiKey] = "";
  }
  await writeFile(workspaceEnvPath, updateEnvFile(source, updates), {
    encoding: "utf8",
    mode: 0o600,
  });
  for (const [key, value] of Object.entries(updates)) {
    if (value) {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
  return safeSettings();
}

function allowedOrigins(): Set<string> {
  return new Set([
    process.env.APP_URL ?? "http://localhost:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
}

function setCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins().has(origin)) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "ORIGIN_NOT_ALLOWED" }));
    return false;
  }
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET, PUT, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    request.on("data", (chunk: unknown) => {
      let buffer: Uint8Array;
      if (typeof chunk === "string") {
        buffer = Buffer.from(chunk);
      } else if (chunk instanceof Uint8Array) {
        buffer = chunk;
      } else {
        reject(new Error("SETTINGS_BODY_INVALID"));
        return;
      }
      size += buffer.byteLength;
      if (size > maxBodyBytes) {
        reject(new Error("SETTINGS_BODY_TOO_LARGE"));
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      try {
        resolve(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error("INVALID_JSON"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

let soundEffectCatalogPromise:
  | ReturnType<typeof ensureSoundEffectLibrary>
  | undefined;

async function soundEffectCatalog() {
  if (process.env.SFX_LIBRARY_ENABLED === "false") {
    return { assets: [] };
  }
  soundEffectCatalogPromise ??= ensureSoundEffectLibrary();
  const assets = await soundEffectCatalogPromise;
  return {
    assets: [...assets.entries()].map(([tag, asset]) => ({
      tag,
      assetId: asset.assetId,
      displayName: asset.displayName,
      source: asset.source,
      license: asset.license,
    })),
  };
}

let subtitleTemplateCatalogPromise:
  | ReturnType<typeof ensureSubtitleTemplateCatalog>
  | undefined;

async function subtitleTemplateCatalog() {
  if (process.env.SUBTITLE_TEMPLATE_LIBRARY_ENABLED === "false") {
    return { source: "user-local-library", rootName: "", templates: [] };
  }
  subtitleTemplateCatalogPromise ??= ensureSubtitleTemplateCatalog();
  const catalog = await subtitleTemplateCatalogPromise;
  return {
    source: catalog.source,
    rootName: catalog.rootName,
    templates: catalog.templates.map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category,
      previewUrl: `/subtitle-templates/preview/${template.id}`,
      style: template.style,
    })),
  };
}

function previewContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

export function startSettingsServer() {
  const port = Number(process.env.STICKMOTION_SETTINGS_PORT ?? "4317");
  const server = createServer((request, response) => {
    void (async () => {
      if (!setCors(request, response)) return;
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (
        request.url === "/sound-effects/catalog" &&
        request.method === "GET"
      ) {
        try {
          sendJson(response, 200, await soundEffectCatalog());
        } catch {
          soundEffectCatalogPromise = undefined;
          sendJson(response, 500, { error: "SFX_CATALOG_LOAD_FAILED" });
        }
        return;
      }
      if (
        request.url === "/subtitle-templates/catalog" &&
        request.method === "GET"
      ) {
        try {
          sendJson(response, 200, await subtitleTemplateCatalog());
        } catch {
          subtitleTemplateCatalogPromise = undefined;
          sendJson(response, 500, {
            error: "SUBTITLE_TEMPLATE_CATALOG_LOAD_FAILED",
          });
        }
        return;
      }
      const previewMatch =
        request.method === "GET"
          ? /^\/subtitle-templates\/preview\/(stpl_[a-f0-9]{20})$/u.exec(
              request.url ?? "",
            )
          : null;
      if (previewMatch?.[1]) {
        try {
          const template = await findSubtitleTemplate(previewMatch[1]);
          if (!template) {
            sendJson(response, 404, { error: "SUBTITLE_TEMPLATE_NOT_FOUND" });
            return;
          }
          const filePath = resolveSubtitleTemplateFile(
            defaultSubtitleTemplateRoot(),
            template.previewRelativePath,
          );
          const preview = await readFile(filePath);
          response.writeHead(200, {
            "content-type": previewContentType(filePath),
            "content-length": preview.byteLength,
            "cache-control": "private, max-age=3600",
          });
          response.end(preview);
        } catch {
          sendJson(response, 404, { error: "SUBTITLE_TEMPLATE_NOT_FOUND" });
        }
        return;
      }
      if (request.url !== "/settings/openai") {
        sendJson(response, 404, { error: "NOT_FOUND" });
        return;
      }
      try {
        if (request.method === "GET") {
          sendJson(response, 200, { settings: await safeSettings() });
          return;
        }
        if (request.method === "PUT") {
          sendJson(response, 200, {
            settings: await saveSettings(await readJsonBody(request)),
          });
          return;
        }
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      } catch (error) {
        if (error instanceof z.ZodError) {
          sendJson(response, 400, {
            error: "VALIDATION_ERROR",
            issues: error.issues,
          });
          return;
        }
        sendJson(response, 500, { error: "SETTINGS_SAVE_FAILED" });
      }
    })();
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[worker] local settings ready on 127.0.0.1:${port}`);
  });
  return server;
}
