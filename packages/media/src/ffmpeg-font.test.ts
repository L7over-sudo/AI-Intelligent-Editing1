import { describe, expect, it } from "vitest";

import { buildFfmpegRenderCommand } from "./ffmpeg.js";

describe("FFmpeg watermark font", () => {
  it("uses an explicit font file when one is configured", () => {
    const command = buildFfmpegRenderCommand({
      scenes: [
        {
          imagePath: "scene.png",
          voicePath: "voice.wav",
          duration: 2,
          transition: { type: "FADE", duration: 0 },
          animation: "NONE",
        },
      ],
      outputPath: "output.mp4",
      width: 1280,
      height: 720,
      watermark: "AI VOICE",
      fontFile: "C:\\Windows\\Fonts\\arial.ttf",
    });

    expect(command.args.join(" ")).toContain(
      "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='AI VOICE'",
    );
  });
});
