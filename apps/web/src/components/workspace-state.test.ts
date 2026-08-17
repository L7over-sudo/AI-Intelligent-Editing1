import { describe, expect, it } from "vitest";

import {
  parseStoredProjectWorkspaceState,
  parseStoredWorkspaceState,
  projectWorkspaceStateStorageKey,
} from "./workspace-state";

describe("workspace state storage", () => {
  it("restores the last view and selected project", () => {
    expect(
      parseStoredWorkspaceState(
        JSON.stringify({ view: "export", selectedProjectId: "project-1" }),
      ),
    ).toEqual({ view: "export", selectedProjectId: "project-1" });
  });

  it("rejects malformed workspace state", () => {
    expect(
      parseStoredWorkspaceState(
        JSON.stringify({ view: "unknown", selectedProjectId: 1 }),
      ),
    ).toBeUndefined();
    expect(parseStoredWorkspaceState("not-json")).toBeUndefined();
  });

  it("restores project selections and unsaved scene drafts", () => {
    const stored = {
      selectedSceneIds: ["scene-1"],
      expandedSceneIds: ["scene-1", "scene-2"],
      selectedRenderOutputId: "output-2",
      sceneDrafts: {
        "scene-1": { narration: "尚未保存的旁白", subtitle: "草稿字幕" },
      },
    };

    expect(
      parseStoredProjectWorkspaceState(JSON.stringify(stored)),
    ).toEqual(stored);
    expect(projectWorkspaceStateStorageKey("project-1")).toContain(
      "project-1",
    );
  });

  it("rejects unknown scene draft fields", () => {
    expect(
      parseStoredProjectWorkspaceState(
        JSON.stringify({
          selectedSceneIds: [],
          expandedSceneIds: [],
          selectedRenderOutputId: "",
          sceneDrafts: { "scene-1": { narration: "ok", unsafe: true } },
        }),
      ),
    ).toBeUndefined();
  });
});
