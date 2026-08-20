import { describe, expect, it } from "vitest";

import {
  groupScenesForContinuousVoice,
  shouldQueueAutomaticVoice,
} from "./automatic-voice";

describe("automatic voice generation is disabled", () => {
  it("never queues narration as a side effect of another job", () => {
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: true,
        voiceStyle: "local-clone",
        voiceProfileId: "profile-1",
        hasVoiceTrack: false,
      }),
    ).toBe(false);
  });

  it("does not queue disabled, unconfigured, or already generated audio", () => {
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: true,
        voiceStyle: "none",
        voiceProfileId: "profile-1",
        hasVoiceTrack: false,
      }),
    ).toBe(false);
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: true,
        voiceStyle: "local-clone",
        voiceProfileId: null,
        hasVoiceTrack: false,
      }),
    ).toBe(false);
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: true,
        voiceStyle: "local-clone",
        voiceProfileId: "profile-1",
        hasVoiceTrack: true,
      }),
    ).toBe(false);
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: false,
        voiceStyle: "local-clone",
        voiceProfileId: "profile-1",
        hasVoiceTrack: false,
      }),
    ).toBe(false);
  });

  it("keeps comma-delimited visual scenes in one continuous speech group", () => {
    expect(
      groupScenesForContinuousVoice([
        { id: "scene-1", narration: "真正值得讨论的，" },
        { id: "scene-2", narration: "不是早到几分钟，" },
        { id: "scene-3", narration: "而是如何理解职责。" },
        { id: "scene-4", narration: "下一句话。" },
      ]).map((group) => group.map((scene) => scene.id)),
    ).toEqual([["scene-1", "scene-2", "scene-3"], ["scene-4"]]);
  });

});
