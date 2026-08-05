import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildJianyingDraftDocuments,
  parseJianyingDraftsRoot,
  resolveDraftPath,
} from "./jianying-draft";

describe("jianying draft paths", () => {
  it("requires an absolute configured root", () => {
    expect(parseJianyingDraftsRoot(undefined)).toBeNull();
    expect(() => parseJianyingDraftsRoot("relative/drafts")).toThrow(
      "JIANYING_DRAFTS_DIR_ABSOLUTE_REQUIRED",
    );
  });

  it("keeps generated folders inside the configured root", () => {
    const root = path.resolve("D:/drafts");
    const resolved = resolveDraftPath(root, "../../bad title");
    expect(resolved.startsWith(`${root}${path.sep}`)).toBe(true);
    expect(path.basename(resolved)).toBe("bad-title");
  });
});

describe("jianying draft documents", () => {
  it("uses the same unique draft id in content, metadata, and root index", () => {
    const draftId = "11111111-2222-3333-4444-555555555555";
    const documents = buildJianyingDraftDocuments({
      draftId,
      draftPath: "D:/drafts/example",
      videoPath: "D:/drafts/example/materials/remix.mp4",
      coverPath: "D:/drafts/example/draft_cover.jpg",
      title: "StickMotion test",
      width: 1920,
      height: 1080,
      durationUs: 10_000_000,
      videoBytes: 1_024,
      now: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(documents.content.id).toBe(draftId);
    expect(documents.meta.draft_id).toBe(draftId);
    expect(documents.root.all_draft_store[0]?.draft_id).toBe(draftId);
    expect(documents.content.materials.videos[0]?.path).toBe(
      "D:/drafts/example/materials/remix.mp4",
    );
  });
});
