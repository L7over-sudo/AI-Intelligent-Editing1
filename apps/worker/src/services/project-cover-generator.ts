import { randomUUID } from "node:crypto";

import type { getPrisma } from "@stickmotion/db";
import {
  coverCopySchema,
  normalizeCoverCopy,
  subtitleStyleSchema,
  type CoverCopy,
} from "@stickmotion/shared";
import type { LocalObjectStore } from "@stickmotion/storage";

import { summarizeCoverCopy } from "./cover-copy-provider";
import { renderCoverPng } from "./cover-renderer";

type PrismaClient = ReturnType<typeof getPrisma>;

export interface GeneratedProjectCovers {
  portraitAssetId: string | null;
  landscapeAssetId: string | null;
  copy: CoverCopy | null;
  model: string | null;
  source: "dialogue" | "fallback" | "disabled" | "preserved";
}

interface ProjectCoverAssetCandidate {
  id: string;
  kind: string;
  metadata: unknown;
}

function projectCoverCopyQuality(asset: ProjectCoverAssetCandidate): number {
  if (!asset.metadata || typeof asset.metadata !== "object") return 0;
  const source = (asset.metadata as Record<string, unknown>).copySource;
  if (source === "dialogue") return 2;
  if (source === "fallback") return 1;
  return 0;
}

export function findReusableProjectCoverPair(
  projectRevision: number,
  assets: readonly ProjectCoverAssetCandidate[],
): {
  portraitAssetId: string;
  landscapeAssetId: string;
  copy: CoverCopy | null;
  model: string | null;
} | null {
  const current = assets.filter((asset) => {
    if (!asset.metadata || typeof asset.metadata !== "object") return false;
    const metadata = asset.metadata as Record<string, unknown>;
    return (
      metadata.projectRevision === projectRevision &&
      metadata.superseded !== true
    );
  });
  let portrait: ProjectCoverAssetCandidate | undefined;
  let landscape: ProjectCoverAssetCandidate | undefined;
  for (const quality of [2, 1, 0]) {
    portrait = current.find(
      (asset) =>
        asset.kind === "COVER_IMAGE" &&
        projectCoverCopyQuality(asset) === quality,
    );
    landscape = current.find(
      (asset) =>
        asset.kind === "COVER_IMAGE_LANDSCAPE" &&
        projectCoverCopyQuality(asset) === quality,
    );
    if (portrait && landscape) break;
  }
  if (!portrait || !landscape) return null;

  const portraitMetadata = portrait.metadata as Record<string, unknown>;
  const landscapeMetadata = landscape.metadata as Record<string, unknown>;
  const copyResult = coverCopySchema.safeParse({
    title: portraitMetadata.title ?? landscapeMetadata.title,
    subtitle: portraitMetadata.subtitle ?? landscapeMetadata.subtitle,
  });
  if (!copyResult.success) return null;
  const model =
    typeof portraitMetadata.model === "string"
      ? portraitMetadata.model
      : typeof landscapeMetadata.model === "string"
        ? landscapeMetadata.model
        : null;

  return {
    portraitAssetId: portrait.id,
    landscapeAssetId: landscape.id,
    copy: copyResult.data,
    model,
  };
}

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export async function generateProjectCoversAfterRender(options: {
  prisma: PrismaClient;
  objectStore: LocalObjectStore;
  project: { id: string; sourceText: string; subtitleStyle: unknown };
  projectRevision: number;
}): Promise<GeneratedProjectCovers> {
  const style = subtitleStyleSchema.parse(options.project.subtitleStyle);
  const template = style.coverTemplate;
  if (!template) {
    return {
      portraitAssetId: null,
      landscapeAssetId: null,
      copy: null,
      model: null,
      source: "disabled",
    };
  }

  const reusablePair = findReusableProjectCoverPair(
    options.projectRevision,
    await options.prisma.asset.findMany({
      where: {
        projectId: options.project.id,
        kind: { in: ["COVER_IMAGE", "COVER_IMAGE_LANDSCAPE"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, metadata: true },
    }),
  );
  if (reusablePair) {
    return {
      ...reusablePair,
      source: "preserved",
    };
  }

  let copy: CoverCopy;
  let model: string | null = null;
  let source: GeneratedProjectCovers["source"] = "dialogue";
  let summaryError: string | undefined;
  try {
    const summary = await summarizeCoverCopy({
      sourceText: options.project.sourceText,
      apiKey: process.env.OPENAI_API_KEY ?? "",
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://www.hfsyapi.cn",
    });
    copy = summary.copy;
    model = summary.model;
  } catch (error) {
    source = "fallback";
    summaryError = cleanError(error);
    copy = normalizeCoverCopy({ sourceText: options.project.sourceText });
  }

  let avatarBytes: Uint8Array | undefined;
  if (template.avatarAssetId) {
    const avatar = await options.prisma.asset.findFirst({
      where: {
        id: template.avatarAssetId,
        projectId: options.project.id,
        kind: "COVER_AVATAR",
      },
    });
    if (!avatar) throw new Error("COVER_AVATAR_NOT_FOUND");
    avatarBytes = await options.objectStore.get(avatar.objectKey);
  }

  const current = await options.prisma.project.findUniqueOrThrow({
    where: { id: options.project.id },
    select: { revision: true },
  });
  if (current.revision !== options.projectRevision) {
    throw new Error("PROJECT_REVISION_STALE");
  }

  const renderInput = avatarBytes
    ? { template, copy, avatarBytes }
    : { template, copy };
  const outputs = await Promise.all([
    renderCoverPng({ ...renderInput, ratio: "3:4" as const }),
    renderCoverPng({ ...renderInput, ratio: "16:9" as const }),
  ]);
  const storedOutputs = await Promise.all(
    outputs.map(async (bytes, index) => {
      const ratio = index === 0 ? ("3:4" as const) : ("16:9" as const);
      const objectKey = `projects/${options.project.id}/covers/${options.projectRevision}-${ratio === "3:4" ? "portrait" : "landscape"}-${randomUUID()}.png`;
      return {
        ratio,
        stored: await options.objectStore.put(objectKey, bytes, "image/png"),
      };
    }),
  );
  const assets = await options.prisma.$transaction(async (tx) => {
    const latest = await tx.project.findUniqueOrThrow({
      where: { id: options.project.id },
      select: { revision: true },
    });
    if (latest.revision !== options.projectRevision) {
      throw new Error("PROJECT_REVISION_STALE");
    }
    return Promise.all(
      storedOutputs.map(({ ratio, stored }) =>
        tx.asset.create({
          data: {
            projectId: options.project.id,
            kind: ratio === "3:4" ? "COVER_IMAGE" : "COVER_IMAGE_LANDSCAPE",
            bucket: stored.bucket,
            objectKey: stored.objectKey,
            contentType: "image/png",
            byteSize: BigInt(stored.byteSize),
            source: "generated-after-render",
            license: "generated",
            metadata: {
              projectRevision: options.projectRevision,
              aspectRatio: ratio,
              templateId: template.templateId,
              templateName: template.templateName,
              templateInstanceName: template.name,
              title: copy.title,
              subtitle: copy.subtitle,
              copySource: source,
              requestedModel: "claude-sonnet-5",
              ...(model ? { model } : {}),
              ...(summaryError ? { summaryError } : {}),
            },
          },
        }),
      ),
    );
  });

  return {
    portraitAssetId: assets[0]?.id ?? null,
    landscapeAssetId: assets[1]?.id ?? null,
    copy,
    model,
    source,
  };
}
