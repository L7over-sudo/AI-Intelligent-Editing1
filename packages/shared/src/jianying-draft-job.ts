import { z } from "zod";

const jobBase = {
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  projectRevision: z.number().int().positive(),
};

export const jianyingDraftGenerationInputSchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        ...jobBase,
        action: z.literal("CREATE"),
      })
      .strict(),
    z
      .object({
        ...jobBase,
        action: z.literal("INSTALL"),
        draftJobId: z.string().min(1),
      })
      .strict(),
  ],
);

export const jianyingDraftCreateOutputSchema = z
  .object({
    action: z.literal("CREATE"),
    draftId: z.string().min(1),
    stagingPath: z.string().min(1),
  })
  .strict();

export const jianyingDraftInstallOutputSchema = z
  .object({
    action: z.literal("INSTALL"),
    draftId: z.string().min(1),
    draftJobId: z.string().min(1),
    installedPath: z.string().min(1),
    stagingRemoved: z.literal(true),
  })
  .strict();

export type JianyingDraftGenerationInput = z.infer<
  typeof jianyingDraftGenerationInputSchema
>;
