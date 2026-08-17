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
