export interface AutomaticVoiceCandidate {
  includeNarration: boolean;
  voiceStyle: string;
  voiceProfileId: string | null;
  hasVoiceTrack: boolean;
}

export function shouldQueueAutomaticVoice(
  candidate: AutomaticVoiceCandidate,
): boolean {
  return (
    candidate.includeNarration &&
    candidate.voiceStyle !== "none" &&
    candidate.voiceProfileId !== null &&
    !candidate.hasVoiceTrack
  );
}

export function automaticVoiceIdempotencyKey(
  sceneId: string,
  sceneRevision: number,
  sceneImageJobId: string,
): string {
  return `auto-voice:${sceneId}:${sceneRevision}:${sceneImageJobId}`;
}
