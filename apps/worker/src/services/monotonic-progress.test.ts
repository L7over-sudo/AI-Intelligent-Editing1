import { describe, expect, it } from "vitest";

import { createMonotonicProgressReporter } from "./monotonic-progress";

describe("createMonotonicProgressReporter", () => {
  it("never persists a lower progress value", async () => {
    const persisted: number[] = [];
    const reporter = createMonotonicProgressReporter(2, (progress) => {
      persisted.push(progress);
      return Promise.resolve();
    });

    reporter.report(25);
    reporter.report(57);
    reporter.report(32);
    reporter.report(95);
    reporter.report(88);
    await reporter.flush();

    expect(persisted).toEqual([25, 57, 95]);
    expect(reporter.current()).toBe(95);
  });

  it("clamps invalid percentages to the supported range", async () => {
    const persisted: number[] = [];
    const reporter = createMonotonicProgressReporter(0, (progress) => {
      persisted.push(progress);
      return Promise.resolve();
    });

    reporter.report(Number.NaN);
    reporter.report(140);
    await reporter.flush();

    expect(persisted).toEqual([100]);
  });
});
