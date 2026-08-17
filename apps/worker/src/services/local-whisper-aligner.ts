import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { forceAlignSubtitleCues } from "./forced-subtitle-alignment";

const execFileAsync = promisify(execFile);
const outputSchema = z.object({
  results: z.array(
    z.object({
      words: z.array(
        z.object({
          start: z.number().nonnegative(),
          end: z.number().positive(),
          word: z.string().min(1),
          probability: z.number().min(0).max(1),
        }),
      ),
    }),
  ),
});

export interface LocalWhisperAlignmentInput {
  audio: Uint8Array;
  text: string;
  sceneTexts?: readonly string[];
  maximumErrorRate?: number;
}

export async function alignNarrationBatchesWithLocalWhisper(
  inputs: readonly LocalWhisperAlignmentInput[],
) {
  const transcriptions = await transcribeNarrationBatchesWithLocalWhisper(
    inputs.map((input) => input.audio),
  );
  return inputs.map((input, index) =>
    forceAlignSubtitleCues(
      input.text,
      transcriptions[index] ?? [],
      input.sceneTexts,
      input.maximumErrorRate,
    ),
  );
}

export async function transcribeNarrationBatchesWithLocalWhisper(
  audioInputs: readonly Uint8Array[],
  modelName?: string,
) {
  if (audioInputs.length === 0) return [];
  const python =
    process.env.WHISPER_ALIGNER_PYTHON?.trim() ||
    "E:\\codex\\agent\\whisper-aligner\\venv\\Scripts\\python.exe";
  const modelRoot =
    process.env.WHISPER_ALIGNER_MODEL_ROOT?.trim() ||
    "E:\\codex\\agent\\whisper-aligner\\models";
  const workspace = await mkdtemp(path.join(tmpdir(), "stickmotion-align-"));
  try {
    const audioPaths = await Promise.all(
      audioInputs.map(async (audio, index) => {
        const audioPath = path.join(workspace, `narration-${index}.wav`);
        await writeFile(audioPath, audio);
        return audioPath;
      }),
    );
    const scriptPath = path.resolve(process.cwd(), "src/services/local-whisper.py");
    const { stdout } = await execFileAsync(
      python,
      [scriptPath, modelRoot, ...audioPaths],
      {
        timeout: 20 * 60_000,
        maxBuffer: 20 * 1024 * 1024,
        ...(modelName
          ? { env: { ...process.env, WHISPER_ALIGNER_MODEL: modelName } }
          : {}),
      },
    );
    const parsed = outputSchema.parse(JSON.parse(stdout));
    if (parsed.results.length !== audioInputs.length) {
      throw new Error("WHISPER_ALIGNMENT_BATCH_COUNT_MISMATCH");
    }
    return parsed.results.map((result) => result.words);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function alignNarrationWithLocalWhisper(
  input: LocalWhisperAlignmentInput,
) {
  const results = await alignNarrationBatchesWithLocalWhisper([input]);
  const first = results[0];
  if (!first) throw new Error("WHISPER_ALIGNMENT_BATCH_REQUIRED");
  return first;
}
