import { describe, expect, it } from "vitest";

import {
  prepareStoredSubtitleCues,
  reconcileSubtitleCueTimings,
  subtitlePresentationDelayMs,
} from "./subtitle-timing";

describe("prepareStoredSubtitleCues", () => {
  it("delays PCM-aligned cue starts so subtitles do not appear before speech", () => {
    expect(
      prepareStoredSubtitleCues(
        [
          { startMs: 0, endMs: 2_135, text: "很多关系不是坏在你说了假话" },
          {
            startMs: 2_135,
            endMs: 4_080,
            text: "而是坏在你把不该说的真话",
          },
        ],
        4_195,
      ),
    ).toEqual([
      {
        startMs: subtitlePresentationDelayMs,
        endMs: 2_135 + subtitlePresentationDelayMs,
        text: "很多关系不是坏在你说了假话",
      },
      {
        startMs: 2_135 + subtitlePresentationDelayMs,
        endMs: 4_195,
        text: "而是坏在你把不该说的真话",
      },
    ]);
  });
});

describe("reconcileSubtitleCueTimings", () => {
  it("uses the later reliable start and adds the measured mux delay", () => {
    expect(
      reconcileSubtitleCueTimings(
        [{ startMs: 1_640, endMs: 2_400, text: "谁多干谁少干" }],
        [{ startMs: 1_900, endMs: 2_520, text: "谁多干谁少干" }],
        44,
      ),
    ).toEqual([
      { startMs: 1_944, endMs: 2_564, text: "谁多干谁少干" },
    ]);
  });

  it("keeps the primary timing when the secondary text is unreliable", () => {
    expect(
      reconcileSubtitleCueTimings(
        [{ startMs: 500, endMs: 1_000, text: "原文" }],
        [{ startMs: 800, endMs: 1_200, text: "错文" }],
        44,
      ),
    ).toEqual([{ startMs: 544, endMs: 1_044, text: "原文" }]);
  });
});
