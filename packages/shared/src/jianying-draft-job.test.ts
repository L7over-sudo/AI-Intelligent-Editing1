import { describe, expect, it } from "vitest";

import { jianyingDraftGenerationInputSchema } from "./jianying-draft-job";

describe("jianying draft job schema", () => {
  it("accepts manual create and install actions", () => {
    expect(
      jianyingDraftGenerationInputSchema.parse({
        jobId: "job-create",
        projectId: "project-1",
        projectRevision: 1,
        action: "CREATE",
      }).action,
    ).toBe("CREATE");
    expect(
      jianyingDraftGenerationInputSchema.parse({
        jobId: "job-install",
        projectId: "project-1",
        projectRevision: 1,
        action: "INSTALL",
        draftJobId: "job-create",
      }).action,
    ).toBe("INSTALL");
  });

  it("rejects install actions without a source draft job", () => {
    expect(() =>
      jianyingDraftGenerationInputSchema.parse({
        jobId: "job-install",
        projectId: "project-1",
        projectRevision: 1,
        action: "INSTALL",
      }),
    ).toThrow();
  });
});
