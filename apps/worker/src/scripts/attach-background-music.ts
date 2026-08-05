import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getPrisma } from "@stickmotion/db";
import { LocalObjectStore } from "@stickmotion/storage";

const projectId = process.argv[2];
const audioPath = process.env.BGM_INPUT_PATH;
if (!projectId || !audioPath) {
  throw new Error(
    "USAGE: BGM_INPUT_PATH=<path> tsx attach-background-music.ts <projectId>",
  );
}

const prisma = getPrisma();
const objectStore = new LocalObjectStore();
const project = await prisma.project.findUnique({ where: { id: projectId } });
if (!project) throw new Error("PROJECT_NOT_FOUND");

const body = await readFile(audioPath);
const extension = path.extname(audioPath).toLowerCase();
const contentType =
  extension === ".wav" ? "audio/wav" : extension === ".m4a" ? "audio/mp4" : "audio/mpeg";
const safeName = path
  .basename(audioPath)
  .replace(/[^a-zA-Z0-9._-]/gu, "_");
const objectKey = `projects/${projectId}/uploads/${randomUUID()}-${safeName}`;
const stored = await objectStore.put(
  objectKey,
  new Uint8Array(body),
  contentType,
);

const existing = await prisma.asset.findMany({
  where: { projectId, kind: "BGM" },
  select: { id: true, objectKey: true },
});
for (const asset of existing) {
  await objectStore.delete(asset.objectKey);
}
await prisma.asset.deleteMany({ where: { projectId, kind: "BGM" } });

const asset = await prisma.asset.create({
  data: {
    projectId,
    kind: "BGM",
    bucket: stored.bucket,
    objectKey: stored.objectKey,
    contentType,
    byteSize: BigInt(stored.byteSize),
    source: "user-upload",
    license: "user-confirmed",
  },
});

console.log(
  JSON.stringify({
    projectId,
    assetId: asset.id,
    objectKey,
    contentType,
    byteSize: stored.byteSize,
  }),
);
