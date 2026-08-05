import { getPrisma } from "@stickmotion/db";
import { z } from "zod";

import { synchronizeProjectSoundEffects } from "../services/sound-effect-library";

const projectIdSchema = z.string().trim().min(1).optional();

async function main(): Promise<void> {
  const prisma = getPrisma();
  const requestedProjectId = projectIdSchema.parse(process.argv[2]);
  const project = requestedProjectId
    ? await prisma.project.findFirst({
        where: { id: requestedProjectId, deletedAt: null },
        select: {
          id: true,
          revision: true,
          title: true,
          _count: { select: { scenes: true } },
        },
      })
    : await prisma.project.findFirst({
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          revision: true,
          title: true,
          _count: { select: { scenes: true } },
        },
      });

  if (!project) {
    console.log(JSON.stringify({ status: "NO_ACTIVE_PROJECT" }));
    await prisma.$disconnect();
    return;
  }

  const count = await synchronizeProjectSoundEffects(
    project.id,
    project.revision,
  );
  const placements = await prisma.soundPlacement.findMany({
    where: { scene: { projectId: project.id } },
    orderBy: [{ scene: { order: "asc" } }, { createdAt: "asc" }],
    select: {
      tag: true,
      offsetMs: true,
      gainDb: true,
      scene: { select: { order: true } },
    },
  });
  console.log(
    JSON.stringify({ status: "OK", project, count, placements }, null, 2),
  );
  await prisma.$disconnect();
}

await main();
