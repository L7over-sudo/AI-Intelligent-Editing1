import { existsSync } from "node:fs";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { getRemotionEntryPoint } from "@stickmotion/remotion-video";
import {
  remotionRenderInputSchema,
  type RemotionRenderInput,
} from "@stickmotion/shared";

export type RemotionRenderRequest = {
  plan: RemotionRenderInput;
  publicDir: string;
  bundleDir: string;
  outputPath: string;
  onProgress: (progress: number) => void;
};

export type RemotionRenderer = (
  request: RemotionRenderRequest,
) => Promise<void>;

export const runRemotion: RemotionRenderer = async ({
  plan: rawPlan,
  publicDir,
  bundleDir,
  outputPath,
  onProgress,
}) => {
  const plan = remotionRenderInputSchema.parse(rawPlan);
  const windowsChrome =
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browserExecutable =
    process.env.REMOTION_BROWSER_EXECUTABLE ??
    (process.platform === "win32" && existsSync(windowsChrome)
      ? windowsChrome
      : undefined);
  const serveUrl = await bundle({
    entryPoint: getRemotionEntryPoint(),
    publicDir,
    outDir: bundleDir,
    enableCaching: true,
    onProgress: (progress) => onProgress(progress * 0.1),
  });
  const composition = await selectComposition({
    serveUrl,
    id: "StickMotionVideo",
    inputProps: plan,
    ...(browserExecutable ? { browserExecutable } : {}),
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    audioCodec: "aac",
    outputLocation: outputPath,
    inputProps: plan,
    ...(browserExecutable ? { browserExecutable } : {}),
    pixelFormat: "yuv420p",
    crf: 20,
    x264Preset: "medium",
    audioBitrate: "192k",
    overwrite: true,
    concurrency: "50%",
    logLevel: "warn",
    onProgress: ({ progress }) => onProgress(0.1 + progress * 0.9),
  });
};
