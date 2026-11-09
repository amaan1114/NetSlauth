ALTER TABLE "agents" ADD COLUMN "api_key_hash" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_api_key_hash_unique" UNIQUE("api_key_hash");