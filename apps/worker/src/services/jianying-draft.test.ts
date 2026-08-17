import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildJianyingDraftDocuments,
  buildJianyingTimeline,
  parseJianyingDraftsRoot,
  resolveDraftPath,
} from "./jianying-draft";

interface TestVideoMaterial {
  type: string;
  material_name: string;
  path?: string;
}

interface TestAudioMaterial {
  name: string;
  id: string;
}

interface TestTransitionMaterial {
  type: string;
  is_overlap: boolean;
  name: string;
  id: string;
}

interface TestSegment {
  target_timerange: { duration: number; start: number };
  extra_material_refs?: string[];
  material_id?: string;
  volume?: number;
}

describe("jianying draft paths", () => {
  it("requires an absolute configured root", () => {
    expect(parseJianyingDraftsRoot(undefined)).toBeNull();
    expect(() => parseJianyingDraftsRoot("relative/drafts")).toThrow(
      "JIANYING_DRAFTS_DIR_ABSOLUTE_REQUIRED",
    );
  });

  it("keeps generated folders inside the configured root", () => {
    const root = path.resolve("D:/drafts");
    const resolved = resolveDraftPath(root, "../../bad title");
    expect(resolved.startsWith(`${root}${path.sep}`)).toBe(true);
    expect(path.basename(resolved)).toBe("bad-title");
  });
});

