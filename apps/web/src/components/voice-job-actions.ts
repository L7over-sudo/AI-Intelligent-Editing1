export interface VoiceJobSummary {
  id: string;
  status: string;
  createdAt: string;
  input?: { sceneId?: string } | null;
}

export function latestVoiceJobAttempts(
  jobs: readonly VoiceJobSummary[],
): VoiceJobSummary[] {
  const latestByScene = new Map<string, VoiceJobSummary>();
  for (const job of jobs) {
    const key = job.input?.sceneId ?? job.id;
    const current = latestByScene.get(key);
    if (!current || job.createdAt > current.createdAt) {
      latestByScene.set(key, job);
    }
  }
  return [...latestByScene.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function failedVoiceSceneIds(
  jobs: readonly VoiceJobSummary[],
  sceneIds: readonly string[],
): string[] {
  const availableSceneIds = new Set(sceneIds);
  return latestVoiceJobAttempts(jobs)
    .filter(
      (job) =>
        job.status === "FAILED" &&
        Boolean(job.input?.sceneId) &&
        availableSceneIds.has(job.input?.sceneId ?? ""),
    )
    .map((job) => job.input?.sceneId)
    .filter((sceneId): sceneId is string => Boolean(sceneId));
}
