import {
  voiceGenerationInputSchema,
  type VoiceGenerationInput,
} from "@stickmotion/shared";

export function enqueueVoiceGeneration(
  input: VoiceGenerationInput,
): Promise<string> {
  return Promise.resolve().then(
    () => voiceGenerationInputSchema.parse(input).jobId,
  );
}