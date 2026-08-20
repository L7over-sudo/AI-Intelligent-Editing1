import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RemotionRenderInput } from "@stickmotion/shared";

import { runRemotion } from "../services/remotion-renderer";

const sourceImage = process.argv[2];
if (!sourceImage) {
  throw new Error(
    "IMPACT_PREVIEW_IMAGE_REQUIRED: pnpm preview:impact-captions <image-path>",
  );
}

const publicDir = await mkdtemp(
  path.join(tmpdir(), "stickmotion-impact-preview-media-"),
);
const bundleDir = await mkdtemp(
  path.join(tmpdir(), "stickmotion-impact-preview-bundle-"),
);
const outputDir = path.resolve(process.cwd(), "../../storage/media");
const outputPath = path.join(outputDir, "impact-captions-preview.mp4");

try {
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    copyFile(sourceImage, path.join(publicDir, "scene.png")),
    copyFile(
      path.resolve(process.cwd(), "../../assets/fonts/DouyinSansBold.otf"),
      path.join(publicDir, "DouyinSansBold.otf"),
    ),
    copyFile(
      path.resolve(
        process.cwd(),
        "../../assets/fonts/HarmonyOS_Sans_SC_Light.ttf",
      ),
      path.join(publicDir, "HarmonyOS_Sans_SC_Light.ttf"),
    ),
    copyFile(
      path.resolve(process.cwd(), "../../storage/media/library/sfx/pop.wav"),
      path.join(publicDir, "pop.wav"),
    ),
    copyFile(
      path.resolve(process.cwd(), "../../storage/media/library/sfx/whoosh.wav"),
      path.join(publicDir, "whoosh.wav"),
    ),
    copyFile(
      path.resolve(process.cwd(), "../../storage/media/library/sfx/impact.wav"),
      path.join(publicDir, "impact.wav"),
    ),
  ]);

  const plan: RemotionRenderInput = {
    width: 1920,
    height: 1080,
    fps: 30,
    scenes: [
      {
        imageFile: "scene.png",
        durationMs: 2_600,
        animation: { type: "RISE", direction: "UP", intensity: 0.75 },
        transition: { type: "FADE", duration: 0.25 },
        subtitleCues: [
          {
            startMs: 0,
            endMs: 1_150,
            text: "你有没有发现",
            translation: "Have you noticed?",
          },
          {
            startMs: 1_150,
            endMs: 2_600,
            text: "越努力越找不到方向",
            translation: "The harder you push, the less direction you find.",
          },
        ],
        soundEffects: [{ file: "pop.wav", offsetMs: 80, gainDb: -8 }],
      },
      {
        imageFile: "scene.png",
        durationMs: 2_350,
        animation: { type: "PAN", direction: "RIGHT", intensity: 0.3 },
        transition: { type: "FADE", duration: 0.25 },
        subtitleCues: [
          {
            startMs: 0,
            endMs: 2_350,
            text: "很多人只顾着向外找答案",
            translation: "Many people only look outward for answers.",
          },
        ],
        soundEffects: [{ file: "whoosh.wav", offsetMs: 60, gainDb: -11 }],
      },
      {
        imageFile: "scene.png",
        durationMs: 2_800,
        animation: { type: "ZOOM", direction: "IN", intensity: 0.45 },
        transition: { type: "CUT", duration: 0 },
        subtitleCues: [
          {
            startMs: 0,
            endMs: 1_050,
            text: "但你知道吗",
            translation: "But do you know this?",
          },
          {
            startMs: 1_050,
            endMs: 2_800,
            text: "真正的答案早就在你身上",
            translation: "The real answer has been within you all along.",
          },
        ],
        soundEffects: [{ file: "impact.wav", offsetMs: 90, gainDb: -9 }],
      },
    ],
    narrationVolume: 1,
    backgroundMusicVolume: 0.1,
    videoTemplate: "IMPACT_CAPTIONS",
    headerText: "",
    subtitleStyle: {
      fontSize: 60,
      position: "BOTTOM",
      outline: true,
      shadow: true,
      accentColor: "#FFE100",
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
