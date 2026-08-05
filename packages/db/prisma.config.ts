import "dotenv/config";

import { defineConfig } from "prisma/config";

const configured = process.env.DATABASE_URL;
const databaseUrl =
  !configured || configured === "file:./storage/stickmotion.db"
    ? "file:../../../storage/stickmotion.db"
    : configured;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});