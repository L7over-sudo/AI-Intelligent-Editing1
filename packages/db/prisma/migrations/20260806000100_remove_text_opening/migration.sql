CREATE TEMP TABLE "__SceneOrderAfterTextOpening" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "newOrder" INTEGER NOT NULL
);

INSERT INTO "__SceneOrderAfterTextOpening" ("id", "newOrder")
SELECT
  "id",
  ROW_NUMBER() OVER (
    PARTITION BY "projectId"
    ORDER BY "order", "id"
  ) - 1
FROM "Scene"
WHERE "isTextOpening" = false
  AND "projectId" IN (
    SELECT DISTINCT "projectId"
    FROM "Scene"
    WHERE "isTextOpening" = true
  );

DELETE FROM "Scene"
WHERE "isTextOpening" = true;

-- Move affected orders out of the non-negative range before compacting them,
-- avoiding transient conflicts with the unique (projectId, order) index.
UPDATE "Scene"
SET "order" = -"order" - 1
WHERE "id" IN (SELECT "id" FROM "__SceneOrderAfterTextOpening");

UPDATE "Scene"
SET "order" = (
  SELECT "newOrder"
  FROM "__SceneOrderAfterTextOpening"
  WHERE "__SceneOrderAfterTextOpening"."id" = "Scene"."id"
)
WHERE "id" IN (SELECT "id" FROM "__SceneOrderAfterTextOpening");

DROP TABLE "__SceneOrderAfterTextOpening";

ALTER TABLE "Scene" DROP COLUMN "isTextOpening";
ALTER TABLE "Project" DROP COLUMN "useTextOpeningTemplate";