describe("jianying draft documents", () => {
  it("uses the same unique draft id in content, metadata, and root index", () => {
    const draftId = "11111111-2222-3333-4444-555555555555";
    const documents = buildJianyingDraftDocuments({
      draftId,
      draftPath: "D:/drafts/example",
      videoPath: "D:/drafts/example/materials/remix.mp4",
      coverPath: "D:/drafts/example/draft_cover.jpg",
      title: "StickMotion test",
      width: 1920,
      height: 1080,
      durationUs: 10_000_000,
      videoBytes: 1_024,
      now: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(documents.content.id).toBe(draftId);
    expect(documents.meta.draft_id).toBe(draftId);
    expect(documents.root.all_draft_store[0]?.draft_id).toBe(draftId);
    const videos = documents.content.materials
      .videos as unknown as TestVideoMaterial[];
    expect(videos[0]?.path).toBe("D:/drafts/example/materials/remix.mp4");
  });

  it("builds a full timeline with photos, transitions and audio tracks", () => {
    const timeline = buildJianyingTimeline(
      "D:/drafts/example/materials",
      [
        {
          imageFileName: "scene-001.png",
          imageWidth: 1920,
          imageHeight: 1080,
          durationMs: 5_000,
          transition: { type: "FADE", durationMs: 450 },
          voice: { fileName: "voice-001.wav", durationMs: 5_000 },
        },
        {
          imageFileName: "scene-002.png",
          imageWidth: 1920,
          imageHeight: 1080,
          durationMs: 4_000,
          soundEffects: [
            {
              fileName: "sfx-002-0.wav",
              durationMs: 800,
              offsetMs: 1_000,
              gainDb: -6,
            },
          ],
        },
      ],
      { fileName: "background-music.mp3", durationMs: 3_000, volume: 0.1 },
    );

    expect(timeline.durationUs).toBe(9_000_000);
    expect(timeline.scenes).toHaveLength(2);
    expect(timeline.scenes[0]?.durationUs).toBe(5_450_000);
    expect(timeline.scenes[0]?.transition).toMatchObject({
      name: "叠化",
      durationUs: 450_000,
    });
    expect(timeline.scenes[1]?.durationUs).toBe(4_000_000);
    expect(timeline.scenes[1]?.transition).toBeNull();

    const voices = timeline.audios.filter((audio) => audio.kind === "voice");
    expect(voices).toHaveLength(1);
    expect(voices[0]).toMatchObject({
      startUs: 0,
      targetDurationUs: 5_000_000,
      volume: 1,
    });

    const effects = timeline.audios.filter((audio) => audio.kind === "sfx");
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      startUs: 6_000_000,
      targetDurationUs: 800_000,
    });
    expect(effects[0]?.volume).toBeCloseTo(10 ** (-6 / 20), 5);

    const music = timeline.audios.filter((audio) => audio.kind === "music");
    expect(music.map((clip) => clip.startUs)).toEqual([
      0,
      3_000_000,
      6_000_000,
    ]);
    expect(music.every((clip) => clip.volume === 0.1)).toBe(true);
  });

  it("renders timeline scenes and audio tracks into draft documents", () => {
    const timeline = buildJianyingTimeline(
      "D:/drafts/example/materials",
      [
        {
          imageFileName: "scene-001.png",
          imageWidth: 1920,
          imageHeight: 1080,
          durationMs: 5_000,
          transition: { type: "DISSOLVE", durationMs: 450 },
          voice: { fileName: "voice-001.wav", durationMs: 5_000 },
        },
        {
          imageFileName: "scene-002.png",
          imageWidth: 1920,
          imageHeight: 1080,
          durationMs: 4_000,
        },
      ],
      { fileName: "background-music.mp3", durationMs: 30_000, volume: 0.1 },
    );
    const draftId = "22222222-2222-3333-4444-555555555555";
    const documents = buildJianyingDraftDocuments({
      draftId,
      draftPath: "D:/drafts/example",
      coverPath: "D:/drafts/example/draft_cover.jpg",
      title: "StickMotion full timeline",
      width: 1920,
      height: 1080,
      durationUs: timeline.durationUs,
      timeline,
      timelineMaterialsBytes: 1_024,
      subtitleCues: [
        {
          startMs: 0,
          endMs: 3_000,
          text: "第一句字幕",
          highlighted: ["字幕"],
        },
        {
          startMs: 5_000,
          endMs: 9_000,
          text: "第二句字幕",
        },
      ],
      subtitleStyle: {
        fontSize: 60,
        primaryColor: "#FFFFFF",
        accentColor: "#FF5C35",
        outline: true,
        outlineColor: "#000000",
        shadow: false,
        position: "BOTTOM",
        keywordHighlight: true,
      },
      now: new Date("2026-08-01T00:00:00.000Z"),
    });

    const content = documents.content;
    expect(content.duration).toBe(9_000_000);
    const videos = content.materials.videos as unknown as TestVideoMaterial[];
    const transitions = content.materials
      .transitions as unknown as TestTransitionMaterial[];
    const audios = content.materials.audios as unknown as TestAudioMaterial[];
    expect(videos).toHaveLength(2);
    expect(videos[0]).toMatchObject({
      type: "photo",
      material_name: "scene-001.png",
    });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      type: "transition",
      is_overlap: true,
      name: "叠化",
    });

    const audioNames = audios.map((audio) => audio.name);
    expect(audioNames).toContain("voice-001.wav");
    expect(audioNames).toContain("background-music.mp3");

    const trackTypes = content.tracks.map((track) => track.type);
    expect(trackTypes).toEqual(["video", "text", "audio", "audio"]);
    const textTrack = content.tracks[1]!;
    expect(textTrack.name).toBe("字幕");
    const textMaterials = content.materials.texts;
    const subtitleMaterials = textMaterials.filter(
      (material) => material.type === "subtitle",
    );
    expect(subtitleMaterials).toHaveLength(2);
    expect(subtitleMaterials[0]).toMatchObject({
      type: "subtitle",
      text: "第一句字幕",
      text_color: "#FFFFFF",
    });
    const textSegments = textTrack.segments as unknown as TestSegment[];
    expect(textSegments[0]).toMatchObject({
      material_id: subtitleMaterials[0]?.id,
      target_timerange: { duration: 3_000_000, start: 0 },
    });
    expect(textSegments[1]).toMatchObject({
      target_timerange: { duration: 4_000_000, start: 5_000_000 },
    });
    const trackNames = content.tracks
      .filter((track) => track.type === "audio")
      .map((track) => track.name);
    expect(trackNames).toEqual(["音乐", "配音"]);

    const videoTrack = content.tracks[0]!;
    const videoSegments = videoTrack.segments as unknown as TestSegment[];
    expect(videoSegments).toHaveLength(2);
    expect(videoSegments[0]).toMatchObject({
      target_timerange: { duration: 5_450_000, start: 0 },
    });
    expect(videoSegments[0]?.extra_material_refs).toHaveLength(1);
    expect(videoSegments[0]?.extra_material_refs?.[0]).toBe(transitions[0]?.id);
    expect(videoSegments[1]).toMatchObject({
      target_timerange: { duration: 4_000_000, start: 5_000_000 },
    });

    const musicTrack = content.tracks[2]!;
    const musicSegments = musicTrack.segments as unknown as TestSegment[];
    expect(musicSegments[0]).toMatchObject({
      material_id: audios.find(
        (audio) => audio.name === "background-music.mp3",
      )?.id,
      target_timerange: { duration: 9_000_000, start: 0 },
      volume: 0.1,
    });
    expect(documents.meta.draft_timeline_materials_size).toBe(1_024);
  });
});
