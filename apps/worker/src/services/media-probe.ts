import { spawn } from "node:child_process";

export interface ProbedMediaInfo {
  durationMs?: number;
  width?: number;
  height?: number;
}

function probeExecutable(): string {
  return process.env.FFPROBE_PATH ?? "ffprobe";
}

function runProbe(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      probeExecutable(),
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height,duration",
        "-of",
        "json",
        filePath,
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderrTail = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2_000);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            `FFPROBE_EXIT_${code ?? "UNKNOWN"}: ${stderrTail.replaceAll(/\s+/gu, " ").slice(-500)}`,
          ),
        );
    });
  });
}

interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface ProbePayload {
  streams?: ProbeStream[];
}

function parseProbePayload(payload: unknown): ProbePayload {
  if (payload && typeof payload === "object") {
    const candidate = payload as Record<string, unknown>;
    if (Array.isArray(candidate.streams)) {
      return { streams: candidate.streams as ProbeStream[] };
    }
  }
  return {};
}

function roundedDurationSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.max(1, Math.round(parsed * 1_000));
}

export async function probeMediaInfo(
  filePath: string,
): Promise<ProbedMediaInfo> {
  const payload = parseProbePayload(JSON.parse(await runProbe(filePath)) as unknown);
  const streams = payload.streams ?? [];
  const result: ProbedMediaInfo = {};
  for (const stream of streams) {
    if (stream.codec_type === "video" && stream.width && stream.height) {
      result.width = stream.width;
      result.height = stream.height;
    }
    const durationMs = roundedDurationSeconds(stream.duration);
    if (durationMs !== undefined && result.durationMs === undefined) {
      result.durationMs = durationMs;
    }
  }
  return result;
}
