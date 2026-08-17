import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(absolute);
      if (!/\.(?:ts|tsx)$/u.test(entry.name) || entry.name.endsWith(".test.ts")) {
        return [];
      }
      return [absolute];
    }),
  );
  return nested.flat();
}

describe("browser UI guard", () => {
  it("does not use native select or browser-owned prompt dialogs", async () => {
    const files = await sourceFiles(path.resolve(process.cwd(), "src"));
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/<select\b/iu.test(source)) violations.push(`${file}: native select`);
      if (/<details\b/iu.test(source)) {
        violations.push(`${file}: native disclosure`);
      }
      if (/window\.(?:alert|confirm|prompt)\s*\(/u.test(source)) {
        violations.push(`${file}: browser dialog`);
      }
    }

    expect(violations).toEqual([]);
  });
});
