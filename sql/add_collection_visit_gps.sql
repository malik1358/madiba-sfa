-- Run once in Supabase SQL Editor (staging and production).
-- Adds GPS capture columns for collection visit route reporting.

ALTER TABLE "public"."collection_visits"
  ADD COLUMN IF NOT EXISTS "latitude" numeric(10,7),
  ADD COLUMN IF NOT EXISTS "longitude" numeric(10,7),
  ADD COLUMN IF NOT EXISTS "gps_accuracy_meters" numeric(10,2);

CREATE INDEX IF NOT EXISTS "idx_collection_visits_created_by_saved_at"
  ON "public"."collection_visits" ("created_by", "saved_at" DESC);
