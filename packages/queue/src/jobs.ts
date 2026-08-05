import {
  scriptGenerationInputSchema,
  type ScriptGenerationInput,
} from "@stickmotion/shared";

export interface LocalJob<T> {
  data: T;
  attemptsMade: number;
  opts: { attempts: number };
  updateProgress(progress: number): Promise<void>;
}

export function enqueueScriptGeneration(
  input: ScriptGenerationInput,
): Promise<string> {
  return Promise.resolve().then(() => scriptGenerationInputSchema.parse(input).jobId);
}

export async function closeQueues(): Promise<void> {
  // SQLite is the durable queue. There are no external connections to close.
}