ALTER TABLE "Project"
  ADD COLUMN "includeNarration" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Project"
  ADD COLUMN "includeSubtitles" BOOLEAN NOT NULL DEFAULT true;
