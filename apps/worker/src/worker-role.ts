export type WorkerRole = "render" | "media" | "all";

/**
 * Every job type except RENDER. Media workers pick these up so multiple
 * scripts, scene images and voices can generate in parallel across workers,
 * while renders stay serial on the dedicated render worker.
 */
export const mediaJobTypes = [
  "VOICE_TRAIN",
  "SCRIPT",
  "SCENE",
  "VOICE",
  "SUBTITLE",
  "AUDIO_MIX",
  "JIANYING_DRAFT",
  "CLEANUP",
] as const;

export function parseWorkerRole(value: string | undefined): WorkerRole {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "render") return "render";
  if (normalized === "media") return "media";
  return "all";
}

export function allowedJobTypesForRole(
  role: WorkerRole,
): ReadonlyArray<string> | undefined {
  if (role === "render") return ["RENDER"];
  if (role === "media") return mediaJobTypes;
  return undefined;
}

/**
 * IndexTTS2 owns one model instance, so only one VOICE job may be claimed at
 * a time across the local workers.
 */
export function voiceClaimAvailable(runningVoiceJobs: number): boolean {
  return runningVoiceJobs === 0;
}
