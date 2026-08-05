import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { createProjectSchema } from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

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
        useTextOpeningTemplate: input.useTextOpeningTemplate,
      },
    });

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

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
