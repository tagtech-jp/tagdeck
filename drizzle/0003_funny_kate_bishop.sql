CREATE TABLE "event_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"event_type" text NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"final_score" integer,
	"final_rank" integer,
	"target_score" integer,
	"target_rank" integer,
	"achieved" boolean DEFAULT false NOT NULL,
	"full_pace_history" jsonb DEFAULT '[]'::jsonb,
	"final_rivals" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_simulators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'fuwacchi' NOT NULL,
	"event_type" text DEFAULT 'score' NOT NULL,
	"target_score" integer,
	"target_rank" integer,
	"event_ranking_url" text,
	"my_entry_name" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_score" integer DEFAULT 0 NOT NULL,
	"current_rank" integer,
	"manual_score" integer,
	"pace_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rivals_snapshot" jsonb DEFAULT 'null'::jsonb,
	"rivals_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manual_rivals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_simulation" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_history" ADD CONSTRAINT "event_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_simulators" ADD CONSTRAINT "event_simulators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;