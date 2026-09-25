CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"streamer_id" uuid NOT NULL,
	"listener_id" uuid,
	"platform" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listeners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"streamer_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"display_name" text,
	"nickname" text,
	"notes" text,
	"total_gift_amount" integer DEFAULT 0,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streamer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fuwacchi_user_id" text,
	"kick_username" text,
	"niconico_user_id" text,
	"fuwacchi_live_id" text,
	"fuwacchi_is_monitoring" boolean DEFAULT false NOT NULL,
	"fuwacchi_monitoring_started_at" timestamp,
	"fuwacchi_last_polled_at" timestamp,
	"fuwacchi_viewer_count" integer DEFAULT 0 NOT NULL,
	"fuwacchi_current_points" integer DEFAULT 0 NOT NULL,
	"fuwacchi_peak_viewer_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_streamer_id_streamer_profiles_id_fk" FOREIGN KEY ("streamer_id") REFERENCES "public"."streamer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_listener_id_listeners_id_fk" FOREIGN KEY ("listener_id") REFERENCES "public"."listeners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listeners" ADD CONSTRAINT "listeners_streamer_id_streamer_profiles_id_fk" FOREIGN KEY ("streamer_id") REFERENCES "public"."streamer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streamer_profiles" ADD CONSTRAINT "streamer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;