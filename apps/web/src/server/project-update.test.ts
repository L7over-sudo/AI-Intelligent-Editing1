import { describe, expect, it } from "vitest";

import { projectUpdateInputSchema } from "./project-update";

describe("projectUpdateInputSchema", () => {
  it("accepts project renames", () => {
    expect(projectUpdateInputSchema.parse({ title: " 新标题 " })).toEqual({
      title: "新标题",
    });
  });

  it("accepts project audio mix settings", () => {
    expect(
      projectUpdateInputSchema.parse({
        narrationVolume: 1.25,
        backgroundMusicVolume: 0.18,
      }),
    ).toEqual({
      narrationVolume: 1.25,
      backgroundMusicVolume: 0.18,
    });
    expect(() =>
      projectUpdateInputSchema.parse({
        narrationVolume: -0.1,
        backgroundMusicVolume: 0.18,
      }),
    ).toThrow();
  });

  it.each(["local-clone", "new-voice-model"] as const)(
    "accepts a saved %s voice profile",
    (voiceStyle) => {
      expect(
        projectUpdateInputSchema.parse({
          voiceStyle,
          voiceProfileId: "profile-1",
        }),
      ).toEqual({ voiceStyle, voiceProfileId: "profile-1" });
    },
  );

  it("rejects cloned voices without a saved profile", () => {
    expect(() =>
      projectUpdateInputSchema.parse({
        voiceStyle: "new-voice-model",
        voiceProfileId: null,
      }),
    ).toThrow();
  });
});
