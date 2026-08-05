import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { getDatabaseUrl } from "./client";

const migrationsRoot = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));

export async function migrateLocalDatabase(): Promise<string[]> {
  const databaseUrl = getDatabaseUrl();
  const databasePath = path.normalize(decodeURIComponent(databaseUrl.slice("file:".length)));
  await mkdir(path.dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  try {
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.exec(
      'CREATE TABLE IF NOT EXISTS "_LocalMigration" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );

    const entries = (await readdir(migrationsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const applied: string[] = [];
    const hasMigration = database.prepare(
      'SELECT "name" FROM "_LocalMigration" WHERE "name" = ?',
    );
    const recordMigration = database.prepare(
      'INSERT INTO "_LocalMigration" ("name") VALUES (?)',
    );

    for (const name of entries) {
      if (hasMigration.get(name)) continue;
      const sql = await readFile(path.join(migrationsRoot, name, "migration.sql"), "utf8");
      database.transaction(() => {
        database.exec(sql);
        recordMigration.run(name);
      })();
      applied.push(name);
    }
    return applied;
  } finally {
    database.close();
  }
}

migrateLocalDatabase()
  .then((applied) => {
    console.info(
      applied.length > 0
        ? `Applied local migrations: ${applied.join(", ")}`
        : "Local SQLite database is already up to date",
    );
  })
  .catch((error: unknown) => {
    console.error("Local SQLite migration failed", error);
    process.exitCode = 1;
  });