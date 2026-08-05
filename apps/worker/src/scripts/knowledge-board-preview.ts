import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RemotionRenderInput } from "@stickmotion/shared";

import { runRemotion } from "../services/remotion-renderer";

const publicDir = await mkdtemp(
  path.join(tmpdir(), "stickmotion-knowledge-preview-media-"),
);
const bundleDir = await mkdtemp(
  path.join(tmpdir(), "stickmotion-knowledge-preview-bundle-"),
);
const outputDir = path.resolve(process.cwd(), "../../storage/media");
const outputPath = path.join(outputDir, "knowledge-board-preview.mp4");
const sceneImage =
  "D:/iwen-codex/AI智能剪辑/storage/media/projects/cmsfs908300oa0k97erckalm1/revisions/1/scenes/cmsfs90t50001ks9736k7gzay/image-1-cmsfs94e300om0k97b5csxg71.png";

try {
  await mkdir(outputDir, { recursive: true });
  await copyFile(sceneImage, path.join(publicDir, "scene.png"));
  await copyFile(
    path.resolve(process.cwd(), "../../assets/fonts/DouyinSansBold.otf"),
    path.join(publicDir, "DouyinSansBold.otf"),
  );
  await copyFile(
    path.resolve(process.cwd(), "../../assets/fonts/HarmonyOS_Sans_SC_Light.ttf"),
    path.join(publicDir, "HarmonyOS_Sans_SC_Light.ttf"),
  );

  const plan: RemotionRenderInput = {
    width: 1920,
    height: 1080,
    fps: 30,
    scenes: [
      {
        imageFile: "scene.png",
        durationMs: 2_000,
        animation: { type: "NONE", direction: "NONE", intensity: 0 },
        transition: { type: "CUT", duration: 0 },
        subtitleCues: [
          {
            startMs: 0,
            endMs: 2_000,
            text: "职场本身难免会带来压力，这一点很难完全避免",
          },
        ],
        soundEffects: [],
      },
    ],
    backgroundMusicVolume: 0.18,
    videoTemplate: "KNOWLEDGE_BOARD",
    headerText: "思维提升 | 表达沟通 | 职场成长 | 自我突破",
    subtitleStyle: {
      fontSize: 60,
      position: "BOTTOM",
      outline: true,
      shadow: true,
      accentColor: "#19B9C6",
      leftVerticalText: "@杰研社进化论",
      rightVerticalText: "个人观点\n\n无不良引导",
    },
    watermark: "",
  };

  await runRemotion({
    plan,
    publicDir,
    bundleDir,
    outputPath,
    onProgress: (progress) => {
      if (progress === 1) process.stdout.write("Remotion render: 100%\n");
    },
  });
  process.stdout.write(`${outputPath}\n`);
} finally {
  await Promise.all([
    rm(publicDir, { recursive: true, force: true }),
    rm(bundleDir, { recursive: true, force: true }),
  ]);
}
