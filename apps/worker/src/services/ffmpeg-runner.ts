import { spawn } from "node:child_process";

export async function runFfmpeg(
  args: readonly string[],
  onProgress: (outTimeMs: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", [...args], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderrTail = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-8_000);
      for (const line of chunk.split(/\r?\n/u)) {
        const match = /^out_time_(?:ms|us)=(\d+)$/u.exec(line.trim());
        if (match?.[1]) onProgress(Math.round(Number(match[1]) / 1_000));
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `FFMPEG_EXIT_${code ?? "UNKNOWN"}: ${stderrTail.replaceAll(/\s+/gu, " ").slice(-2_000)}`,
          ),
        );
    });
  });
}

