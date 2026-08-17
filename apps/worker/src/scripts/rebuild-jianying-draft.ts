import path from "node:path";

import { config as loadEnv } from "dotenv";

import { getPrisma } from "@stickmotion/db";
import { LocalObjectStore } from "@stickmotion/storage";

import { runFfmpeg } from "../services/ffmpeg-runner";
import { createJianyingDraft } from "../services/jianying-draft";
import { installJianyingDraft } from "../services/jianying-draft-install";
import { collectJianyingDraftInput } from "../services/jianying-draft-project";

function requiredProjectId(value: string | undefined): string {
  if (!value) throw new Error("PROJECT_ID_REQUIRED");
  return value;
}

const workspaceEnvPath = path.resolve(process.cwd(), "../..", ".env");
loadEnv({ path: workspaceEnvPath, override: true, quiet: true });

const projectId = requiredProjectId(process.argv[2]);
const workspaceRoot = path.resolve(process.cwd(), "../..");
const stagingRoot = path.join(workspaceRoot, "work", "jianying-drafts");

async function main(): Promise<void> {
  const prisma = getPrisma();
  try {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, title: true, revision: true },
    });
    const objectStore = new LocalObjectStore();
    const draftInput = await collectJianyingDraftInput(
      projectId,
      project.revision,
      objectStore,
    );
    const created = await createJianyingDraft(
      draftInput,
      runFfmpeg,
      path.join(stagingRoot, projectId),
    );
    if (!created) throw new Error("JIANYING_STAGING_ROOT_REQUIRED");

    const installed = await installJianyingDraft({
      stagingRoot,
      stagingPath: created.draftPath,
    });
    const result = {
      projectId,
      projectTitle: project.title,
      projectRevision: project.revision,
      draftId: installed.draftId,
      installedPath: installed.installedPath,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
