CREATE TABLE "PromptTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PromptTemplate_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PromptTemplate_ownerId_name_key"
  ON "PromptTemplate"("ownerId", "name");
CREATE INDEX "PromptTemplate_ownerId_updatedAt_idx"
  ON "PromptTemplate"("ownerId", "updatedAt");
