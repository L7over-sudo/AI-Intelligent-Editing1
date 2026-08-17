import { describe, expect, it } from "vitest";

import {
  allowedJobTypesForRole,
  mediaJobTypes,
  parseWorkerRole,
} from "./worker-role";

describe("parseWorkerRole", () => {
  it("maps explicit roles and defaults to all", () => {
    expect(parseWorkerRole("render")).toBe("render");
    expect(parseWorkerRole("  MEDIA ")).toBe("media");
    expect(parseWorkerRole(undefined)).toBe("all");
    expect(parseWorkerRole("")).toBe("all");
    expect(parseWorkerRole("unknown")).toBe("all");
  });
});

describe("allowedJobTypesForRole", () => {
  it("keeps renders serial on the render worker", () => {
    expect(allowedJobTypesForRole("render")).toEqual(["RENDER"]);
  });

  it("gives media workers every non-render job type", () => {
    const media = allowedJobTypesForRole("media");
    expect(media).toContain("SCRIPT");
    expect(media).toContain("SCENE");
    expect(media).toContain("VOICE");
    expect(media).toContain("AUDIO_MIX");
    expect(media).toContain("JIANYING_DRAFT");
    expect(media).not.toContain("RENDER");
  });

  it("lets a default worker take any job type", () => {
    expect(allowedJobTypesForRole("all")).toBeUndefined();
  });

  it("keeps the media list in sync with the full job set", () => {
    const full = [
      "VOICE_TRAIN",
      "SCRIPT",
      "SCENE",
      "VOICE",
      "SUBTITLE",
      "AUDIO_MIX",
      "RENDER",
      "JIANYING_DRAFT",
      "CLEANUP",
    ];
    const media = allowedJobTypesForRole("media") ?? [];
    expect([...mediaJobTypes].sort()).toEqual(
      full.filter((type) => type !== "RENDER").sort(),
    );
    expect([...media, "RENDER"].sort()).toEqual(full.sort());
  });
});
