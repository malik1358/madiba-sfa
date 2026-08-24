ALTER TABLE "public"."collection_visits"
  ADD COLUMN IF NOT EXISTS "summary_text" text,
  ADD COLUMN IF NOT EXISTS "queue_priority" integer,
  ADD COLUMN IF NOT EXISTS "probability_score" integer,
  ADD COLUMN IF NOT EXISTS "probability_label" text,
  ADD COLUMN IF NOT EXISTS "visit_number_for_day" integer;
