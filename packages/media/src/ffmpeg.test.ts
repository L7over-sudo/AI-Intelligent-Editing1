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
      narrationVolume: 1.35,
      backgroundMusicVolume: 0.28,
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
    expect(command.filterScript).toContain(
      "[narration]asplit=2[narrationSidechain][narrationMix]",
    );
    expect(command.filterScript).toContain(
      "[bgm][narrationSidechain]sidechaincompress",
    );
    expect(command.filterScript).toContain(
      "[narrationMix][ducked]amix=inputs=2",
    );
    expect(command.filterScript).toContain("volume=1.3500[voice0]");
    expect(command.filterScript).toContain("volume=0.2800[bgm]");
    expect(command.filterScript).not.toContain(
      "[bgm][narration]sidechaincompress",
    );
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
    expect(joined).toContain("atrim=duration=2.000");
    expect(joined).not.toContain("afade=");
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
  it("uses one continuous narration input instead of restarting scene audio", () => {
    const command = buildFfmpegRenderCommand({
      width: 1920,
      height: 1080,
      outputPath: "out.mp4",
      narrationPath: "narration.wav",
      scenes: [
        {
          imagePath: "one.png",
          voicePath: "one.wav",
          duration: 1.38,
          animation: "NONE",
          transition: { type: "CUT", duration: 0 },
        },
        {
          imagePath: "two.png",
          voicePath: "two.wav",
          duration: 1.175,
          animation: "NONE",
          transition: { type: "CUT", duration: 0 },
        },
      ],
    });

    expect(command.args).toContain("narration.wav");
    expect(command.args).not.toContain("one.wav");
    expect(command.args).not.toContain("two.wav");
    expect(command.filterScript).toContain("volume=1.0000[voice]");
    expect(command.filterScript).not.toContain("adelay=");
  });
  it("supports the rise animation", () => {
    const command = buildFfmpegRenderCommand({
      scenes: [
        {
          imagePath: "one.png",
          duration: 1,
          animation: "RISE",
          transition: { type: "CUT", duration: 0 },
        },
      ],
      outputPath: "out.mp4",
      width: 1080,
      height: 1920,
    });

    expect(command.args.join(" ")).toContain("zoompan");
  });
  it("writes the filter graph to a script file when requested", () => {
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
      filterScriptPath: "filter.txt",
    });

    expect(command.args).toContain("-filter_complex_script");
    expect(command.args).toContain("filter.txt");
    expect(command.filterScript).toContain("scale=1080:1920");
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
