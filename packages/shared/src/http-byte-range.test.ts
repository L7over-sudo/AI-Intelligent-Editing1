import { describe, expect, it } from "vitest";

import { parseHttpByteRange } from "./http-byte-range";

describe("parseHttpByteRange", () => {
  it("parses bounded, open-ended, and suffix ranges", () => {
    expect(parseHttpByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseHttpByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseHttpByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("clamps the end and rejects unsatisfied or multiple ranges", () => {
    expect(parseHttpByteRange("bytes=95-200", 100)).toEqual({ start: 95, end: 99 });
    expect(() => parseHttpByteRange("bytes=100-120", 100)).toThrow(
      "MEDIA_RANGE_NOT_SATISFIABLE",
    );
    expect(() => parseHttpByteRange("bytes=0-1,4-5", 100)).toThrow(
      "MEDIA_RANGE_NOT_SATISFIABLE",
    );
  });

  it("returns undefined without a range header", () => {
    expect(parseHttpByteRange(null, 100)).toBeUndefined();
  });
});
