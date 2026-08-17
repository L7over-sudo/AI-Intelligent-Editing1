import { getPrisma } from "@stickmotion/db";
import {
  concatenatePcmWav,
  splitSubtitleText,
  wavDurationMs,
} from "@stickmotion/media";
import { LocalObjectStore } from "@stickmotion/storage";
import { z } from "zod";

import { alignNarrationWithLocalWhisper } from "../services/local-whisper-aligner";

const input = z
  .object({
    projectId: z.string().min(1),
    assetTag: z.string().min(1),
  })
  .parse({ projectId: process.argv[2], assetTag: process.argv[3] });

const prisma = getPrisma();
const objectStore = new LocalObjectStore();
const project = await prisma.project.findUniqueOrThrow({
  where: { id: input.projectId },
  include: {
    scenes: {
      orderBy: { order: "asc" },
      include: {
        voiceTracks: {
          orderBy: { createdAt: "desc" },
          include: { asset: true },
        },
      },
    },
  },
});
const sceneTexts = project.scenes.map((scene) => scene.narration.trim());
const audioParts = await Promise.all(
  project.scenes.map(async (scene) => {
    const track = scene.voiceTracks.find((candidate) =>
      candidate.asset.objectKey.includes(input.assetTag),
    );
    if (!track) throw new Error(`VOICE_VALIDATION_ASSET_MISSING:${scene.order}`);
    return objectStore.get(track.asset.objectKey);
  }),
);
const audio = concatenatePcmWav(
  audioParts.map((part) => ({ audio: part, pauseAfterMs: 0 })),
);
const cues = await alignNarrationWithLocalWhisper({
  audio,
  text: sceneTexts.join(""),
  sceneTexts,
  maximumErrorRate: 0.15,
});
const expectedCueCount = sceneTexts.reduce(
  (sum, text) => sum + splitSubtitleText(text, null).length,
  0,
);
if (cues.length !== expectedCueCount) {
  throw new Error(`VOICE_VALIDATION_CUE_COUNT:${cues.length}/${expectedCueCount}`);
}

console.log(
  JSON.stringify({
    scenes: project.scenes.length,
    cues: cues.length,
    durationMs: wavDurationMs(audio),
    textCoverage: "complete",
  }),
);
