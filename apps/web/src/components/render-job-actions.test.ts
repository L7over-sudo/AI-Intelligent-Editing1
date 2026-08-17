import { describe, expect, it } from "vitest";

import {
  canCancelRenderJob,
  canDeleteRenderJob,
} from "./render-job-actions";

describe("canDeleteRenderJob", () => {
  it.each(["SUCCEEDED", "FAILED", "CANCELED"])(
    "allows deleting a terminal %s render job",
    (status) => {
      expect(canDeleteRenderJob(status)).toBe(true);
    },
  );

  it.each(["QUEUED", "RUNNING", "RETRYING", "CANCEL_REQUESTED"])(
    "protects an active %s render job",
    (status) => {
      expect(canDeleteRenderJob(status)).toBe(false);
    },
  );
});

describe("canCancelRenderJob", () => {
  it.each(["QUEUED", "RUNNING", "RETRYING"])(
    "allows canceling an active %s render job",
    (status) => {
      expect(canCancelRenderJob(status)).toBe(true);
    },
  );

  it.each(["SUCCEEDED", "FAILED", "CANCELED", "CANCEL_REQUESTED"])(
    "does not offer cancel for a %s render job",
    (status) => {
      expect(canCancelRenderJob(status)).toBe(false);
    },
  );
});
