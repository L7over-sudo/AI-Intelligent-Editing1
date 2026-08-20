const TRANSIENT_VOICE_ERROR_PATTERN =
  /^(?:VOICE_SERVICE_(?:UNAVAILABLE|TIMEOUT|NOT_READY)|VOICE_SERVICE_HTTP_ERROR_5\d\d(?:$|:))/u;

export interface LocalRetryPolicyInput {
  jobType: string;
  attempt: number;
  maxAttempts: number;
  errorMessage: string;
}

export interface LocalRetryPolicy {
  canRetry: boolean;
  maxAttempts: number;
  delayMs: number;
}

export function isTransientVoiceServiceError(
  jobType: string,
  errorMessage: string,
): boolean {
  return (
    jobType === "VOICE" && TRANSIENT_VOICE_ERROR_PATTERN.test(errorMessage)
  );
}

export function getLocalRetryPolicy(
  input: LocalRetryPolicyInput,
): LocalRetryPolicy {
  const transientVoiceError = isTransientVoiceServiceError(
    input.jobType,
    input.errorMessage,
  );
  const maxAttempts = transientVoiceError
    ? Math.max(input.maxAttempts, 12)
    : input.maxAttempts;
  const delayMs = transientVoiceError
    ? Math.min(
        5 * 60_000,
        10_000 * 2 ** Math.min(8, Math.max(0, input.attempt - 1)),
      )
    : Math.min(30_000, 1_000 * 2 ** Math.max(0, input.attempt - 1));

  return {
    canRetry: input.attempt < maxAttempts,
    maxAttempts,
    delayMs,
  };
}
