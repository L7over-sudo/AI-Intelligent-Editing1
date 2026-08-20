import { describe, expect, it } from "vitest";

import {
  parseStoredCreativePreferences,
  creativePreferencesStorageKey,
} from "./creative-preferences";

describe("creative preferences storage", () => {
  it("restores the last template, voice, music, and cover choices", () => {
    expect(
      parseStoredCreativePreferences(
        JSON.stringify({
          videoTemplate: "KNOWLEDGE_BOARD",
          imageSize: "21:9",
          aspectRatio: "LANDSCAPE",
          templateHeader: "思维提升|表达沟通",
          mainTitle: "自我突破",
          leftVerticalText: "左侧文字",
          rightVerticalText: "右侧文字",
          transitionsEnabled: false,
          outputMode: "NARRATED",
          voiceStyle: "none",
          selectedVoiceProfileId: "",
          music: "BUILTIN",
          selectedCoverTemplateId: "cover-1",
        }),
      ),
    ).toEqual({
      videoTemplate: "KNOWLEDGE_BOARD",
      imageSize: "21:9",
      aspectRatio: "LANDSCAPE",
      templateHeader: "思维提升|表达沟通",
      mainTitle: "自我突破",
      leftVerticalText: "左侧文字",
      rightVerticalText: "右侧文字",
      transitionsEnabled: false,
      outputMode: "NARRATED",
      voiceStyle: "none",
      selectedVoiceProfileId: "",
      music: "BUILTIN",
      selectedCoverTemplateId: "cover-1",
    });
  });

  it("rejects malformed or unknown preference data", () => {
    expect(parseStoredCreativePreferences("not-json")).toBeUndefined();
    expect(
      parseStoredCreativePreferences(
        JSON.stringify({ music: "UNKNOWN", unsafe: true }),
      ),
    ).toBeUndefined();
  });

  it("restores the impact-caption template selection", () => {
    expect(
      parseStoredCreativePreferences(
        JSON.stringify({ videoTemplate: "IMPACT_CAPTIONS" }),
      )?.videoTemplate,
    ).toBe("IMPACT_CAPTIONS");
  });

  it("uses a versioned storage key", () => {
    expect(creativePreferencesStorageKey).toBe(
      "stickmotion:creative-preferences:v1",
    );
  });
});
