import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const VOICE_OUTPUT_CLEANUP_TIMEOUT_MS = 120_000;

export type VoiceOutputCleanupRunner = (
  executable: string,
  args: readonly string[],
  options: {
    windowsHide: boolean;
    timeout: number;
    maxBuffer: number;
  },
) => Promise<unknown>;

const defaultRunner: VoiceOutputCleanupRunner = async (
  executable,
  args,
  options,
) => execFileAsync(executable, [...args], options);

/**
 * Removes provider high-frequency artifacts and residual low-level hiss while
 * keeping the PCM timeline unchanged. The gate is deliberately after the
 * spectral denoiser so it only closes genuinely quiet gaps, not consonants.
 */
export function voiceOutputFilterArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-af",
    "highpass=f=70,lowpass=f=8000,afftdn=nr=16:nf=-45:tn=1,agate=threshold=0.008:ratio=8:attack=5:release=100:makeup=1,volume=0.8",
    "-ac",
    "1",
    "-ar",
    "22050",
    "-c:a",
    "pcm_s16le",
    outputPath,
  ];
}

/**
 * Cleans provider output before any subtitle alignment or scene partitioning.
 * A cleanup failure is surfaced instead of silently returning noisy audio.
 */
export async function cleanVoiceOutputAudio(
  audio: Uint8Array,
  dependencies: { run?: VoiceOutputCleanupRunner } = {},
): Promise<Uint8Array> {
  if (audio.byteLength === 0) throw new Error("VOICE_AUDIO_INVALID");
  const workspace = await mkdtemp(
    path.join(tmpdir(), "stickmotion-voice-output-"),
  );
  const inputPath = path.join(workspace, "output-input.wav");
  const outputPath = path.join(workspace, "output-clean.wav");
  try {
    await writeFile(inputPath, audio);
    await (dependencies.run ?? defaultRunner)(
      process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      voiceOutputFilterArgs(inputPath, outputPath),
      {
        windowsHide: true,
        timeout: VOICE_OUTPUT_CLEANUP_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const cleaned = new Uint8Array(await readFile(outputPath));
    if (cleaned.byteLength < 44) {
      throw new Error("VOICE_AUDIO_INVALID");
    }
    return cleaned;
  } catch (error) {
    if (error instanceof Error && error.message === "VOICE_AUDIO_INVALID") {
      throw error;
    }
    throw new Error("VOICE_AUDIO_CLEANUP_FAILED", { cause: error });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
