import { readFile, stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";
import {
  audioContentType,
  configuredMusicLibraryRoot,
  resolveLibraryFilePath,
} from "@/server/music-library";

export async function GET(request: Request) {
  try {
    await getCurrentUser();
    const url = new URL(request.url);
    const fileName = url.searchParams.get("file") ?? "";
    const root = await configuredMusicLibraryRoot();
    const filePath = resolveLibraryFilePath(root, fileName);
    if (!filePath) throw new Error("MUSIC_LIBRARY_FILE_INVALID");

    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json(
          { error: "MUSIC_LIBRARY_FILE_NOT_FOUND" },
          { status: 404 },
        );
      }
      throw error;
    }

    const contentType = audioContentType(fileName);
    const range = request.headers.get("range");
    const cacheControl = "private, max-age=3600";
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : size - 1;
      if (match && start >= 0 && start <= end && start < size) {
        const safeEnd = Math.min(end, size - 1);
        const body = (await readFile(filePath)).subarray(start, safeEnd + 1);
        return new Response(body, {
          status: 206,
          headers: {
            "content-type": contentType,
            "content-length": String(body.byteLength),
            "content-range": `bytes ${start}-${safeEnd}/${size}`,
            "accept-ranges": "bytes",
            "cache-control": cacheControl,
          },
        });
      }
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
    }

    const body = await readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(body.byteLength),
        "accept-ranges": "bytes",
        "cache-control": cacheControl,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
