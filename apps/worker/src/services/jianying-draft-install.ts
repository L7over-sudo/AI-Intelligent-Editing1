import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import {
  parseJianyingDraftsRoot,
  resolveDraftPath,
} from "./jianying-draft";

const metaSchema = z.looseObject({
  draft_id: z.string().min(1),
  draft_fold_path: z.string().min(1),
});
const contentSchema = z.looseObject({
  id: z.string().min(1),
  materials: z.looseObject({
    videos: z.array(z.looseObject({ path: z.string().min(1) })).min(1),
  }),
});
const rootSchema = z.looseObject({
  all_draft_store: z.array(metaSchema).min(1),
});

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replaceAll("\\", "/");
}

function assertInside(root: string, candidate: string, code: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(code);
  }
  return resolved;
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(path.relative(root, absolute));
    }
  }
  await visit(root);
  return result.sort();
}

async function fileHash(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function verifyInitialCopy(
  source: string,
  destination: string,
): Promise<void> {
  const sourceFiles = await listFiles(source);
  const destinationFiles = await listFiles(destination);
  if (JSON.stringify(sourceFiles) !== JSON.stringify(destinationFiles)) {
    throw new Error("JIANYING_DRAFT_COPY_FILESET_MISMATCH");
  }
  for (const relative of sourceFiles) {
    const [sourceSize, destinationSize] = await Promise.all([
      stat(path.join(source, relative)),
      stat(path.join(destination, relative)),
    ]);
    if (sourceSize.size !== destinationSize.size) {
      throw new Error("JIANYING_DRAFT_COPY_SIZE_MISMATCH");
    }
  }
}

async function rewriteDraftPaths(
  source: string,
  destination: string,
): Promise<void> {
  const sourcePath = normalizePath(source);
  const destinationPath = normalizePath(destination);
  for (const filename of [
    "draft_content.json",
    "draft_meta_info.json",
    "root_meta_info.json",
  ]) {
    const filePath = path.join(destination, filename);
    const body = await readFile(filePath, "utf8");
    await writeFile(
      filePath,
      body.replaceAll(sourcePath, destinationPath),
      "utf8",
    );
  }
}

async function reconcileAndValidateDraft(
  destination: string,
): Promise<string> {
  await delay(1_000);
  const contentPath = path.join(destination, "draft_content.json");
  const metaPath = path.join(destination, "draft_meta_info.json");
  const rootPath = path.join(destination, "root_meta_info.json");
  const [content, meta, root] = await Promise.all([
    readFile(contentPath, "utf8").then((body) =>
      contentSchema.parse(JSON.parse(body) as unknown),
    ),
    readFile(metaPath, "utf8").then((body) =>
      metaSchema.parse(JSON.parse(body) as unknown),
    ),
    readFile(rootPath, "utf8").then((body) =>
      rootSchema.parse(JSON.parse(body) as unknown),
    ),
  ]);

  content.id = meta.draft_id;
  root.all_draft_store[0]!.draft_id = meta.draft_id;
  root.all_draft_store[0]!.draft_fold_path = normalizePath(destination);
  await Promise.all([
    writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`, "utf8"),
    writeFile(rootPath, `${JSON.stringify(root, null, 2)}\n`, "utf8"),
  ]);

  const referencedVideo = content.materials.videos[0]!.path;
  if (
    !path.isAbsolute(referencedVideo) ||
    !referencedVideo.startsWith(`${normalizePath(destination)}/`)
  ) {
    throw new Error("JIANYING_DRAFT_VIDEO_PATH_INVALID");
  }
  await stat(referencedVideo);
  return meta.draft_id;
}

export async function installJianyingDraft(input: {
  stagingRoot: string;
  stagingPath: string;
  configuredRoot?: string | undefined;
}): Promise<{
  draftId: string;
  installedPath: string;
  stagingRemoved: true;
}> {
  const stagingPath = assertInside(
    input.stagingRoot,
    input.stagingPath,
    "JIANYING_STAGING_PATH_OUTSIDE_ROOT",
  );
  const installedRoot = parseJianyingDraftsRoot(
    input.configuredRoot ?? process.env.JIANYING_DRAFTS_DIR,
  );
  if (!installedRoot) throw new Error("JIANYING_DRAFTS_DIR_REQUIRED");
  await mkdir(installedRoot, { recursive: true });

  let installedPath = resolveDraftPath(
    installedRoot,
    path.basename(stagingPath),
  );
  try {
    await stat(installedPath);
    installedPath = resolveDraftPath(
      installedRoot,
      `${path.basename(stagingPath)}-${randomUUID().slice(0, 8)}`,
    );
  } catch {
    // Destination does not exist yet.
  }

  await cp(stagingPath, installedPath, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await verifyInitialCopy(stagingPath, installedPath);
  await rewriteDraftPaths(stagingPath, installedPath);

  const referencedVideo = contentSchema.parse(
    JSON.parse(await readFile(path.join(stagingPath, "draft_content.json"), "utf8")) as unknown,
  ).materials.videos[0]!.path;
  const relativeVideo = path.relative(
    normalizePath(stagingPath),
    normalizePath(referencedVideo),
  );
  if (relativeVideo.startsWith("..") || path.isAbsolute(relativeVideo)) {
    throw new Error("JIANYING_DRAFT_VIDEO_PATH_INVALID");
  }
  const sourceVideo = path.join(stagingPath, relativeVideo);
  const installedVideo = path.join(installedPath, relativeVideo);
  const [sourceHash, installedHash] = await Promise.all([
    fileHash(sourceVideo),
    fileHash(installedVideo),
  ]);
  if (sourceHash !== installedHash) {
    throw new Error("JIANYING_DRAFT_VIDEO_HASH_MISMATCH");
  }

  const draftId = await reconcileAndValidateDraft(installedPath);
  await rm(stagingPath, { recursive: true, force: false });
  return { draftId, installedPath, stagingRemoved: true };
}
