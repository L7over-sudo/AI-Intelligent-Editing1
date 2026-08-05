import { describe, expect, it } from "vitest";

import { enqueueJianyingDraft } from "./jianying-draft-jobs";

describe("enqueueJianyingDraft", () => {
  it("validates create and install payloads", async () => {
    await expect(
      enqueueJianyingDraft({
        jobId: "draft-create",
        projectId: "project-1",
        projectRevision: 1,
        action: "CREATE",
      }),
    ).resolves.toBe("draft-create");
    await expect(
      enqueueJianyingDraft({
        jobId: "draft-install",
        projectId: "project-1",
        projectRevision: 1,
        action: "INSTALL",
        draftJobId: "draft-create",
      }),
    ).resolves.toBe("draft-install");
  });
});
