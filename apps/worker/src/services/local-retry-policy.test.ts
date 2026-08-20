import { describe, expect, it } from "vitest";

import {
  getLocalRetryPolicy,
  isTransientVoiceServiceError,
} from "./local-retry-policy";

describe("local retry policy", () => {
  it("extends the retry window for temporary voice-service failures", () => {
    expect(
      getLocalRetryPolicy({
        jobType: "VOICE",
        attempt: 3,
        maxAttempts: 3,
        errorMessage: "VOICE_SERVICE_UNAVAILABLE",
      }),
    ).toEqual({ canRetry: true, maxAttempts: 12, delayMs: 40_000 });
  });

  it("eventually fails after the extended voice retry budget", () => {
    expect(
      getLocalRetryPolicy({
        jobType: "VOICE",
        attempt: 12,
        maxAttempts: 3,
        errorMessage: "VOICE_SERVICE_NOT_READY",
      }).canRetry,
    ).toBe(false);
  });

  it("keeps non-voice jobs on the normal retry policy", () => {
    expect(
      getLocalRetryPolicy({
        jobType: "SCENE",
        attempt: 3,
        maxAttempts: 3,
        errorMessage: "VOICE_SERVICE_UNAVAILABLE",
      }),
    ).toEqual({ canRetry: false, maxAttempts: 3, delayMs: 4_000 });
  });

  it("classifies only temporary voice service errors", () => {
    expect(
      isTransientVoiceServiceError("VOICE", "VOICE_SERVICE_HTTP_ERROR_503"),
    ).toBe(true);
    expect(isTransientVoiceServiceError("VOICE", "VOICE_TEXT_REQUIRED")).toBe(
      false,
    );
    expect(
      isTransientVoiceServiceError("SCENE", "VOICE_SERVICE_UNAVAILABLE"),
    ).toBe(false);
  });
});
