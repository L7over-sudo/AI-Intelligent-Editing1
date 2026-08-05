import { describe, expect, it } from "vitest";

import { alignTextToSpeechPauses, splitNarrationForSpeech } from "./speech";

describe("splitNarrationForSpeech", () => {
  it("assigns stronger pauses to stronger punctuation", () => {
    expect(splitNarrationForSpeech("first, second; done.")).toEqual([
      { text: "first,", pauseAfterMs: 80 },
      { text: "second;", pauseAfterMs: 160 },
      { text: "done.", pauseAfterMs: 220 },
    ]);
  });

  it("uses a long pause for line breaks", () => {
    expect(splitNarrationForSpeech("line one\nline two")).toEqual([
      { text: "line one", pauseAfterMs: 260 },
      { text: "line two", pauseAfterMs: 0 },
    ]);
  });
});

describe("alignTextToSpeechPauses", () => {
  it("leaves subtitle-free gaps while the voice pauses", () => {
    const cues = alignTextToSpeechPauses("first, second.", 2_000);
    expect(cues).toHaveLength(2);
    expect(cues[0]?.text).toBe("first");
    expect(cues[1]?.text).toBe("second");
    expect((cues[1]?.startMs ?? 0) - (cues[0]?.endMs ?? 0)).toBe(80);
    expect(cues[1]?.endMs).toBe(2_000);
  });
});
