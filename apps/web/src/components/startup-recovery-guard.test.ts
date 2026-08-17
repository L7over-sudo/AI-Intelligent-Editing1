import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("one-click startup recovery", () => {
  it("restarts web when the shared launcher is alive but the health check fails", async () => {
    const script = await readFile(
      path.resolve(process.cwd(), "../..", "scripts/start-stickmotion.ps1"),
      "utf8",
    );

    expect(script).toContain("function Start-StandaloneWeb");
    expect(script).toContain("Get-SavedProcess -Path $webPidFile");
    expect(script).toContain(
      "Start-StandaloneWeb -PnpmInvocation $pnpmInvocation",
    );
  });
});
