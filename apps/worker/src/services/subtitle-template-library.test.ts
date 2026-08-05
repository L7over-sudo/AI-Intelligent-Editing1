import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSubtitleTemplateCatalog,
  resolveSubtitleTemplateFile,
} from "./subtitle-template-library";

describe("local subtitle template library", () => {
  it("indexes a preset with a preview and extracts its text style", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "subtitle-library-"));
    const preset = path.join(root, "口播字幕", "重点字幕");
    await mkdir(path.join(preset, "preset_draft"), { recursive: true });
    await writeFile(
      path.join(preset, "重点字幕.json"),
      JSON.stringify({ id: "preset-1", name: "重点字幕" }),
      "utf8",
    );
    await writeFile(path.join(preset, "重点字幕.jpeg"), "preview", "utf8");
    await writeFile(
      path.join(preset, "preset_draft", "draft_content.json"),
      JSON.stringify({
        materials: {
          texts: [
            {
              text_color: "#FFEE00",
              text_size: 48,
              border_color: "#111111",
              border_width: 0.1,
              has_shadow: true,
              font_name: "Microsoft YaHei",
            },
          ],
        },
      }),
      "utf8",
    );

    const catalog = await buildSubtitleTemplateCatalog(root);

    expect(catalog.templates).toHaveLength(1);
    expect(catalog.templates[0]).toMatchObject({
      name: "重点字幕",
      category: "口播字幕",
      style: {
        fontSize: 48,
        primaryColor: "#FFEE00",
        outlineColor: "#111111",
        outlineWidth: 4,
      },
    });
    expect(catalog.templates[0]?.presetRelativePath).not.toContain(root);
  });

  it("rejects a path that escapes the configured root", () => {
    expect(() =>
      resolveSubtitleTemplateFile("D:\\safe\\subtitles", "..\\secret.json"),
    ).toThrow("SUBTITLE_TEMPLATE_PATH_OUTSIDE_ROOT");
  });
});
