import { describe, expect, it } from "vitest";

import { formatSceneImageGenerationFailure } from "./scene-image-errors";

describe("formatSceneImageGenerationFailure", () => {
  it("keeps the scene id and sanitized provider reason", () => {
    expect(
      formatSceneImageGenerationFailure([
        {
          sceneId: "scene-1",
          error: new Error("IMAGE_API_REQUEST_FAILED_429: too   many requests"),
        },
      ]),
    ).toBe(
      "SCENE_IMAGE_GENERATION_FAILED: scene-1 [IMAGE_API_REQUEST_FAILED_429: too many requests]",
    );
  });

  it("does not expose a long error payload", () => {
    const message = formatSceneImageGenerationFailure([
      { sceneId: "scene-1", error: "x".repeat(2_000) },
    ]);

    expect(message.length).toBeLessThan(600);
  });

  it("preserves a safe nested network error code", () => {
    const cause = Object.assign(new Error("connect failed"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    const error = new Error("IMAGE_DOWNLOAD_NETWORK_FAILED", { cause });

    expect(formatSceneImageGenerationFailure([{ sceneId: "scene-1", error }])).toBe(
      "SCENE_IMAGE_GENERATION_FAILED: scene-1 [IMAGE_DOWNLOAD_NETWORK_FAILED: UND_ERR_CONNECT_TIMEOUT]",
    );
  });
});
