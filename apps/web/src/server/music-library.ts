import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "flac", "aac", "ogg"]);

export interface MusicLibraryTrack {
  id: string;
  title: string;
  fileName: string;
  sizeBytes: number;
}

export function musicLibraryRoot(): string {
  return process.env.MUSIC_LIBRARY_ROOT ?? "E:\\codex\\素材库\\音乐库";
}

/**
 * Reads the configured library root from the local settings server so path
 * changes made in the UI apply immediately. Falls back to the environment or
 * default when the settings server is unavailable.
 */
export async function configuredMusicLibraryRoot(): Promise<string> {
  try {
    const response = await fetch(
      "http://127.0.0.1:4317/music-library/settings",
      { signal: AbortSignal.timeout(2_000), cache: "no-store" },
    );
    if (!response.ok) return musicLibraryRoot();
    const data = (await response.json()) as { root?: string };
    return data.root?.trim() ? data.root : musicLibraryRoot();
  } catch {
    return musicLibraryRoot();
  }
}

export function audioContentType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".wav") return "audio/wav";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".flac") return "audio/flac";
  if (extension === ".ogg") return "audio/ogg";
  if (extension === ".aac") return "audio/aac";
  return "audio/mpeg";
}

export async function listMusicLibraryTracks(
  root = musicLibraryRoot(),
): Promise<MusicLibraryTrack[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const tracks: MusicLibraryTrack[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).slice(1).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) continue;
    const info = await stat(path.join(root, entry.name));
    tracks.push({
      id: entry.name,
      title: entry.name.replace(/\.[^.]+$/u, ""),
      fileName: entry.name,
      sizeBytes: info.size,
    });
  }
  return tracks.sort((left, right) =>
    left.title.localeCompare(right.title, "zh-CN"),
  );
}

/**
 * Resolves a library file name inside the music root. Rejects separators and
 * directory traversal so a stored selection can never escape the library.
 */
export function resolveLibraryFilePath(
  root: string,
  fileName: string,
): string | undefined {
  if (
    !fileName ||
    fileName.length > 200 ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..")
  ) {
    return undefined;
  }
  const resolved = path.resolve(root, fileName);
  const boundary = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(boundary)) return undefined;
  return resolved;
}

/**
 * Scores tracks by how many meaningful filename tokens appear in the
 * narration or title. Falls back to the first library track when nothing
 * matches so an "auto match" project still gets a background bed.
 */
export function matchLibraryTrack(
  text: string,
  tracks: readonly MusicLibraryTrack[],
): MusicLibraryTrack | undefined {
  if (tracks.length === 0) return undefined;
  const needle = text.toLocaleLowerCase();
  let best: MusicLibraryTrack | undefined;
  let bestScore = 0;
  for (const track of tracks) {
    const tokens = track.title
      .split(/[-_.\s]+/u)
      .map((token) => token.toLocaleLowerCase())
      .filter((token) => token.length >= 2);
    let score = 0;
    for (const token of tokens) {
      if (needle.includes(token)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  }
  return best ?? tracks[0];
}
