import { getPrisma } from "../packages/db/src/index";

const jobId = process.argv[2];
if (!jobId || !/^[a-z0-9_-]+$/u.test(jobId)) {
  throw new Error("SCENE_JOB_ID_REQUIRED");
}

const prisma = getPrisma();
try {
  const job = await prisma.generationJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { type: true, status: true, progress: true },
  });
  if (job.type !== "SCENE" || job.status !== "FAILED") {
    throw new Error("FAILED_SCENE_JOB_REQUIRED");
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "RETRYING",
      attempt: 0,
      queuedAt: new Date(),
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      events: {
        create: {
          status: "RETRYING",
          progress: job.progress,
          code: "SCENE_JOB_RESUMED",
          message: "复用已完成画面并继续生成剩余分镜",
        },
      },
    },
  });
} finally {
  await prisma.$disconnect();
}
