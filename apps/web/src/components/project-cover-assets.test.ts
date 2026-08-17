import { describe, expect, it } from "vitest";

import {
  findReadyProjectCoverAssets,
  projectCoverDisplayState,
} from "./project-cover-assets";

describe("project cover assets", () => {
  it("returns only a complete portrait and landscape pair for the current revision", () => {
    const ready = findReadyProjectCoverAssets(3, [
      {
        id: "old-portrait",
        kind: "COVER_IMAGE",
        metadata: { projectRevision: 2 },
      },
      {
        id: "current-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: { projectRevision: 3 },
      },
      {
        id: "current-portrait",
        kind: "COVER_IMAGE",
        metadata: { projectRevision: 3 },
      },
    ]);

    expect(ready?.portrait.id).toBe("current-portrait");
    expect(ready?.landscape.id).toBe("current-landscape");
  });

  it("does not expose a fallback when either current cover is missing", () => {
    expect(
      findReadyProjectCoverAssets(3, [
        {
          id: "old-portrait",
          kind: "COVER_IMAGE",
          metadata: { projectRevision: 2 },
        },
        {
          id: "current-landscape",
          kind: "COVER_IMAGE_LANDSCAPE",
          metadata: { projectRevision: 3 },
        },
      ]),
    ).toBeNull();
  });

  it("ignores a superseded cover pair and restores the previous pair", () => {
    const ready = findReadyProjectCoverAssets(3, [
      {
        id: "superseded-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: { projectRevision: 3, superseded: true },
      },
      {
        id: "superseded-portrait",
        kind: "COVER_IMAGE",
        metadata: { projectRevision: 3, superseded: true },
      },
      {
        id: "previous-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: { projectRevision: 3 },
      },
      {
        id: "previous-portrait",
        kind: "COVER_IMAGE",
        metadata: { projectRevision: 3 },
      },
    ]);

    expect(ready?.portrait.id).toBe("previous-portrait");
    expect(ready?.landscape.id).toBe("previous-landscape");
  });

  it("prefers a complete model-summarized pair over a newer fallback pair", () => {
    const ready = findReadyProjectCoverAssets(3, [
      {
        id: "fallback-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: { projectRevision: 3, copySource: "fallback" },
      },
      {
        id: "fallback-portrait",
        kind: "COVER_IMAGE",
        metadata: { projectRevision: 3, copySource: "fallback" },
      },
      {
        id: "dialogue-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: { projectRevision: 3, copySource: "dialogue" },
      },
      {
        id: "dialogue-portrait",
        kind: "COVER_IMAGE",
        metadata: { projectRevision: 3, copySource: "dialogue" },
      },
    ]);

    expect(ready?.portrait.id).toBe("dialogue-portrait");
    expect(ready?.landscape.id).toBe("dialogue-landscape");
  });

  it("uses a complete fallback pair when the model pair is incomplete", () => {
    const ready = findReadyProjectCoverAssets(3, [
      {
        id: "dialogue-portrait-only",
        kind: "COVER_IMAGE",
        metadata: { projectRevision: 3, copySource: "dialogue" },
      },
      {
        id: "fallback-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: { projectRevision: 3, copySource: "fallback" },
      },
      {
        id: "fallback-portrait",
        kind: "COVER_IMAGE",
        metadata: { projectRevision: 3, copySource: "fallback" },
      },
    ]);

    expect(ready?.portrait.id).toBe("fallback-portrait");
    expect(ready?.landscape.id).toBe("fallback-landscape");
  });

  it("keeps the cover slot visible while generating and labels opt-out projects", () => {
    expect(
      projectCoverDisplayState({
        coverEnabled: true,
        projectCompleted: false,
        assetsReady: false,
      }),
    ).toBe("GENERATING");
    expect(
      projectCoverDisplayState({
        coverEnabled: false,
        projectCompleted: true,
        assetsReady: false,
      }),
    ).toBe("NONE");
    expect(
      projectCoverDisplayState({
        coverEnabled: true,
        projectCompleted: true,
        assetsReady: true,
      }),
    ).toBe("READY");
  });
});
