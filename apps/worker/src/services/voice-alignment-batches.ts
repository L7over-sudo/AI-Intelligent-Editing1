export interface VoiceAlignmentScene {
  narration: string;
}

export interface VoiceAlignmentBatch<T extends VoiceAlignmentScene> {
  scenes: T[];
  text: string;
}

export interface ExactAudioPartition {
  startMs: number;
  endMs: number;
}

/** A small bridge between independent provider requests, without a sentence-sized gap. */
export function continuousBatchBoundaryPauseMs(
  narration: string,
  batchIndex: number,
  batchCount: number,
): number {
  if (batchIndex < 0 || batchIndex >= batchCount - 1) return 0;
  return /[\u3002\uFF01\uFF1F.!?][”’"'）)\]】》〉]*$/u.test(
    narration.trim(),
  )
    ? 80
    : 0;
}

/** Keeps brisk narration while preventing the next sentence from starting immediately. */
export function minimumSceneTrailingSilenceMs(narration: string): number {
  return /[\u3002\uFF01\uFF1F.!?]$/u.test(narration.trim()) ? 80 : 0;
}

export function createExactAudioPartitions(
  durationsMs: readonly number[],
): ExactAudioPartition[] {
  let offsetMs = 0;
  return durationsMs.map((durationMs) => {
    const startMs = offsetMs;
    offsetMs += Math.max(1, Math.round(durationMs));
    return { startMs, endMs: offsetMs };
  });
}

export function createVoiceAlignmentBatches<T extends VoiceAlignmentScene>(
  scenes: readonly T[],
  maximumCharacters = 280,
  maximumScenes = Number.POSITIVE_INFINITY,
): Array<VoiceAlignmentBatch<T>> {
  if (maximumCharacters < 1) throw new Error("VOICE_BATCH_LIMIT_INVALID");
  if (maximumScenes < 1) throw new Error("VOICE_BATCH_SCENE_LIMIT_INVALID");
  const characterCount = (items: readonly T[]) =>
    items.reduce(
      (sum, item) => sum + Array.from(item.narration.trim()).length,
      0,
    );
  const endsSentence = (narration: string) =>
    /[\u3002\uFF01\uFF1F.!?]$/u.test(narration.trim());
  for (const scene of scenes) {
    const narration = scene.narration.trim();
    if (!narration) throw new Error("VOICE_BATCH_TEXT_REQUIRED");
    const sceneCharacters = Array.from(narration).length;
    if (sceneCharacters > maximumCharacters) {
      throw new Error("VOICE_SCENE_EXCEEDS_BATCH_LIMIT");
    }
  }

  const sentenceGroups: T[][] = [];
  let sentence: T[] = [];
  for (const scene of scenes) {
    sentence.push(scene);
    if (endsSentence(scene.narration)) {
      sentenceGroups.push(sentence);
      sentence = [];
    }
  }
  if (sentence.length > 0) sentenceGroups.push(sentence);

  // Normal sentences are atomic. Only a sentence that exceeds a provider
  // limit is split, because it cannot be sent as one synthesis request.
  const units: T[][] = [];
  for (const group of sentenceGroups) {
    let unit: T[] = [];
    let unitCharacters = 0;
    for (const scene of group) {
      const sceneCharacters = Array.from(scene.narration.trim()).length;
      if (
        unit.length > 0 &&
        (unitCharacters + sceneCharacters > maximumCharacters ||
          unit.length >= maximumScenes)
      ) {
        units.push(unit);
        unit = [];
        unitCharacters = 0;
      }
      unit.push(scene);
      unitCharacters += sceneCharacters;
    }
    if (unit.length > 0) units.push(unit);
  }

  const batches: Array<VoiceAlignmentBatch<T>> = [];
  let current: T[] = [];
  let currentCharacters = 0;
  for (const unit of units) {
    const unitCharacters = characterCount(unit);
    if (
      current.length > 0 &&
      (currentCharacters + unitCharacters > maximumCharacters ||
        current.length + unit.length > maximumScenes)
    ) {
      batches.push({
        scenes: current,
        text: current.map((item) => item.narration.trim()).join(""),
      });
      current = [];
      currentCharacters = 0;
    }
    current.push(...unit);
    currentCharacters += unitCharacters;
  }
  if (current.length > 0) {
    batches.push({
      scenes: current,
      text: current.map((item) => item.narration.trim()).join(""),
    });
  }
  return batches;
}
