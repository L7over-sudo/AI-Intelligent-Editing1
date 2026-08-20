import { randomUUID } from "node:crypto";

import { getPrisma } from "@stickmotion/db";
import { enqueueRender } from "@stickmotion/queue";
import { z } from "zod";

const input = z
  .object({ projectId: z.string().min(1) })
  .parse({
    projectId: process.argv
      .slice(2)
      .find((value) => value !== "--" && value.length > 0),
  });

const prisma = getPrisma();
const project = await prisma.project.findUniqueOrThrow({
  where: { id: input.projectId },
  select: { id: true, revision: true },
});
const options = { watermark: "", introTitle: true, outro: true } as const;
const job = await prisma.generationJob.create({
  data: {
    projectId: project.id,
    type: "RENDER",
    status: "QUEUED",
    idempotencyKey: `render:${project.id}:${project.revision}:${randomUUID()}`,
    projectRevision: project.revision,
    input: options,
    events: {
      create: { status: "QUEUED", progress: 0, code: "RENDER_QUEUED" },
    },
  },
});
await enqueueRender({
  jobId: job.id,
  projectId: project.id,
  projectRevision: project.revision,
  ...options,
});
await prisma.project.update({
  where: { id: project.id },
  data: { status: "RENDERING" },
});

console.log(JSON.stringify({ jobId: job.id, status: job.status }));
await prisma.$disconnect();
