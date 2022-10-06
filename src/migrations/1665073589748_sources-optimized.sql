-- Up Migration

ALTER TABLE "sources_v2" ADD COLUMN "optimized" BOOLEAN;

-- Down Migration

ALTER TABLE "sources_v2" DROP COLUMN "optimized";