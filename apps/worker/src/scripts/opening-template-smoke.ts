import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  formatTextOpening,
  type RemotionRenderInput,
} from "@stickmotion/shared";
import sharp from "sharp";

import { runRemotion } from "../services/remotion-renderer";

const publicDir = await mkdtemp(
  path.join(tmpdir(), "stickmotion-opening-smoke-media-"),
);
const bundleDir = await mkdtemp(
  path.join(tmpdir(), "stickmotion-opening-smoke-bundle-"),
);
const outputDir = path.resolve(process.cwd(), "../../storage/media");
const outputPath = path.join(outputDir, "opening-template-smoke.mp4");
const sfxDir = path.resolve(process.cwd(), "../../assets/sfx");

const openingText =
  "很多人一遇到问题，第一反应不是去解决问题，而是先解决自己。";
const formattedOpening = formatTextOpening(openingText);

try {
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    copyFile(
      path.join(sfxDir, "water-drop.wav"),
      path.join(publicDir, "water-drop.wav"),
    ),
    sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 3,
        background: "#0B0B0F",
      },
    })
      .png()
      .toFile(path.join(publicDir, "opening-bg.png")),
  ]);

  const plan: RemotionRenderInput = {
    width: 1920,
    height: 1080,
    fps: 30,
    scenes: [
      {
        imageFile: "opening-bg.png",
        durationMs: 2_500,
        animation: { type: "NONE", direction: "NONE", intensity: 0 },
        transition: { type: "CUT", duration: 0 },
        isTextOpening: true,
        openingText: formattedOpening.displayText,
        subtitleCues: [
          {
            startMs: 0,
            endMs: 2_500,
            text: formattedOpening.singleLine,
          },
        ],
        soundEffects: [
          { file: "water-drop.wav", offsetMs: 0, gainDb: -4 },
        ],
      },
    ],
    backgroundMusicVolume: 0.18,
    videoTemplate: "FULL_BLEED",
    headerText: "",
    subtitleStyle: {
      fontSize: 60,
      position: "BOTTOM",
      outline: true,
      shadow: true,
      accentColor: "#FF5C35",
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
