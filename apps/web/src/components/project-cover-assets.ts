export interface ProjectCoverAsset {
  id: string;
  contentType?: string;
  kind: "COVER_IMAGE" | "COVER_IMAGE_LANDSCAPE";
  metadata?: {
    projectRevision?: number;
    superseded?: boolean;
    copySource?: string;
  } | null;
}

function copyQuality(asset: ProjectCoverAsset): number {
  if (asset.metadata?.copySource === "dialogue") return 2;
  if (asset.metadata?.copySource === "fallback") return 1;
  return 0;
}

export function findReadyProjectCoverAssets(
  projectRevision: number,
  assets: ProjectCoverAsset[],
): { portrait: ProjectCoverAsset; landscape: ProjectCoverAsset } | null {
  const currentAssets = assets.filter(
    (asset) =>
      asset.metadata?.projectRevision === projectRevision &&
      asset.metadata.superseded !== true,
  );
  for (const quality of [2, 1, 0]) {
    const portrait = currentAssets.find(
      (asset) =>
        asset.kind === "COVER_IMAGE" && copyQuality(asset) === quality,
    );
    const landscape = currentAssets.find(
      (asset) =>
        asset.kind === "COVER_IMAGE_LANDSCAPE" &&
        copyQuality(asset) === quality,
    );
    if (portrait && landscape) return { portrait, landscape };
  }
  return null;
}

export function projectCoverDisplayState(input: {
  coverEnabled: boolean;
  projectCompleted: boolean;
  assetsReady: boolean;
  loadFailed?: boolean;
}): "READY" | "GENERATING" | "NONE" {
  if (!input.coverEnabled) return "NONE";
  return input.projectCompleted && input.assetsReady && !input.loadFailed
    ? "READY"
    : "GENERATING";
}
