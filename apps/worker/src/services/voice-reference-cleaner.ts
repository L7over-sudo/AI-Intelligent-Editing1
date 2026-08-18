import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const VOICE_REFERENCE_CLEANUP_TIMEOUT_MS = 120_000;

/**
 * Converts a voice reference to stable mono PCM and removes stationary room
 * noise before it reaches the speaker encoder. Arguments are kept as an array
 * so user-controlled paths never become shell syntax.
 */
export function voiceReferenceFilterArgs(
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
    "highpass=f=70,lowpass=f=12000,afftdn=nr=12:nf=-35:tn=1",
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
 * Best-effort cleanup: if FFmpeg is unavailable, preserve the original
 * reference so voice generation remains recoverable instead of failing a job.
 */
export async function cleanVoiceReferenceAudio(
  audio: Uint8Array,
): Promise<Uint8Array> {
  if (audio.byteLength === 0) return audio;
  const workspace = await mkdtemp(
    path.join(tmpdir(), "stickmotion-voice-ref-"),
  );
  const inputPath = path.join(workspace, "reference-input");
  const outputPath = path.join(workspace, "reference-clean.wav");
  try {
    await writeFile(inputPath, audio);
    await execFileAsync(
      process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      voiceReferenceFilterArgs(inputPath, outputPath),
      {
        windowsHide: true,
        timeout: VOICE_REFERENCE_CLEANUP_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const cleaned = new Uint8Array(await readFile(outputPath));
    return cleaned.byteLength >= 44 ? cleaned : audio;
  } catch {
    return audio;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
