import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "./generated/client";

const globalForPrisma = globalThis as unknown as {
  stickmotionPrisma?: PrismaClient;
};

export function getDatabaseUrl(): string {
  const workspaceRoot = path.resolve(/* turbopackIgnore: true */ process.cwd(), "../..");
  const configured = process.env.DATABASE_URL;
  if (!configured) {
    return `file:${path.join(workspaceRoot, "storage", "stickmotion.db").replaceAll("\\", "/")}`;
  }
  if (configured.startsWith("file:./")) {
    return `file:${path.resolve(/* turbopackIgnore: true */ workspaceRoot, configured.slice(5)).replaceAll("\\", "/")}`;
  }
  if (!configured.startsWith("file:")) {
    throw new Error("DATABASE_URL must be a local SQLite file URL");
  }
  return configured;
}

export function getPrisma(): PrismaClient {
  if (globalForPrisma.stickmotionPrisma) {
    return globalForPrisma.stickmotionPrisma;
  }

  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: getDatabaseUrl() }),
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.stickmotionPrisma = client;
  }

  return client;
}