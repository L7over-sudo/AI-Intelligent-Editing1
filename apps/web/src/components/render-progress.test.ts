import { describe, expect, it } from "vitest";

import { renderProgressPresentation } from "./render-progress";

describe("renderProgressPresentation", () => {
  it.each([
    [2, "正在初始化渲染环境"],
    [18, "正在准备分镜、配音与字幕素材"],
    [57, "正在渲染视频画面并混合音轨"],
    [97, "正在保存 MP4"],
  ])("describes progress %s", (progress, label) => {
    expect(renderProgressPresentation("RUNNING", progress).label).toBe(label);
  });

  it("always shows a completed render at 100 percent", () => {
    expect(renderProgressPresentation("SUCCEEDED", 57)).toEqual({
      label: "成片已完成",
      progress: 100,
    });
  });

  it("distinguishes canceling from canceled renders", () => {
    expect(renderProgressPresentation("CANCEL_REQUESTED", 63)).toEqual({
      label: "正在取消…",
      progress: 63,
    });
    expect(renderProgressPresentation("CANCELED", 63)).toEqual({
      label: "渲染已取消",
      progress: 63,
    });
  });
});
