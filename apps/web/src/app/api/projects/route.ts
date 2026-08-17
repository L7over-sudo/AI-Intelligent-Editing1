import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { createProjectSchema, subtitleStyleSchema } from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";
import {
  configuredMusicLibraryRoot,
  listMusicLibraryTracks,
  matchLibraryTrack,
  resolveLibraryFilePath,
} from "@/server/music-library";

const MAX_COVER_AVATAR_BYTES = 2 * 1024 * 1024;

function decodeCoverAvatarDataUrl(value: string): {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
} | null {
  if (!value) return null;
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
      value,
    );
  if (!match) throw new Error("COVER_AVATAR_INVALID");
  const contentType = match[1] as "image/jpeg" | "image/png" | "image/webp";
  const bytes = Uint8Array.from(Buffer.from(match[2]!, "base64"));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_COVER_AVATAR_BYTES) {
    throw new Error("COVER_AVATAR_TOO_LARGE");
  }
  return {
    bytes,
    contentType,
    extension:
      contentType === "image/jpeg"
        ? "jpg"
        : contentType === "image/webp"
          ? "webp"
          : "png",
  };
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    const projects = await getPrisma().project.findMany({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { scenes: true } },
        renderOutputs: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        assets: {
          where: { kind: { in: ["COVER_IMAGE", "COVER_IMAGE_LANDSCAPE"] } },
          orderBy: { createdAt: "desc" },
          // Keep enough history to restore a superseded cover pair without
          // deleting the generated assets from local storage.
          take: 10,
          select: { id: true, contentType: true, kind: true, metadata: true },
        },
      },
    });
    return NextResponse.json({ projects });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createProjectSchema.parse(await request.json());
    const user = await getCurrentUser();
    const prisma = getPrisma();
    if (input.voiceProfileId) {
      const profile = await prisma.voiceProfile.findFirst({
        where: { id: input.voiceProfileId, ownerId: user.id },
        select: { id: true },
      });
      if (!profile) throw new Error("VOICE_PROFILE_NOT_FOUND");
    }
    if (input.characterProfileId) {
      const profile = await prisma.characterProfile.findFirst({
        where: { id: input.characterProfileId, ownerId: user.id },
        select: { id: true },
      });
      if (!profile) throw new Error("CHARACTER_PROFILE_NOT_FOUND");
    }
    const coverAvatar = decodeCoverAvatarDataUrl(
      input.subtitleStyle.coverTemplate?.cover.avatarUrl ?? "",
    );
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        title: input.title,
        sourceText: input.sourceText,
        sourceKind: input.sourceKind,
        aspectRatio: input.aspectRatio,
        targetDuration: 0,
        language: input.language,
        voiceStyle: input.voiceStyle,
        voiceProfileId: input.voiceProfileId ?? null,
        characterProfileId: input.characterProfileId ?? null,
        subtitleStyle: input.subtitleStyle,
        accentColor: input.accentColor.toUpperCase(),
        visualMode: input.visualMode,
        imagePrompt: input.imagePrompt,
        includeNarration: input.includeNarration,
        includeSubtitles: input.includeSubtitles,
        narrationVolume: input.narrationVolume,
        backgroundMusicVolume: input.backgroundMusicVolume,
      },
    });

    if (coverAvatar && input.subtitleStyle.coverTemplate) {
      const objectStore = new LocalObjectStore();
      const objectKey = `projects/${project.id}/covers/avatar-${randomUUID()}.${coverAvatar.extension}`;
      const stored = await objectStore.put(
        objectKey,
        coverAvatar.bytes,
        coverAvatar.contentType,
      );
      const asset = await prisma.asset.create({
        data: {
          projectId: project.id,
          kind: "COVER_AVATAR",
          bucket: stored.bucket,
          objectKey: stored.objectKey,
          contentType: coverAvatar.contentType,
          byteSize: BigInt(stored.byteSize),
          source: "user-upload",
          license: "user-confirmed",
        },
      });
      const coverTemplate = input.subtitleStyle.coverTemplate;
      const persistedSubtitleStyle = subtitleStyleSchema.parse({
        ...input.subtitleStyle,
        coverTemplate: {
          ...coverTemplate,
          avatarAssetId: asset.id,
          cover: { ...coverTemplate.cover, avatarUrl: "" },
        },
      });
      await prisma.project.update({
        where: { id: project.id },
        data: { subtitleStyle: persistedSubtitleStyle },
      });
    }

    if (input.backgroundMusic === "BUILTIN") {
      const objectStore = new LocalObjectStore();
      const bgmPath = path.resolve(
        process.cwd(),
        "../../assets/bgm/default-bgm.mp3",
      );
      const body = await readFile(bgmPath);
      const objectKey = `projects/${project.id}/uploads/${randomUUID()}-default-bgm.mp3`;
      const stored = await objectStore.put(
        objectKey,
        new Uint8Array(body),
        "audio/mpeg",
      );
      await prisma.asset.create({
        data: {
          projectId: project.id,
          kind: "BGM",
          bucket: stored.bucket,
          objectKey: stored.objectKey,
          contentType: "audio/mpeg",
          byteSize: BigInt(stored.byteSize),
          source: "user-upload",
          license: "user-confirmed",
        },
      });
    }

    if (
      input.backgroundMusic === "AUTO_MATCH" ||
      input.backgroundMusic.startsWith("AUTO_MATCH:")
    ) {
      try {
        const root = await configuredMusicLibraryRoot();
        const tracks = await listMusicLibraryTracks(root);
        const explicitFile = input.backgroundMusic.startsWith("AUTO_MATCH:")
          ? input.backgroundMusic.slice("AUTO_MATCH:".length)
          : undefined;
        const selected = explicitFile
          ? tracks.find((track) => track.fileName === explicitFile)
          : matchLibraryTrack(
              `${project.title}\n${project.sourceText}`,
              tracks,
            );
        if (selected) {
          const libraryPath = resolveLibraryFilePath(root, selected.fileName);
          if (libraryPath) {
            const objectStore = new LocalObjectStore();
            const body = await readFile(libraryPath);
            const extension = path.extname(selected.fileName).toLowerCase();
            const contentType =
              extension === ".wav"
                ? "audio/wav"
                : extension === ".m4a"
                  ? "audio/mp4"
                  : extension === ".flac"
                    ? "audio/flac"
                    : extension === ".ogg"
                      ? "audio/ogg"
                      : "audio/mpeg";
            const objectKey =
              `projects/${project.id}/uploads/` +
              `${randomUUID()}-music-library${extension || ".mp3"}`;
            const stored = await objectStore.put(
              objectKey,
              new Uint8Array(body),
              contentType,
            );
            await prisma.asset.create({
              data: {
                projectId: project.id,
                kind: "BGM",
                bucket: stored.bucket,
                objectKey: stored.objectKey,
                contentType,
                byteSize: BigInt(stored.byteSize),
                source: "local-music-library",
                license: "user-confirmed",
                metadata: {
                  fileName: selected.fileName,
                  title: selected.title,
                },
              },
            });
          }
        }
      } catch (error) {
        console.warn(
          "[projects] auto-match BGM skipped:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
