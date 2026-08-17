export const renderProgressSteps = [
  { label: "准备分镜、配音与字幕", minimum: 2 },
  { label: "渲染画面并混合音轨", minimum: 25 },
  { label: "保存 MP4", minimum: 95 },
  { label: "成片已完成", minimum: 100 },
] as const;

export function renderProgressPresentation(status: string, progress: number) {
  const normalized = Math.min(100, Math.max(0, Math.round(progress)));
  if (status === "QUEUED") {
    return { label: "正在排队，等待后台 Worker", progress: normalized };
  }
  if (status === "FAILED") {
    return { label: "渲染失败", progress: normalized };
  }
  if (status === "CANCEL_REQUESTED") {
    return { label: "正在取消…", progress: normalized };
  }
  if (status === "CANCELED") {
    return { label: "渲染已取消", progress: normalized };
  }
  if (status === "SUCCEEDED") {
    return { label: "成片已完成", progress: 100 };
  }
  if (normalized < 5) {
    return { label: "正在初始化渲染环境", progress: normalized };
  }
  if (normalized < 25) {
    return { label: "正在准备分镜、配音与字幕素材", progress: normalized };
  }
  if (normalized < 95) {
    return { label: "正在渲染视频画面并混合音轨", progress: normalized };
  }
  return { label: "正在保存 MP4", progress: normalized };
}
