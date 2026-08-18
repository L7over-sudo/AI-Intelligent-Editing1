import { describe, expect, it } from "vitest";

import { wavDurationMs } from "@stickmotion/media";

import {
  capWavTrailingSilence,
  finalizeSceneSubtitleCues,
  maximumSceneTrailingSilenceMs,
  partitionContinuousVoice,
  proportionalSceneDurationsMs,
  resolveVoiceServiceUrl,
  sceneBoundariesFromCueStarts,
  voiceAudioObjectKey,
  voiceSubtitleCues,
  voiceTextForScene,
} from "./voice";

describe("voiceTextForScene", () => {
  it("uses narration first", () => {
    expect(
      voiceTextForScene({ narration: " 旁白内容 ", subtitle: "字幕内容" }),
    ).toBe("旁白内容");
  });

  it("falls back to the subtitle text", () => {
    expect(voiceTextForScene({ narration: " ", subtitle: "字幕内容" })).toBe(
      "字幕内容",
    );
  });

  it("throws when both texts are empty", () => {
    expect(() => voiceTextForScene({ narration: "", subtitle: "  " })).toThrow(
      "VOICE_TEXT_REQUIRED",
    );
  });
});

describe("voiceAudioObjectKey", () => {
  it("builds a storage-safe object key", () => {
    expect(voiceAudioObjectKey("project-1", "scene_2", "job3")).toBe(
      "projects/project-1/voice/scene_2-job3.wav",
    );
  });

  it("rejects path traversal segments", () => {
    expect(() => voiceAudioObjectKey("project/../x", "scene", "job")).toThrow(
      "VOICE_OBJECT_KEY_INVALID",
    );
    expect(() => voiceAudioObjectKey("project", "scene", "job\\x")).toThrow(
      "VOICE_OBJECT_KEY_INVALID",
    );
  });
});

describe("resolveVoiceServiceUrl", () => {
  it("prefers the profile metadata URL", () => {
    expect(
      resolveVoiceServiceUrl(
        "http://127.0.0.1:7851/",
        "http://127.0.0.1:9999/",
      ),
    ).toBe("http://127.0.0.1:7851");
  });

  it("falls back to the environment URL", () => {
    expect(resolveVoiceServiceUrl(undefined, "http://localhost:7851/")).toBe(
      "http://localhost:7851",
    );
  });

  it("throws when no loopback URL is configured", () => {
    expect(() => resolveVoiceServiceUrl(undefined, undefined)).toThrow(
      "VOICE_PROVIDER_UNAVAILABLE",
    );
    expect(() =>
      resolveVoiceServiceUrl("http://evil.example:7851", undefined),
    ).toThrow();
  });
});

describe("voiceSubtitleCues", () => {
  it("produces ordered cues covering the audio duration", () => {
    const cues = voiceSubtitleCues("你好，世界。", 2000);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0]?.startMs).toBe(0);
    expect(cues.at(-1)?.endMs).toBe(2000);
    for (const cue of cues) {
      expect(cue.highlighted).toEqual([]);
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
    }
  });

  it("throws on an invalid duration", () => {
    expect(() => voiceSubtitleCues("你好", 0)).toThrow(
      "SUBTITLE_DURATION_INVALID",
    );
  });
});

describe("finalizeSceneSubtitleCues", () => {
  it("keeps cues on the speech timeline and clamps to the scene duration", () => {
    const cues = finalizeSceneSubtitleCues(
      [
        { text: "第一句", startMs: 120, endMs: 900 },
        { text: "第二句", startMs: 1500, endMs: 2200 },
      ],
      120,
      2000,
    );
    expect(cues).toEqual([
      { startMs: 0, endMs: 780, text: "第一句" },
      { startMs: 1380, endMs: 2000, text: "第二句" },
    ]);
  });

  it("drops cues that start outside the scene duration", () => {
    const cues = finalizeSceneSubtitleCues(
      [{ text: "越界", startMs: 3000, endMs: 3400 }],
      0,
      1000,
    );
    expect(cues).toEqual([]);
  });
});

describe("maximumSceneTrailingSilenceMs", () => {
  it("keeps sentence endings longer than comma breaks", () => {
    expect(maximumSceneTrailingSilenceMs("先把问题写下来。")).toBe(160);
    expect(maximumSceneTrailingSilenceMs("继续讲方法，")).toBe(140);
    expect(maximumSceneTrailingSilenceMs("把任务拆成小动作")).toBe(140);
    expect(maximumSceneTrailingSilenceMs("结果如何？")).toBe(160);
  });
});

