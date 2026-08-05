import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  classifyExternalSoundEffect,
  createExternalSoundEffectCatalog,
  resolveExternalSoundEffectPath,
} from "./external-sound-effect-library";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("external sound-effect library", () => {
  it("classifies Chinese library paths", () => {
    expect(classifyExternalSoundEffect("剪映音效/1 笑声/人群大笑.mp3")?.tag).toBe(
      "laughter",
    );
    expect(
      classifyExternalSoundEffect("剪映音效/10 美食/快刀切菜剁菜.mp3")?.tag,
    ).toBe("cooking");
    expect(
      classifyExternalSoundEffect("音效整理1/未来科幻机器人/激光.wav")?.tag,
    ).toBe("sci_fi");
  });

  it("builds a compact tagged catalog and prefers MP3", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "stickmotion-sfx-"));
    temporaryDirectories.push(root);
    const category = path.join(root, "笑声");
    await mkdir(category);
    await Promise.all([
      writeFile(path.join(category, "人群大笑.wav"), Buffer.alloc(2_000)),
      writeFile(path.join(category, "人群大笑.mp3"), Buffer.alloc(1_000)),
    ]);

    const catalog = await createExternalSoundEffectCatalog(root);

    expect(catalog.assets).toHaveLength(1);
    expect(catalog.assets[0]?.tag).toBe("laughter");
    expect(catalog.assets[0]?.relativePath).toMatch(/\.mp3$/u);
  });

  it("rejects paths that leave the configured library root", () => {
    expect(() =>
      resolveExternalSoundEffectPath("D:\\library", "../secret.mp3"),
    ).toThrow();
  });
});
