import { describe, expect, it } from "vitest";

import {
  continuousBatchBoundaryPauseMs,
  createExactAudioPartitions,
  createVoiceAlignmentBatches,
  minimumSceneTrailingSilenceMs,
} from "./voice-alignment-batches";

describe("createVoiceAlignmentBatches", () => {
  it("uses a short bridge only between independent synthesis batches", () => {
    expect(continuousBatchBoundaryPauseMs("第一句。", 0, 3)).toBe(80);
    expect(continuousBatchBoundaryPauseMs("第二句！", 1, 3)).toBe(80);
    expect(continuousBatchBoundaryPauseMs("未完的句子", 0, 3)).toBe(0);
    expect(continuousBatchBoundaryPauseMs("最后一句。", 2, 3)).toBe(0);
  });

  it("uses a light pause at sentence endings without slowing comma transitions", () => {
    expect(minimumSceneTrailingSilenceMs("sentence.")).toBe(80);
    expect(minimumSceneTrailingSilenceMs("clause,")).toBe(0);
  });

  it("keeps scene boundaries while limiting each synthesis request", () => {
    const scenes = [
      { id: "1", narration: "甲乙丙丁" },
      { id: "2", narration: "戊己庚辛" },
      { id: "3", narration: "壬癸子丑" },
    ];

    const batches = createVoiceAlignmentBatches(scenes, 8);

    expect(batches.map((batch) => batch.text)).toEqual([
      "甲乙丙丁戊己庚辛",
      "壬癸子丑",
    ]);
    expect(batches.flatMap((batch) => batch.scenes.map((scene) => scene.id))).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("can isolate every scene so a boundary is never cut from a longer recording", () => {
    const scenes = [
      { id: "1", narration: "first," },
      { id: "2", narration: "second." },
    ];

    const batches = createVoiceAlignmentBatches(scenes, 240, 1);

    expect(batches).toEqual([
      { scenes: [scenes[0]], text: "first," },
      { scenes: [scenes[1]], text: "second." },
    ]);
  });

  it("moves a whole sentence to the next batch instead of splitting at a comma", () => {
    const scenes = [
      { id: "1", narration: "12345." },
      { id: "2", narration: "abc," },
      { id: "3", narration: "def." },
    ];

    const batches = createVoiceAlignmentBatches(scenes, 10);

    expect(batches.map((batch) => batch.scenes.map((scene) => scene.id))).toEqual([
      ["1"],
      ["2", "3"],
    ]);
  });

  it("partitions independent recordings by physical duration, not subtitle starts", () => {
    expect(createExactAudioPartitions([1_690, 4_620])).toEqual([
      { startMs: 0, endMs: 1_690 },
      { startMs: 1_690, endMs: 6_310 },
    ]);
  });
});
