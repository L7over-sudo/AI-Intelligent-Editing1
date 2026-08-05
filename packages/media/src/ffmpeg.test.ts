import { describe, expect, it } from "vitest";

import { buildFfmpegRenderCommand } from "./ffmpeg";

describe("buildFfmpegRenderCommand", () => {
  it("builds H.264/AAC output with transitions, animation, subtitles and ducking", () => {
    const command = buildFfmpegRenderCommand({
      width: 1080,
      height: 1920,
      outputPath: "out.mp4",
      subtitlePath: "D:\\work\\captions.ass",
      backgroundMusicPath: "music.mp3",
      watermark: "AI VOICE",
      scenes: [
        {
          imagePath: "one.png",
          voicePath: "one.wav",
          duration: 3,
          animation: "ZOOM",
          transition: { type: "DISSOLVE", duration: 0.4 },
        },
        {
          imagePath: "two.png",
          duration: 4,
          animation: "PAN",
          transition: { type: "PUSH", duration: 0.3 },
        },
      ],
      soundEffects: [{ path: "click.wav", offsetMs: 700, gainDb: -12 }],
    });
    const joined = command.args.join(" ");
    expect(joined).toContain("xfade=transition=dissolve");
    expect(joined).toContain("zoompan");
    expect(joined).toContain("-framerate 30");
    expect(joined).toContain("sidechaincompress");
    expect(joined).toContain("-c:v libx264");
    expect(joined).toContain("-c:a aac");
    expect(joined).toContain("captions.ass");
    expect(command.durationSeconds).toBeCloseTo(7);
  });

  it("keeps narration sequential while visual transitions overlap", () => {
    const command = buildFfmpegRenderCommand({
      width: 1080,
      height: 1920,
      outputPath: "out.mp4",
      scenes: [
        {
          imagePath: "one.png",
          voicePath: "one.wav",
          duration: 2,
          animation: "NONE",
          transition: { type: "DISSOLVE", duration: 0.4 },
        },
        {
          imagePath: "two.png",
          voicePath: "two.wav",
          duration: 3,
          animation: "NONE",
          transition: { type: "PUSH", duration: 0.3 },
        },
        {
          imagePath: "three.png",
          voicePath: "three.wav",
          duration: 4,
          animation: "NONE",
          transition: { type: "FADE", duration: 0.2 },
        },
      ],
    });
    const joined = command.args.join(" ");

    expect(joined).toContain("offset=2.000");
    expect(joined).toContain("offset=5.000");
    expect(joined).toContain("adelay=2000|2000");
    expect(joined).toContain("adelay=5000|5000");
    expect(command.durationSeconds).toBeCloseTo(9);
  });
  it("does not add a watermark filter when watermark is empty", () => {
    const command = buildFfmpegRenderCommand({
      scenes: [
        {
          imagePath: "one.png",
          duration: 1,
          animation: "NONE",
          transition: { type: "CUT", duration: 0 },
        },
      ],
      outputPath: "out.mp4",
      width: 1080,
      height: 1920,
      watermark: "",
    });

    expect(command.args.join(" ")).not.toContain("drawtext=");
  });
  it("rejects odd dimensions", () => {
    expect(() =>
      buildFfmpegRenderCommand({
        scenes: [
          {
            imagePath: "one.png",
            duration: 1,
            animation: "NONE",
            transition: { type: "CUT", duration: 0 },
          },
        ],
        outputPath: "out.mp4",
        width: 1079,
        height: 1920,
      }),
    ).toThrow(/EVEN/);
  });
});

