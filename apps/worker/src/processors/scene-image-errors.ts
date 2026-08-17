export interface SceneImageFailure {
  sceneId: string;
  error: unknown;
}

function cleanSceneImageError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const causeCode = findErrorCode(error);
  const withCause =
    causeCode && !message.includes(causeCode)
      ? `${message}: ${causeCode}`
      : message;
  return withCause.replace(/\s+/gu, " ").trim().slice(0, 500);
}

function findErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return undefined;
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && record.code.length > 0) {
      return record.code.slice(0, 80);
    }
    current = record.cause;
  }
  return undefined;
}

export function formatSceneImageGenerationFailure(
  failures: readonly SceneImageFailure[],
): string {
  return `SCENE_IMAGE_GENERATION_FAILED: ${failures
    .map((failure) => `${failure.sceneId} [${cleanSceneImageError(failure.error)}]`)
    .join(", ")}`;
}
