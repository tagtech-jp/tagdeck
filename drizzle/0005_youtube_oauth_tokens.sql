-- trigger_set_updated_at() が本番DBに未定義の場合に備えて CREATE OR REPLACE（冪等）
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "youtube_oauth_tokens" (
    "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"             uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
    "streamer_profile_id" uuid NOT NULL REFERENCES "public"."streamer_profiles"("id") ON DELETE CASCADE,
    "access_token"        text NOT NULL,
    "refresh_token"       text NOT NULL,
    "token_type"          text NOT NULL DEFAULT 'Bearer',
    "expires_at"          timestamptz NOT NULL,
    "scope"               text,
    "created_at"          timestamptz NOT NULL DEFAULT now(),
    "updated_at"          timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("user_id", "streamer_profile_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_youtube_tokens_user"
    ON "youtube_oauth_tokens" ("user_id");
--> statement-breakpoint
CREATE TRIGGER set_youtube_tokens_updated_at
    BEFORE UPDATE ON "youtube_oauth_tokens"
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "youtube_oauth_tokens" TO authenticated;
--> statement-breakpoint
ALTER TABLE "youtube_oauth_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "youtube_tokens_owner_all" ON "youtube_oauth_tokens"
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
