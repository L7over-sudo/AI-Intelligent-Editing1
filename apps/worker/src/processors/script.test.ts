import { describe, expect, it } from "vitest";

import { buildReadyProjectUpdate } from "./script";

describe("script project update", () => {
  it("keeps the user-entered project title out of storyboard updates", () => {
    expect(buildReadyProjectUpdate(42)).toEqual({
      targetDuration: 42,
      status: "READY",
    });
  });
});
