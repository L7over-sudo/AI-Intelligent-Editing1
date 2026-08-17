import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";
import {
  configuredMusicLibraryRoot,
  listMusicLibraryTracks,
} from "@/server/music-library";

export async function GET() {
  try {
    await getCurrentUser();
    const root = await configuredMusicLibraryRoot();
    let tracks;
    try {
      tracks = await listMusicLibraryTracks(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({ root, tracks: [] });
      }
      throw error;
    }
    return NextResponse.json({ root, tracks });
  } catch (error) {
    return apiError(error);
  }
}
