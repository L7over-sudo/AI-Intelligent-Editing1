import { describe, expect, it } from "vitest";

import { narrationVolumeAtFrame } from "./audio-envelope";

describe("narrationVolumeAtFrame", () => {
  it("keeps narration at full volume across visual scene boundaries", () => {
    expect(narrationVolumeAtFrame(0, 300, 60)).toBe(1);
    expect(narrationVolumeAtFrame(150, 300, 60)).toBe(1);
    // The final frames may be covered by a visual transition. Audio must not
    // be muted there because the WAV still contains spoken narration.
    expect(narrationVolumeAtFrame(270, 300, 60)).toBe(1);
    expect(narrationVolumeAtFrame(299, 300, 60)).toBe(1);
  });

  it("keeps very short clips within a safe volume range", () => {
    const values = [0, 1, 2].map((frame) =>
      narrationVolumeAtFrame(frame, 3, 60),
    );
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
  });
});
