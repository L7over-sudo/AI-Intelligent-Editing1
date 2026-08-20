const activeRenderStatuses = new Set([
  "QUEUED",
  "RUNNING",
  "RETRYING",
  "CANCEL_REQUESTED",
]);

export function canDeleteRenderJob(status: string): boolean {
  return !activeRenderStatuses.has(status);
}

export function canCancelRenderJob(status: string): boolean {
  return ["QUEUED", "RUNNING", "RETRYING"].includes(status);
}

export function selectedRenderOutputAfterRefresh(
  currentId: string,
  outputIdsNewestFirst: readonly string[],
  previousLatestId: string,
): string {
  const latestId = outputIdsNewestFirst[0] ?? "";
  if (latestId && previousLatestId && latestId !== previousLatestId) {
    return latestId;
  }
  return outputIdsNewestFirst.includes(currentId) ? currentId : latestId;
}
