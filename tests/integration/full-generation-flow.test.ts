import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  buildFfmpegRenderCommand,
  cuesToAss,
} from "../../packages/media/src/index";
import { renderSvgScene } from "../../packages/scene-engine/src/index";
import { storyboardSchema } from "../../packages/shared/src/index";

describe("complete local generation flow", () => {
  it("validates storyboard, composes SVG/subtitles and renders MP4", async () => {
    const workspace = await mkdtemp(
      path.join(tmpdir(), "stickmotion-integration-"),
    );
    try {
      const storyboard = storyboardSchema.parse({
        title: "行动",
        summary: "从一个动作开始",
        scenes: [0, 1].map((index) => ({
          narration: index === 0 ? "先迈出第一步。" : "再继续下一步。",
          subtitle: index === 0 ? "先开始" : "再继续",
          estimatedDuration: 1.6,
          visualPrompt: "Minimal stick figure walking forward.",
          templateElements: [
            {
              assetId: index === 0 ? "person-standing" : "person-running",
              x: 0.5,
              y: 0.52,
              scale: 1,
              rotation: 0,
              emphasis: true,
              label: "",
            },
          ],
          animation: {
            type: index === 0 ? "ZOOM" : "PAN",
            direction: "IN",
            intensity: 0.4,
          },
          transition: { type: "DISSOLVE", duration: 0.2 },
          soundEffects: [],
        })),
      });
      expect(
        renderSvgScene({
          width: 1080,
          height: 1920,
          accentColor: "#FF5C35",
          elements: storyboard.scenes[0]?.templateElements ?? [],
        }),
      ).toContain("<svg");

      const ppm =
        "P3\n2 2\n255\n247 245 239 247 245 239 247 245 239 247 245 239\n";
      const images = [
        path.join(workspace, "one.ppm"),
        path.join(workspace, "two.ppm"),
      ];
      await Promise.all(images.map((file) => writeFile(file, ppm)));
      const subtitlePath = path.join(workspace, "captions.ass");
      await writeFile(
        subtitlePath,
        cuesToAss(
          [
            { startMs: 0, endMs: 1_600, text: "先开始", highlighted: ["开始"] },
            { startMs: 1_400, endMs: 3_000, text: "再继续" },
          ],
          {
            fontName: "Arial",
            fontSize: 54,
            primaryColor: "#FFFFFF",
            accentColor: "#FF5C35",
            outline: true,
            shadow: true,
            position: "BOTTOM",
            bilingual: false,
          },
          { width: 1080, height: 1920 },
        ),
      );
      expect(await readFile(subtitlePath, "utf8")).toContain("[Events]");

      const outputPath = path.join(workspace, "result.mp4");
      const command = buildFfmpegRenderCommand({
        scenes: storyboard.scenes.map((scene, index) => ({
          imagePath: images[index] ?? images[0]!,
          duration: scene.estimatedDuration,
          animation: scene.animation.type,
          transition: scene.transition,
        })),
        outputPath,
        width: 1080,
        height: 1920,
      });
      const result = spawnSync(
        process.env.FFMPEG_PATH ?? "ffmpeg",
        command.args,
        {
          encoding: "utf8",
          windowsHide: true,
        },
      );
      expect(result.status, result.stderr.slice(-2_000)).toBe(0);
      expect((await stat(outputPath)).size).toBeGreaterThan(1_000);
      expect((await readFile(outputPath)).subarray(4, 8).toString()).toBe(
        "ftyp",
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
