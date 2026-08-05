import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const templateIdSchema = z
  .string()
  .regex(/^stpl_[a-f0-9]{20}$/u, "SUBTITLE_TEMPLATE_ID_INVALID");

export const subtitleTemplateStyleSchema = z
  .object({
    fontFamily: z.string().trim().min(1).max(120),
    fontSize: z.number().int().min(28).max(96),
    fontWeight: z.number().int().min(400).max(900),
    italic: z.boolean(),
    primaryColor: z.string().regex(/^#[0-9A-F]{6}$/u),
    backgroundColor: z.string().regex(/^#[0-9A-F]{6}$/u).nullable(),
    outlineColor: z.string().regex(/^#[0-9A-F]{6}$/u),
    outlineWidth: z.number().min(0).max(8),
    shadow: z.boolean(),
    shadowColor: z.string().regex(/^#[0-9A-F]{6}$/u),
    position: z.enum(["TOP", "CENTER", "BOTTOM"]),
  })
  .strict();

export const subtitleTemplateEntrySchema = z
  .object({
    id: templateIdSchema,
    name: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(160),
    previewRelativePath: z.string().trim().min(1).max(1_000),
    presetRelativePath: z.string().trim().min(1).max(1_000),
    sourceDraftRelativePath: z.string().trim().min(1).max(1_000).nullable(),
    style: subtitleTemplateStyleSchema,
  })
  .strict();

export const subtitleTemplateCatalogSchema = z
  .object({
    version: z.literal(1),
    rootName: z.string().trim().min(1).max(120),
    generatedAt: z.string().datetime(),
    source: z.literal("user-local-library"),
    templates: z.array(subtitleTemplateEntrySchema).max(1_000),
  })
  .strict();

export type SubtitleTemplateStyle = z.infer<
  typeof subtitleTemplateStyleSchema
>;
export type SubtitleTemplateEntry = z.infer<
  typeof subtitleTemplateEntrySchema
>;
export type SubtitleTemplateCatalog = z.infer<
  typeof subtitleTemplateCatalogSchema
>;

const presetMetadataSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
});

const textMaterialSchema = z.looseObject({
  background_alpha: z.number().optional(),
  background_color: z.string().optional(),
  bold_width: z.number().optional(),
  border_color: z.string().optional(),
  border_width: z.number().optional(),
  content: z.string().optional(),
  font_name: z.string().optional(),
  font_size: z.number().optional(),
  font_title: z.string().optional(),
  has_shadow: z.boolean().optional(),
  italic_degree: z.number().optional(),
  shadow_color: z.string().optional(),
  text_color: z.string().optional(),
  text_size: z.number().optional(),
});

const previewExtensions = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const metadataMaxBytes = 64 * 1024;
const draftMaxBytes = 2 * 1024 * 1024;

export function defaultSubtitleTemplateRoot(): string {
  return (
    process.env.SUBTITLE_TEMPLATE_LIBRARY_ROOT ??
    (process.platform === "win32"
      ? "E:\\codex\\素材库\\剪辑-剪映口播字幕模板合集"
      : "")
  );
}

export function defaultSubtitleTemplateCatalogPath(): string {
  return path.resolve(
    process.cwd(),
    "../..",
    "storage",
    "indexes",
    "subtitle-templates.json",
  );
}

function stableTemplateId(relativePath: string): string {
  return `stpl_${createHash("sha256")
    .update(relativePath.replaceAll("\\", "/").toLowerCase())
    .digest("hex")
    .slice(0, 20)}`;
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function safeHex(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/u.test(normalized)) return normalized;
  if (/^[0-9A-F]{6}$/u.test(normalized)) return `#${normalized}`;
  return null;
}

function unitColorToHex(value: unknown): string | null {
  const parsed = z.tuple([z.number(), z.number(), z.number()]).safeParse(value);
  if (!parsed.success) return null;
  const channels = parsed.data.map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel * 255))),
  );
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function contentPrimaryColor(content: string | undefined): string | null {
  if (!content) return null;
  try {
    const parsed = z
      .looseObject({
        styles: z
          .array(
            z.looseObject({
              fill: z
                .looseObject({
                  content: z
                    .looseObject({
                      solid: z
                        .looseObject({
                          color: z.unknown(),
                        })
                        .optional(),
                    })
                    .optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      })
      .parse(JSON.parse(content) as unknown);
    return unitColorToHex(
      parsed.styles?.[0]?.fill?.content?.solid?.color,
    );
  } catch {
    return null;
  }
}

function templatePosition(name: string, relativePath: string) {
  const value = `${name} ${relativePath}`;
  if (/顶部|上方|上排|顶层/u.test(value)) return "TOP" as const;
  if (/中间|居中|中心|屏幕中央/u.test(value)) return "CENTER" as const;
  return "BOTTOM" as const;
}

function findFirstTextMaterial(
  value: unknown,
  depth = 0,
): z.infer<typeof textMaterialSchema> | null {
  if (depth > 18 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstTextMaterial(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const object = value as Record<string, unknown>;
  const texts = object.texts;
  if (Array.isArray(texts)) {
    for (const text of texts) {
      const parsed = textMaterialSchema.safeParse(text);
      if (parsed.success) return parsed.data;
    }
  }
  for (const child of Object.values(object)) {
    const found = findFirstTextMaterial(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function styleFromMaterial(
  material: z.infer<typeof textMaterialSchema> | null,
  name: string,
  relativePath: string,
): SubtitleTemplateStyle {
  const rawSize =
    material?.text_size ??
    (material?.font_size ? material.font_size * 2 : 52);
  const fontSize = Math.max(28, Math.min(96, Math.round(rawSize)));
  const primaryColor =
    safeHex(material?.text_color) ??
    contentPrimaryColor(material?.content) ??
    "#FFFFFF";
  const borderWidth = Math.max(
    0,
    Math.min(8, (material?.border_width ?? 0.08) * 40),
  );
  const backgroundColor =
    (material?.background_alpha ?? 0) > 0.05
      ? safeHex(material?.background_color)
      : null;
  const fontName = (
    material?.font_name ||
    material?.font_title ||
    "Microsoft YaHei"
  ).trim();
  return subtitleTemplateStyleSchema.parse({
    fontFamily: fontName && fontName !== "none" ? fontName : "Microsoft YaHei",
    fontSize,
    fontWeight: (material?.bold_width ?? 0) > 0 ? 900 : 800,
    italic: Math.abs(material?.italic_degree ?? 0) > 0.01,
    primaryColor,
    backgroundColor,
    outlineColor: safeHex(material?.border_color) ?? "#171717",
    outlineWidth: Number(borderWidth.toFixed(2)),
    shadow: material?.has_shadow ?? true,
    shadowColor: safeHex(material?.shadow_color) ?? "#000000",
    position: templatePosition(name, relativePath),
  });
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(resolved);
      } else if (entry.isFile()) {
        files.push(resolved);
      }
    }
  }
  return files;
}

function categoryFromPath(root: string, presetPath: string): string {
  const relativeParts = path
    .relative(root, path.dirname(presetPath))
    .split(path.sep)
    .filter(Boolean);
  const parent = relativeParts.at(-2) ?? relativeParts.at(-1) ?? "本地字幕模板";
  return parent.slice(0, 160);
}

async function readTextMaterial(
  sourceDraftPath: string | null,
): Promise<z.infer<typeof textMaterialSchema> | null> {
  if (!sourceDraftPath) return null;
  try {
    if ((await stat(sourceDraftPath)).size > draftMaxBytes) return null;
    return findFirstTextMaterial(
      JSON.parse(await readFile(sourceDraftPath, "utf8")) as unknown,
    );
  } catch {
    return null;
  }
}

export async function buildSubtitleTemplateCatalog(
  configuredRoot = defaultSubtitleTemplateRoot(),
): Promise<SubtitleTemplateCatalog> {
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new Error("SUBTITLE_TEMPLATE_LIBRARY_ROOT_INVALID");
  }
  const root = path.resolve(configuredRoot);
  const files = await walkFiles(root);
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const candidates = files.filter((file) => {
    if (path.extname(file).toLowerCase() !== ".json") return false;
    if (path.basename(file).toLowerCase().startsWith("draft_")) return false;
    return !normalizeRelativePath(file).includes("/preset_draft/");
  });
  const templates: SubtitleTemplateEntry[] = [];

  for (const presetPath of candidates) {
    try {
      if ((await stat(presetPath)).size > metadataMaxBytes) continue;
      const metadata = presetMetadataSchema.parse(
        JSON.parse(await readFile(presetPath, "utf8")) as unknown,
      );
      const basePath = presetPath.slice(0, -path.extname(presetPath).length);
      const previewPath = [...previewExtensions]
        .map((extension) => `${basePath}${extension}`)
        .find((candidate) => fileSet.has(path.resolve(candidate)));
      if (!previewPath) continue;
      const draftCandidate = path.join(
        path.dirname(presetPath),
        "preset_draft",
        "draft_content.json",
      );
      const sourceDraftPath = fileSet.has(path.resolve(draftCandidate))
        ? draftCandidate
        : null;
      const presetRelativePath = normalizeRelativePath(
        path.relative(root, presetPath),
      );
      const material = await readTextMaterial(sourceDraftPath);
      templates.push(
        subtitleTemplateEntrySchema.parse({
          id: stableTemplateId(presetRelativePath),
          name: metadata.name,
          category: categoryFromPath(root, presetPath),
          previewRelativePath: normalizeRelativePath(
            path.relative(root, previewPath),
          ),
          presetRelativePath,
          sourceDraftRelativePath: sourceDraftPath
            ? normalizeRelativePath(path.relative(root, sourceDraftPath))
            : null,
          style: styleFromMaterial(
            material,
            metadata.name,
            presetRelativePath,
          ),
        }),
      );
    } catch {
      // Individual third-party presets can be malformed; valid presets remain usable.
    }
  }

  return subtitleTemplateCatalogSchema.parse({
    version: 1,
    rootName: path.basename(root),
    generatedAt: new Date().toISOString(),
    source: "user-local-library",
    templates: templates
      .sort((a, b) =>
        `${a.category}/${a.name}`.localeCompare(
          `${b.category}/${b.name}`,
          "zh-CN",
        ),
      )
      .slice(0, 1_000),
  });
}

export async function writeSubtitleTemplateCatalog(
  catalog: SubtitleTemplateCatalog,
  catalogPath = defaultSubtitleTemplateCatalogPath(),
): Promise<void> {
  await mkdir(path.dirname(catalogPath), { recursive: true });
  await writeFile(
    catalogPath,
    `${JSON.stringify(subtitleTemplateCatalogSchema.parse(catalog), null, 2)}\n`,
    "utf8",
  );
}

export async function loadSubtitleTemplateCatalog(
  catalogPath = defaultSubtitleTemplateCatalogPath(),
): Promise<SubtitleTemplateCatalog> {
  return subtitleTemplateCatalogSchema.parse(
    JSON.parse(await readFile(catalogPath, "utf8")) as unknown,
  );
}

export async function ensureSubtitleTemplateCatalog(): Promise<SubtitleTemplateCatalog> {
  try {
    return await loadSubtitleTemplateCatalog();
  } catch {
    const catalog = await buildSubtitleTemplateCatalog();
    await writeSubtitleTemplateCatalog(catalog);
    return catalog;
  }
}

export function resolveSubtitleTemplateFile(
  root: string,
  relativePath: string,
): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("SUBTITLE_TEMPLATE_PATH_OUTSIDE_ROOT");
  }
  return resolved;
}

export async function findSubtitleTemplate(
  templateId: string | undefined,
): Promise<SubtitleTemplateEntry | null> {
  if (!templateId || templateId === "BUILTIN") return null;
  const parsedId = templateIdSchema.parse(templateId);
  const catalog = await ensureSubtitleTemplateCatalog();
  return catalog.templates.find((template) => template.id === parsedId) ?? null;
}

