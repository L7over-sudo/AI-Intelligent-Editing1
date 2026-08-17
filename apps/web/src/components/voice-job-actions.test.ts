import { describe, expect, it } from "vitest";

import {
  failedVoiceSceneIds,
  latestVoiceJobAttempts,
} from "./voice-job-actions";

describe("latestVoiceJobAttempts", () => {
  it("keeps only the newest attempt for each voice group", () => {
    const jobs = [
      {
        id: "new",
        status: "QUEUED",
        createdAt: "2026-08-14T10:00:00.000Z",
        input: { sceneId: "scene-1" },
      },
      {
        id: "old",
        status: "FAILED",
        createdAt: "2026-08-14T09:00:00.000Z",
        input: { sceneId: "scene-1" },
      },
    ];

    expect(latestVoiceJobAttempts(jobs).map((job) => job.id)).toEqual(["new"]);
  });
});

describe("failedVoiceSceneIds", () => {
  it("returns only failed scenes from the latest attempts", () => {
    const jobs = [
      {
        id: "failed",
        status: "FAILED",
        createdAt: "2026-08-14T10:00:00.000Z",
        input: { sceneId: "scene-1" },
      },
      {
        id: "succeeded",
        status: "SUCCEEDED",
        createdAt: "2026-08-14T09:00:00.000Z",
        input: { sceneId: "scene-2" },
      },
    ];

    expect(failedVoiceSceneIds(jobs, ["scene-1", "scene-2"])).toEqual([
      "scene-1",
    ]);
  });
});
