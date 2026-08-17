import { describe, expect, it } from "vitest";

import { resolveRenderAnimation } from "./render-animation";

describe("resolveRenderAnimation", () => {
  it("keeps the configured opening animation", () => {
    expect(
      resolveRenderAnimation(
        { type: "RISE", direction: "UP", intensity: 1 },
        0,
      ),
    ).toEqual({ type: "RISE", direction: "UP", intensity: 1 });
  });

  it("forces the first knowledge-board scene to use RISE", () => {
    expect(
      resolveRenderAnimation(
        { type: "NONE", direction: "NONE", intensity: 0 },
        0,
        { knowledgeBoard: true },
      ),
    ).toEqual({ type: "RISE", direction: "IN", intensity: 0.55 });
  });

  it("does not force RISE on later knowledge-board scenes", () => {
    expect(
      resolveRenderAnimation(
        { type: "NONE", direction: "NONE", intensity: 0 },
        1,
        { knowledgeBoard: true },
      ),
    ).toEqual({ type: "NONE", direction: "NONE", intensity: 0 });
  });

  it("still applies the normal animation preference to later scenes", () => {
    expect(
      resolveRenderAnimation(
        { type: "ZOOM", direction: "IN", intensity: 0.8 },
        1,
      ),
    ).toEqual({ type: "FADE", direction: "IN", intensity: 0.35 });
  });
});
