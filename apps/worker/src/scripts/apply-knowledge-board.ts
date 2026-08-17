import { getPrisma } from "@stickmotion/db";
import { subtitleStyleSchema } from "@stickmotion/shared";
import { z } from "zod";

const projectIdSchema = z.string().trim().min(1).optional();
const defaultHeader = "\u601d\u7ef4\u63d0\u5347|\u8868\u8fbe\u6c9f\u901a|\u804c\u573a\u6210\u957f|\u81ea\u6211\u7a81\u7834";

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
      mainTitle: subtitleStyle.mainTitle || "\u6807\u9898",
      leftVerticalText:
        subtitleStyle.leftVerticalText || "\u65e0\u9650\u8fdb\u5316\u7684Jay",
      rightVerticalText:
        subtitleStyle.rightVerticalText ||
        "\u4e2a\u4eba\u89c2\u70b9\n\n\u65e0\u4e0d\u826f\u5f15\u5bfc",
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
