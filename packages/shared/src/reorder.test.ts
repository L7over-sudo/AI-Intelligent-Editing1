import { describe, expect, it } from "vitest";

import { buildSceneOrderUpdates } from "./reorder";

describe("buildSceneOrderUpdates", () => {
  it("creates contiguous order values", () => {
    expect(buildSceneOrderUpdates(["a", "b", "c"], ["c", "a", "b"])).toEqual([
      { id: "c", order: 0 },
      { id: "a", order: 1 },
      { id: "b", order: 2 },
    ]);
  });

  it("rejects missing, extra, and duplicate ids", () => {
    expect(() => buildSceneOrderUpdates(["a", "b"], ["a"])).toThrow();
    expect(() => buildSceneOrderUpdates(["a", "b"], ["a", "c"])).toThrow();
    expect(() => buildSceneOrderUpdates(["a", "b"], ["a", "a"])).toThrow();
  });
});

