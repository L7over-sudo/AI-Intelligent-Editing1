import { describe, expect, it } from "vitest";

import { voiceProfileRenameSchema } from "./voice-profile-update";

describe("voice profile rename", () => {
  it("accepts a trimmed custom name", () => {
    expect(voiceProfileRenameSchema.parse({ name: "  我的讲解声  " })).toEqual({
      name: "我的讲解声",
    });
  });

  it("rejects empty or overlong names", () => {
    expect(() => voiceProfileRenameSchema.parse({ name: "   " })).toThrow();
    expect(
      () => voiceProfileRenameSchema.parse({ name: "x".repeat(41) }),
    ).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() =>
      voiceProfileRenameSchema.parse({ name: "我的声音", extra: true }),
    ).toThrow();
  });
});
