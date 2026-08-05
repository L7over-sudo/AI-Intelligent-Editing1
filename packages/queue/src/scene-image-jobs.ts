import {
  sceneImageGenerationInputSchema,
  type SceneImageGenerationInput,
} from "@stickmotion/shared";

export function enqueueSceneImageGeneration(
  input: SceneImageGenerationInput,
): Promise<string> {
  return Promise.resolve().then(
    () => sceneImageGenerationInputSchema.parse(input).jobId,
  );
}
