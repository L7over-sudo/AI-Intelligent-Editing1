import { describe, expect, it } from "vitest";

import { findReusableProjectCoverPair } from "./project-cover-generator";

describe("findReusableProjectCoverPair", () => {
  it("reuses the latest complete non-superseded pair for a video rerender", () => {
    const pair = findReusableProjectCoverPair(4, [
      {
        id: "bad-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: { projectRevision: 4, superseded: true },
      },
      {
        id: "bad-portrait",
        kind: "COVER_IMAGE",
        metadata: { projectRevision: 4, superseded: true },
      },
      {
        id: "good-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: {
          projectRevision: 4,
          title: "上版标题",
          subtitle: "上版副标题内容要完整",
          model: "claude-sonnet-5",
        },
      },
      {
        id: "good-portrait",
        kind: "COVER_IMAGE",
        metadata: {
          projectRevision: 4,
          title: "上版标题",
          subtitle: "上版副标题内容要完整",
        },
      },
    ]);

    expect(pair).toEqual({
      portraitAssetId: "good-portrait",
      landscapeAssetId: "good-landscape",
      copy: { title: "上版标题", subtitle: "上版副标题内容要完整" },
      model: "claude-sonnet-5",
    });
  });

  it("does not preserve an old cover pair whose subtitle is shorter than ten characters", () => {
    const pair = findReusableProjectCoverPair(4, [
      {
        id: "short-portrait",
        kind: "COVER_IMAGE",
        metadata: {
          projectRevision: 4,
          title: "上版标题",
          subtitle: "上版副标题",
        },
      },
      {
        id: "short-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: {
          projectRevision: 4,
          title: "上版标题",
          subtitle: "上版副标题",
        },
      },
    ]);

    expect(pair).toBeNull();
  });

  it("requires both aspect ratios for the current revision", () => {
    expect(
      findReusableProjectCoverPair(4, [
        {
          id: "portrait-only",
          kind: "COVER_IMAGE",
          metadata: { projectRevision: 4 },
        },
      ]),
    ).toBeNull();
  });

  it("reuses a complete model-summarized pair before a newer fallback pair", () => {
    const pair = findReusableProjectCoverPair(4, [
      {
        id: "fallback-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: {
          projectRevision: 4,
          copySource: "fallback",
          title: "表达别等爆发",
          subtitle: "成熟表达要更早更清晰",
        },
      },
      {
        id: "fallback-portrait",
        kind: "COVER_IMAGE",
        metadata: {
          projectRevision: 4,
          copySource: "fallback",
          title: "表达别等爆发",
          subtitle: "成熟表达要更早更清晰",
        },
      },
      {
        id: "dialogue-landscape",
        kind: "COVER_IMAGE_LANDSCAPE",
        metadata: {
          projectRevision: 4,
          copySource: "dialogue",
          title: "别等爆发",
          subtitle: "及时表达胜过情绪决堤",
          model: "claude-sonnet-5",
        },
      },
      {
        id: "dialogue-portrait",
        kind: "COVER_IMAGE",
        metadata: {
          projectRevision: 4,
          copySource: "dialogue",
          title: "别等爆发",
          subtitle: "及时表达胜过情绪决堤",
        },
      },
    ]);

    expect(pair).toEqual({
      portraitAssetId: "dialogue-portrait",
      landscapeAssetId: "dialogue-landscape",
      copy: { title: "别等爆发", subtitle: "及时表达胜过情绪决堤" },
      model: "claude-sonnet-5",
    });
  });
});
