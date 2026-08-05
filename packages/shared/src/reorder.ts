export function buildSceneOrderUpdates(
  currentSceneIds: readonly string[],
  requestedSceneIds: readonly string[],
): Array<{ id: string; order: number }> {
  if (currentSceneIds.length !== requestedSceneIds.length) {
    throw new Error("SCENE_REORDER_SET_MISMATCH");
  }

  const current = new Set(currentSceneIds);
  const requested = new Set(requestedSceneIds);

  if (
    current.size !== currentSceneIds.length ||
    requested.size !== requestedSceneIds.length ||
    [...current].some((id) => !requested.has(id))
  ) {
    throw new Error("SCENE_REORDER_SET_MISMATCH");
  }

  return requestedSceneIds.map((id, index) => ({ id, order: index }));
}

