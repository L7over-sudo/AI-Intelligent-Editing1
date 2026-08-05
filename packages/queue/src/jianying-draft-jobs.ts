import {
  jianyingDraftGenerationInputSchema,
  type JianyingDraftGenerationInput,
} from "@stickmotion/shared";

export function enqueueJianyingDraft(
  input: JianyingDraftGenerationInput,
): Promise<string> {
  return Promise.resolve().then(
    () => jianyingDraftGenerationInputSchema.parse(input).jobId,
  );
}