describe("capWavTrailingSilence", () => {
  function wavWithTail(contentMs: number, tailMs: number): Uint8Array {
    const sampleRate = 8000;
    const byteRate = sampleRate * 2;
    const contentSamples = Math.floor((byteRate * contentMs) / 1000) / 2;
    const tailSamples = Math.floor((byteRate * tailMs) / 1000) / 2;
    const dataLength = (contentSamples + tailSamples) * 2;
    const output = new Uint8Array(44 + dataLength);
    const view = new DataView(output.buffer);
    const text = new TextEncoder();
    output.set(text.encode("RIFF"), 0);
    view.setUint32(4, 36 + dataLength, true);
    output.set(text.encode("WAVEfmt "), 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    output.set(text.encode("data"), 36);
    view.setUint32(40, dataLength, true);
    for (let index = 0; index < contentSamples; index += 1) {
      view.setInt16(44 + index * 2, 3000, true);
    }
    return output;
  }

  it("trims an overlong quiet tail to the requested maximum", () => {
    const audio = wavWithTail(200, 400);
    const capped = capWavTrailingSilence(audio, 150);
    expect(wavDurationMs(capped)).toBe(350);
  });

  it("keeps audio whose tail is already within the limit", () => {
    const audio = wavWithTail(200, 100);
    const capped = capWavTrailingSilence(audio, 150);
    expect(wavDurationMs(capped)).toBe(300);
  });
});

describe("proportionalSceneDurationsMs", () => {
  it("splits a duration proportionally to scene length", () => {
    const durations = proportionalSceneDurationsMs(
      ["人工智能正在改变生活", "未来已经到来"],
      9000,
    );
    expect(durations.reduce((a, b) => a + b, 0)).toBe(9000);
    expect(durations.every((duration) => duration > 0)).toBe(true);
    expect(durations[0]).toBeGreaterThan(durations[1]!);
  });

  it("throws on empty scenes or invalid duration", () => {
    expect(() => proportionalSceneDurationsMs([], 1000)).toThrow(
      "VOICE_PARTITION_INVALID",
    );
    expect(() => proportionalSceneDurationsMs(["你好"], 0)).toThrow(
      "VOICE_PARTITION_INVALID",
    );
  });
});

describe("sceneBoundariesFromCueStarts", () => {
  it("builds contiguous boundaries ending at the total duration", () => {
    const boundaries = sceneBoundariesFromCueStarts(
      [
        [100, 900],
        [1500, 2200],
        [3000, 3600],
      ],
      4000,
    );
    expect(boundaries).toEqual([
      { startMs: 0, endMs: 1500 },
      { startMs: 1500, endMs: 3000 },
      { startMs: 3000, endMs: 4000 },
    ]);
  });

  it("throws when a boundary is empty", () => {
    expect(() =>
      sceneBoundariesFromCueStarts([[100], [250], [300]], 200),
    ).toThrow("VOICE_PARTITION_EMPTY");
  });
});

describe("partitionContinuousVoice", () => {
  function testWav(durationMs: number): Uint8Array {
    const sampleRate = 8000;
    const byteRate = sampleRate * 2;
    const dataLength = Math.floor((byteRate * durationMs) / 1000);
    const output = new Uint8Array(44 + dataLength);
    const view = new DataView(output.buffer);
    const text = new TextEncoder();
    output.set(text.encode("RIFF"), 0);
    view.setUint32(4, 36 + dataLength, true);
    output.set(text.encode("WAVEfmt "), 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    output.set(text.encode("data"), 36);
    view.setUint32(40, dataLength, true);
    return output;
  }
  const wav = testWav(4000);

  it("uses whisper cue starts when alignment succeeds", async () => {
    const partition = await partitionContinuousVoice(
      wav,
      ["第一句", "第二句"],
      () => [
        { text: "第一句", startMs: 100, endMs: 900 },
        { text: "第二句", startMs: 1500, endMs: 2200 },
      ],
    );
    expect(partition.mode).toBe("whisper");
    expect(partition.boundaries[0]).toEqual({ startMs: 0, endMs: 1500 });
    expect(partition.boundaries[1]?.endMs).toBe(4000);
  });

  it("falls back to proportional boundaries when alignment fails", async () => {
    const partition = await partitionContinuousVoice(
      wav,
      ["第一句", "第二句"],
      () => {
        throw new Error("WHISPER_ALIGNMENT_COVERAGE_LOW");
      },
    );
    expect(partition.mode).toBe("fallback");
    expect(partition.boundaries[0]?.startMs).toBe(0);
    expect(partition.boundaries.at(-1)?.endMs).toBe(4000);
    expect(partition.cueGroups).toBeUndefined();
  });
});
