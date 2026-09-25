ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_program_id" text;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_community_id" text;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_is_monitoring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_is_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_monitoring_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_last_polled_at" timestamp;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_viewer_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_comment_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_peak_viewer_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_title" text;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "niconico_started_at" timestamp;