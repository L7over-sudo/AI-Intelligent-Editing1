import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RemotionRenderInput } from "@stickmotion/shared";
import sharp from "sharp";

import { runRemotion } from "../services/remotion-renderer";
import { prepareKnowledgeBoardImage } from "../services/video-template-frame";

const publicDir = await mkdtemp(
  path.join(tmpdir(), "stickmotion-smoke-media-"),
);
const bundleDir = await mkdtemp(
  path.join(tmpdir(), "stickmotion-smoke-bundle-"),
);
const outputDir = path.resolve(process.cwd(), "../../storage/media");
const outputPath = path.join(outputDir, "remotion-smoke.mp4");

const sceneSvg = (color: string) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="${color}"/>
    <g fill="none" stroke="#111" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="150" cy="145" r="30"/>
      <path d="M150 175v70M150 195l-30 36M150 195l34 28M150 245l-28 43M150 245l28 43"/>
      <path d="M102 112q48-48 96 0"/>
      <text x="150" y="106" text-anchor="middle" fill="#111" stroke="none" font-size="34" font-family="sans-serif">?</text>
      <path d="M220 205h58M263 188l18 17-18 17"/>
      <circle cx="330" cy="145" r="30"/>
      <path d="M330 175v70M330 195l-33 25M330 195l36 20M330 245l-28 43M330 245l28 43"/>
      <path d="M286 102h90v52h-26l-14 18v-18h-50z"/>
      <path d="M300 119h60M300 135h42"/>
      <path d="M400 205h58M443 188l18 17-18 17"/>
      <circle cx="510" cy="145" r="30"/>
      <path d="M510 175v70M510 195l-35-28M510 195l35-40M510 245l-28 43M510 245l28 43"/>
      <path d="M558 255h22v33h-22zM586 230h22v58h-22z"/>
      <path d="M554 212l50-50M586 163h18v18"/>
    </g>
  </svg>`;

try {
  const [sceneOne, sceneTwo] = await Promise.all([
    prepareKnowledgeBoardImage(
      await sharp(Buffer.from(sceneSvg("#ffffff")))
        .png()
        .toBuffer(),
    ),
    prepareKnowledgeBoardImage(
      await sharp(Buffer.from(sceneSvg("#f3f8ff")))
        .png()
        .toBuffer(),
    ),
  ]);
  await Promise.all([
    sharp(sceneOne).png().toFile(path.join(publicDir, "scene-one.png")),
    sharp(sceneTwo).png().toFile(path.join(publicDir, "scene-two.png")),
    mkdir(outputDir, { recursive: true }),
  ]);

  const plan: RemotionRenderInput = {
    width: 640,
    height: 360,
    fps: 30,
    scenes: [
      {
        imageFile: "scene-one.png",
        durationMs: 1_200,
        animation: { type: "ZOOM", direction: "IN", intensity: 0.7 },
        transition: { type: "DISSOLVE", duration: 0.35 },
        subtitleCues: [{ startMs: 0, endMs: 1_200, text: "第一句话" }],
        soundEffects: [],
      },
      {
        imageFile: "scene-two.png",
        durationMs: 1_200,
        animation: { type: "PAN", direction: "LEFT", intensity: 0.6 },
        transition: { type: "CUT", duration: 0 },
        subtitleCues: [{ startMs: 0, endMs: 1_200, text: "第二句话" }],
        soundEffects: [],
      },
    ],
    narrationVolume: 1,
    backgroundMusicVolume: 0.18,
    videoTemplate: "KNOWLEDGE_BOARD",
    headerText: "— 思维提升 | 表达沟通 | 职场成长 —",
    subtitleStyle: {
      fontSize: 36,
      position: "BOTTOM",
      outline: true,
      shadow: true,
      accentColor: "#19B9C6",
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
