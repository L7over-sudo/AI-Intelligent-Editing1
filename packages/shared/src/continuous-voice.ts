import { z } from "zod";

export interface ContinuousVoiceScene {
  id: string;
  narration: string;
}

/** Metadata for the project-level narration master stored beside scene assets. */
export const continuousNarrationAssetMetadataSchema = z
  .object({
    assetRole: z.literal("CONTINUOUS_NARRATION"),
    projectRevision: z.number().int().positive(),
    sceneIds: z.array(z.string().min(1)).min(1),
    sceneDurationsMs: z.array(z.number().int().positive()).min(1),
    durationMs: z.number().int().positive(),
    voiceGenerationJobId: z.string().min(1),
  })
  .superRefine((metadata, context) => {
    if (metadata.sceneIds.length !== metadata.sceneDurationsMs.length) {
      context.addIssue({
        code: "custom",
        path: ["sceneDurationsMs"],
        message: "Scene duration metadata must match scene IDs",
      });
    }
  });

export type ContinuousNarrationAssetMetadata = z.infer<
  typeof continuousNarrationAssetMetadataSchema
>;

const completeSentencePattern = /[。.!！?？…][”’"'）)\]】》〉]*$/u;

export function groupScenesForContinuousVoice<T extends ContinuousVoiceScene>(
  scenes: readonly T[],
): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  for (const scene of scenes) {
    current.push(scene);
    if (completeSentencePattern.test(scene.narration.trim())) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function continuousVoiceGroupForScene<T extends ContinuousVoiceScene>(
  scenes: readonly T[],
  sceneId: string,
): T[] {
  return (
    groupScenesForContinuousVoice(scenes).find((group) =>
      group.some((scene) => scene.id === sceneId),
    ) ?? []
  );
}

export function joinContinuousNarration(
  scenes: readonly ContinuousVoiceScene[],
): string {
  return scenes
    .map((scene) => scene.narration.trim())
    .filter(Boolean)
    .join("");
}
