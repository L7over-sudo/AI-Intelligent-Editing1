import { getPrisma } from "@stickmotion/db";
import { subtitleStyleSchema } from "@stickmotion/shared";
import { z } from "zod";

const projectIdSchema = z.string().trim().min(1).optional();
const defaultHeader = "— 思维提升 | 表达沟通 | 职场成长 | 自我突破 —";

const prisma = getPrisma();
const requestedProjectId = projectIdSchema.parse(process.argv[2]);
const project = requestedProjectId
  ? await prisma.project.findFirst({
      where: { id: requestedProjectId, deletedAt: null },
      select: { id: true, title: true, subtitleStyle: true },
    })
  : await prisma.project.findFirst({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, subtitleStyle: true },
    });

if (!project) {
  console.log(JSON.stringify({ status: "NO_ACTIVE_PROJECT" }));
  await prisma.$disconnect();
  process.exit(0);
}

const activeJob = await prisma.generationJob.findFirst({
  where: {
    projectId: project.id,
    status: { in: ["QUEUED", "RUNNING", "RETRYING"] },
  },
  select: { id: true, type: true, status: true },
});
if (activeJob) {
  throw new Error(
    `PROJECT_HAS_ACTIVE_JOB:${activeJob.type}:${activeJob.status}`,
  );
}

const subtitleStyle = subtitleStyleSchema.parse(project.subtitleStyle);
await prisma.project.update({
  where: { id: project.id },
  data: {
    subtitleStyle: {
      ...subtitleStyle,
      videoTemplate: "KNOWLEDGE_BOARD",
      headerText: subtitleStyle.headerText || defaultHeader,
    },
  },
});
console.log(
  JSON.stringify(
    {
      status: "OK",
      project: { id: project.id, title: project.title },
      videoTemplate: "KNOWLEDGE_BOARD",
      headerText: subtitleStyle.headerText || defaultHeader,
    },
    null,
    2,
  ),
);
await prisma.$disconnect();
