ALTER TABLE "listeners" ADD COLUMN "total_comment_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "kick_channel_id" text;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "kick_chatroom_id" text;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "kick_is_monitoring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "kick_is_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "kick_monitoring_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "kick_viewer_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "kick_peak_viewer_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "kick_follower_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "kick_last_event_at" timestamp;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;