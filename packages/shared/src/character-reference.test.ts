import { describe, expect, it } from "vitest";

import { characterReferenceUploadSchema } from "./character-reference";

describe("character reference upload schema", () => {
  it("accepts a small supported image", () => {
    expect(
      characterReferenceUploadSchema.parse({
        profileName: "Presenter",
        fileName: "presenter.png",
        contentType: "image/png",
        byteSize: 1024,
      }),
    ).toMatchObject({ profileName: "Presenter" });
  });

  it("rejects oversized or unsupported images", () => {
    expect(() =>
      characterReferenceUploadSchema.parse({
        profileName: "Presenter",
        fileName: "presenter.gif",
        contentType: "image/gif",
        byteSize: 6 * 1024 * 1024,
      }),
    ).toThrow();
  });
});
