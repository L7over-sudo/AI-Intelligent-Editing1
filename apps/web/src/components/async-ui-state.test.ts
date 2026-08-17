import { describe, expect, it, vi } from "vitest";

import { withBusyState } from "./async-ui-state";

describe("withBusyState", () => {
  it("always clears the creation overlay after a successful navigation", async () => {
    const setBusy = vi.fn<(busy: boolean) => void>();

    await expect(
      withBusyState(setBusy, () => Promise.resolve("project-created")),
    ).resolves.toBe("project-created");
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("also clears the creation overlay after a failure", async () => {
    const setBusy = vi.fn<(busy: boolean) => void>();

    await expect(
      withBusyState(setBusy, () =>
        Promise.reject(new Error("creation failed")),
      ),
    ).rejects.toThrow("creation failed");
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
  });
});
