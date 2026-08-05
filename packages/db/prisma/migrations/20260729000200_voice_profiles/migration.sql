CREATE TABLE "VoiceProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "VoiceProfile_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VoiceProfile_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VoiceProfile_assetId_key" ON "VoiceProfile"("assetId");
CREATE INDEX "VoiceProfile_ownerId_updatedAt_idx"
  ON "VoiceProfile"("ownerId", "updatedAt");

ALTER TABLE "Project" ADD COLUMN "voiceProfileId" TEXT
  REFERENCES "VoiceProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Project_voiceProfileId_idx" ON "Project"("voiceProfileId");

INSERT OR IGNORE INTO "VoiceProfile" (
  "id",
  "ownerId",
  "assetId",
  "name",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-' || "Asset"."id",
  "Project"."ownerId",
  "Asset"."id",
  '已保存克隆声音',
  "Asset"."createdAt",
  "Asset"."createdAt"
FROM "Asset"
JOIN "Project" ON "Project"."id" = "Asset"."projectId"
WHERE "Asset"."kind" = 'VOICE'
  AND "Asset"."source" = 'user-upload';

UPDATE "Project"
SET "voiceProfileId" = (
  SELECT "VoiceProfile"."id"
  FROM "VoiceProfile"
  JOIN "Asset" ON "Asset"."id" = "VoiceProfile"."assetId"
  WHERE "Asset"."projectId" = "Project"."id"
  ORDER BY "Asset"."createdAt" DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "VoiceProfile"
  JOIN "Asset" ON "Asset"."id" = "VoiceProfile"."assetId"
  WHERE "Asset"."projectId" = "Project"."id"
);
