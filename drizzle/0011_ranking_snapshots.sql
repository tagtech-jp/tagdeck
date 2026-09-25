-- 0011_ranking_snapshots — イベント勝率シミュレーター E2
-- 目的: 公開 API /rankings/{type} の取得結果を append-only で保存する ranking_snapshots を作成する。
-- 適用: Supabase SQL Editor で drizzle/0011_ranking_snapshots_manual.sql を実行（docs/migration-runbook.md）。
-- ロールバック: drizzle/0011_ranking_snapshots_rollback.sql
-- 冪等: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS

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
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ranking_snapshots" ADD CONSTRAINT "ranking_snapshots_simulator_id_event_simulators_id_fk"
    FOREIGN KEY ("simulator_id") REFERENCES "public"."event_simulators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ranking_snapshots_simulator_captured_idx" ON "ranking_snapshots" ("simulator_id", "captured_at");
--> statement-breakpoint
-- RLS: Drizzle(postgres ロール)経由でのみ書く。ブラウザ(anon/authenticated)からは自分の simulator の行だけ読める
ALTER TABLE "ranking_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "ranking_snapshots: own simulator rows only" ON "ranking_snapshots";
--> statement-breakpoint
CREATE POLICY "ranking_snapshots: own simulator rows only" ON "ranking_snapshots"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM "event_simulators" s WHERE s."id" = "ranking_snapshots"."simulator_id" AND s."user_id" = auth.uid()));
--> statement-breakpoint
GRANT SELECT ON "ranking_snapshots" TO authenticated;
