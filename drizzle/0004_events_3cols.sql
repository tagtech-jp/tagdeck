ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "stream_id" text;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "platform_comment_id" text;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "moderated" boolean DEFAULT false;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "events_platform_comment_unique"
  ON "events" ("platform", "platform_comment_id")
  WHERE "platform_comment_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_stream_id_idx"
  ON "events" ("stream_id")
  WHERE "stream_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_moderated_idx"
  ON "events" ("moderated")
  WHERE "moderated" = true;
