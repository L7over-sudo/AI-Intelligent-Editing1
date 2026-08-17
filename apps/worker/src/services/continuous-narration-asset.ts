import {
  continuousNarrationAssetMetadataSchema,
  type ContinuousNarrationAssetMetadata,
} from "@stickmotion/shared";

export function resolveContinuousNarrationMetadata(
  metadata: unknown,
  projectRevision: number,
  sceneIds: readonly string[],
): ContinuousNarrationAssetMetadata | undefined {
  const parsed = continuousNarrationAssetMetadataSchema.safeParse(metadata);
  if (!parsed.success || parsed.data.projectRevision !== projectRevision) {
    return undefined;
  }
  if (
    parsed.data.sceneIds.length !== sceneIds.length ||
    parsed.data.sceneIds.some((sceneId, index) => sceneId !== sceneIds[index])
  ) {
    return undefined;
  }
  return parsed.data;
}
