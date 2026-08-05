import {
  renderGenerationInputSchema,
  type RenderGenerationInput,
} from "@stickmotion/shared";

export function enqueueRender(
  input: RenderGenerationInput,
): Promise<string> {
  return Promise.resolve().then(() => renderGenerationInputSchema.parse(input).jobId);
}