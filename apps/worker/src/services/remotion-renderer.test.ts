import { describe, expect, it } from "vitest";

import { mapBundleProgressToOverall } from "./remotion-renderer";

describe("mapBundleProgressToOverall", () => {
  it("maps Remotion bundle percentages into the first 10% of render progress", () => {
    expect(mapBundleProgressToOverall(0)).toBe(0);
    expect(mapBundleProgressToOverall(50)).toBe(0.05);
    expect(mapBundleProgressToOverall(100)).toBe(0.1);
  });

  it("clamps invalid bundle percentages", () => {
    expect(mapBundleProgressToOverall(-10)).toBe(0);
    expect(mapBundleProgressToOverall(150)).toBe(0.1);
  });
});
