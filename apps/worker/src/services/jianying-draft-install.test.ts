import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installJianyingDraft } from "./jianying-draft-install";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("installJianyingDraft", () => {
  it("verifies the installed copy before deleting the staging folder", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "jianying-install-"));
    temporaryRoots.push(temporary);
    const stagingRoot = path.join(temporary, "staging");
    const stagingPath = path.join(stagingRoot, "draft-one");
    const installedRoot = path.join(temporary, "installed");
    const materials = path.join(stagingPath, "materials");
    const draftId = randomUUID();
    await mkdir(materials, { recursive: true });
    await writeFile(path.join(materials, "remix.mp4"), "video", "utf8");
    await writeFile(
      path.join(stagingPath, "draft_content.json"),
      JSON.stringify({
        id: draftId,
        materials: {
          videos: [{ path: path.join(materials, "remix.mp4").replaceAll("\\", "/") }],
        },
      }),
      "utf8",
    );
    const meta = {
      draft_id: draftId,
      draft_fold_path: stagingPath.replaceAll("\\", "/"),
    };
    await writeFile(
      path.join(stagingPath, "draft_meta_info.json"),
      JSON.stringify(meta),
      "utf8",
    );
    await writeFile(
      path.join(stagingPath, "root_meta_info.json"),
      JSON.stringify({ all_draft_store: [meta] }),
      "utf8",
    );

    const result = await installJianyingDraft({
      stagingRoot,
      stagingPath,
      configuredRoot: installedRoot,
    });

    await expect(stat(stagingPath)).rejects.toThrow();
    await expect(
      stat(path.join(result.installedPath, "materials", "remix.mp4")),
    ).resolves.toBeDefined();
    const installedMeta = JSON.parse(
      await readFile(
        path.join(result.installedPath, "draft_meta_info.json"),
        "utf8",
      ),
    ) as { draft_fold_path: string };
    expect(installedMeta.draft_fold_path.replaceAll("\\", "/")).toBe(
      result.installedPath.replaceAll("\\", "/"),
    );
    expect(result.stagingRemoved).toBe(true);
  });

  it("installs timeline drafts that reference scene photos instead of remix.mp4", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "jianying-install-"));
    temporaryRoots.push(temporary);
    const stagingRoot = path.join(temporary, "staging");
    const stagingPath = path.join(stagingRoot, "timeline-draft");
    const installedRoot = path.join(temporary, "installed");
    const materials = path.join(stagingPath, "materials");
    const draftId = randomUUID();
    await mkdir(materials, { recursive: true });
    await writeFile(path.join(materials, "scene-001.png"), "photo", "utf8");
    await writeFile(path.join(materials, "voice-001.wav"), "voice", "utf8");
    await writeFile(
      path.join(stagingPath, "draft_content.json"),
      JSON.stringify({
        id: draftId,
        materials: {
          videos: [
            {
              path: path.join(materials, "scene-001.png").replaceAll("\\", "/"),
            },
          ],
          audios: [],
          transitions: [],
        },
      }),
      "utf8",
    );
    const meta = {
      draft_id: draftId,
      draft_fold_path: stagingPath.replaceAll("\\", "/"),
    };
    await writeFile(
      path.join(stagingPath, "draft_meta_info.json"),
      JSON.stringify(meta),
      "utf8",
    );
    await writeFile(
      path.join(stagingPath, "root_meta_info.json"),
      JSON.stringify({ all_draft_store: [meta] }),
      "utf8",
    );

    const result = await installJianyingDraft({
      stagingRoot,
      stagingPath,
      configuredRoot: installedRoot,
    });

    await expect(
      readFile(path.join(result.installedPath, "materials", "scene-001.png"), "utf8"),
    ).resolves.toBe("photo");
    await expect(
      readFile(path.join(result.installedPath, "materials", "voice-001.wav"), "utf8"),
    ).resolves.toBe("voice");
    expect(result.stagingRemoved).toBe(true);
  });
});
