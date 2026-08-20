export {
  continuousVoiceGroupForScene,
  groupScenesForContinuousVoice,
} from "@stickmotion/shared";

export interface AutomaticVoiceCandidate {
  includeNarration: boolean;
  voiceStyle: string;
  voiceProfileId: string | null;
  hasVoiceTrack: boolean;
}

export function shouldQueueAutomaticVoice(
  _candidate: AutomaticVoiceCandidate,
): false {
  // Voice generation is an explicit user action. Image generation must never
  // enqueue a narration job as a side effect.
  return false;
}
