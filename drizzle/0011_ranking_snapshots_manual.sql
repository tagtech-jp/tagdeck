-- 0011_ranking_snapshots_manual — Supabase SQL Editor 貼付用（本文は 0011_ranking_snapshots.sql と同一・トランザクション付き）
BEGIN;

CREATE TABLE IF NOT EXISTS "ranking_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"simulator_id" uuid NOT NULL,
	"ranking_type" text NOT NULL,
	"captured_at" timestamptz DEFAULT now() NOT NULL,
	"status" integer,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"my_rank" integer,
	"my_point" integer
);
DO $$ BEGIN
  ALTER TABLE "ranking_snapshots" ADD CONSTRAINT "ranking_snapshots_simulator_id_event_simulators_id_fk"
    FOREIGN KEY ("simulator_id") REFERENCES "public"."event_simulators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ranking_snapshots_simulator_captured_idx" ON "ranking_snapshots" ("simulator_id", "captured_at");
ALTER TABLE "ranking_snapshots" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ranking_snapshots: own simulator rows only" ON "ranking_snapshots";
CREATE POLICY "ranking_snapshots: own simulator rows only" ON "ranking_snapshots"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM "event_simulators" s WHERE s."id" = "ranking_snapshots"."simulator_id" AND s."user_id" = auth.uid()));
GRANT SELECT ON "ranking_snapshots" TO authenticated;

COMMIT;

-- 適用後の確認
-- SELECT count(*) FROM ranking_snapshots;
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.ranking_snapshots'::regclass;
