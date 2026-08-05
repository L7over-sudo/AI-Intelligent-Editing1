import { readFile } from "node:fs/promises";
import path from "node:path";

import { alignTextToDuration, type SubtitleCueInput } from "@stickmotion/media";
import { config } from "dotenv";
import { z } from "zod";

import { runFfmpeg } from "../services/ffmpeg-runner";
import { createJianyingDraft } from "../services/jianying-draft";

const workspaceRoot = path.resolve(process.cwd(), "../..");
config({ path: path.join(workspaceRoot, ".env"), quiet: true });

const recipeSchema = z.object({
  projectId: z.string().min(1),
  projectRevision: z.number().int().positive(),
  title: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  timeline: z.array(
    z.object({
      subtitle: z.string(),
      startUs: z.number().int().nonnegative(),
      durationUs: z.number().int().positive(),
    }),
  ),
});

const workRoot = path.join(workspaceRoot, "work");
const recipe = recipeSchema.parse(
  JSON.parse(
    await readFile(path.join(workRoot, "recipe.json"), "utf8"),
  ) as unknown,
);
const subtitleCues: SubtitleCueInput[] = recipe.timeline.flatMap((scene) => {
  const startMs = Math.round(scene.startUs / 1_000);
  return alignTextToDuration(
    scene.subtitle,
    Math.round(scene.durationUs / 1_000),
  ).map((cue) => ({
    ...cue,
    startMs: startMs + cue.startMs,
    endMs: startMs + cue.endMs,
  }));
});

const result = await createJianyingDraft(
  {
    projectId: recipe.projectId,
    projectRevision: recipe.projectRevision,
    title: recipe.title,
    width: recipe.width,
    height: recipe.height,
    durationMs: recipe.durationMs,
    video: await readFile(path.join(workRoot, "remix.mp4")),
    subtitleCues,
  },
  runFfmpeg,
);

if (!result) throw new Error("JIANYING_DRAFTS_DIR_REQUIRED");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
