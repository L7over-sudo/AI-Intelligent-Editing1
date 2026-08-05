import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveObjectPath } from "@stickmotion/storage";

import { runFfmpeg } from "./ffmpeg-runner";

const MAX_MANUAL_PROMPT_CHARACTERS = 500;
const MAX_PROMPT_CHARACTERS = 700;

export interface PreparedVoxCPMReference {
  audioPath: string;
  promptText: string;
}

export async function prepareVoxCPMReference(
  objectKey: string,
  assetId: string,
  promptText: string,
  promptLanguage: string,
): Promise<PreparedVoxCPMReference> {
  const sourcePath = resolveObjectPath(objectKey);
  const baseDirectory = path.posix.dirname(objectKey);
  const normalizedPath = resolveObjectPath(
    path.posix.join(baseDirectory, `${assetId}-voxcpm.wav`),
  );
  const transcriptPath = resolveObjectPath(
    path.posix.join(baseDirectory, `${assetId}-voxcpm.txt`),
  );

  try {
    await access(normalizedPath);
  } catch {
    await runFfmpeg(
      [
        "-y",
        "-v",
        "error",
        "-i",
        sourcePath,
        "-af",
        "silenceremove=start_periods=1:start_duration=0.2:start_threshold=-45dB",
        "-t",
        "15",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        normalizedPath,
      ],
      () => {},
    );
  }

  const compactPrompt = promptText.trim().replaceAll(/\s+/gu, " ");
  let resolvedPrompt = compactPrompt;
  if (shouldAutoTranscribe(compactPrompt)) {
    try {
      resolvedPrompt = (await readFile(transcriptPath, "utf8")).trim();
    } catch {
      resolvedPrompt = await transcribeReference(
        normalizedPath,
        normalizeWhisperLanguage(promptLanguage),
      ).catch(() => "");
      if (resolvedPrompt) {
        await writeFile(transcriptPath, resolvedPrompt, "utf8");
      }
    }
  }

  return {
    audioPath: normalizedPath,
    promptText: fitReferencePrompt(resolvedPrompt),
  };
}

export function fitReferencePrompt(promptText: string): string {
  return Array.from(promptText.trim().replaceAll(/\s+/gu, " "))
    .slice(0, MAX_PROMPT_CHARACTERS)
    .join("");
}

export function shouldAutoTranscribe(promptText: string): boolean {
  const length = Array.from(promptText.trim()).length;
  return length === 0 || length > MAX_MANUAL_PROMPT_CHARACTERS;
}

function normalizeWhisperLanguage(language: string): string {
  if (language === "yue") return "zh";
  return ["zh", "en", "ja", "ko"].includes(language) ? language : "auto";
}

async function transcribeReference(
  audioPath: string,
  language: string,
): Promise<string> {
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const scriptPath = path.join(
    workspaceRoot,
    "scripts",
    "transcribe-reference.py",
  );
  const installRoot = process.env.VOXCPM_HOME ?? "D:\\AI-Tools\\VoxCPM";
  const pythonPath =
    process.env.VOXCPM_PYTHON ??
    path.join(installRoot, "venv", "Scripts", "python.exe");
  const modelDirectory =
    process.env.VOXCPM_ASR_MODEL_DIR ?? path.join(installRoot, "asr-models");

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      pythonPath,
      [scriptPath, audioPath, language, modelDirectory],
      {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-16_000);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8_000);
    });
    child.on("error", () => reject(new Error("VOICE_REFERENCE_ASR_UNAVAILABLE")));
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `VOICE_REFERENCE_ASR_FAILED: ${stderr.replaceAll(/\s+/gu, " ").slice(-1_000)}`,
          ),
        );
        return;
      }
      const output = stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      if (!output) {
        reject(new Error("VOICE_REFERENCE_TRANSCRIPTION_EMPTY"));
        return;
      }
      try {
        const parsed = JSON.parse(output) as { text?: unknown };
        if (typeof parsed.text !== "string" || !parsed.text.trim()) {
          reject(new Error("VOICE_REFERENCE_TRANSCRIPTION_EMPTY"));
          return;
        }
        resolve(parsed.text.trim());
      } catch {
        reject(new Error("VOICE_REFERENCE_ASR_RESPONSE_INVALID"));
      }
    });
  });
}
