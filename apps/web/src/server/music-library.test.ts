import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listMusicLibraryTracks,
  matchLibraryTrack,
  resolveLibraryFilePath,
} from "./music-library";

const tempRoots: string[] = [];

async function makeLibrary(files: string[]): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "music-library-test-"));
  tempRoots.push(root);
  for (const file of files) {
    await writeFile(path.join(root, file), new Uint8Array([0, 0, 0]));
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("music library", () => {
  it("lists only audio files sorted by title", async () => {
    const root = await makeLibrary([
      "轻快-商务.mp3",
      "思考氛围.wav",
      "说明.txt",
      "cover.png",
    ]);
    const tracks = await listMusicLibraryTracks(root);
    expect(tracks.map((track) => track.fileName)).toEqual([
      "轻快-商务.mp3",
      "思考氛围.wav",
    ]);
    expect(tracks[0]?.title).toBe("轻快-商务");
  });

  it("matches tracks by filename tokens in the narration", async () => {
    const root = await makeLibrary([
      "垫底-通用.mp3",
      "思考-认知升级.mp3",
      "励志-行动.mp3",
    ]);
    const tracks = await listMusicLibraryTracks(root);
    expect(
      matchLibraryTrack("为什么你的认知升级总失败，方法不对", tracks)?.fileName,
    ).toBe("思考-认知升级.mp3");
    expect(
      matchLibraryTrack("把目标变成每天的行动", tracks)?.fileName,
    ).toBe("励志-行动.mp3");
  });

  it("falls back to the first track when nothing matches", async () => {
    const root = await makeLibrary(["垫底-通用.mp3", "励志-行动.mp3"]);
    const tracks = await listMusicLibraryTracks(root);
    expect(matchLibraryTrack("今天天气不错", tracks)?.fileName).toBe(
      "垫底-通用.mp3",
    );
  });

  it("rejects file names that escape the library root", () => {
    expect(resolveLibraryFilePath("D:\\music", "..\\secret.mp3")).toBeUndefined();
    expect(resolveLibraryFilePath("D:\\music", "sub/evil.mp3")).toBeUndefined();
    expect(resolveLibraryFilePath("D:\\music", "..")).toBeUndefined();
    expect(resolveLibraryFilePath("D:\\music", "normal.mp3")).toBe(
      "D:\\music\\normal.mp3",
    );
  });
});
