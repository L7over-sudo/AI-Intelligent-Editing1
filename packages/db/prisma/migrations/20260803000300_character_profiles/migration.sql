CREATE TABLE "CharacterProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CharacterProfile_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CharacterProfile_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CharacterProfile_assetId_key"
  ON "CharacterProfile"("assetId");
CREATE INDEX "CharacterProfile_ownerId_updatedAt_idx"
  ON "CharacterProfile"("ownerId", "updatedAt");

ALTER TABLE "Project" ADD COLUMN "characterProfileId" TEXT
  REFERENCES "CharacterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Project_characterProfileId_idx"
  ON "Project"("characterProfileId");
