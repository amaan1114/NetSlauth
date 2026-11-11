CREATE TYPE "public"."detection_status" AS ENUM('PENDING', 'PROCESSED');--> statement-breakpoint
ALTER TABLE "network_events" ADD COLUMN "detection_status" "detection_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
CREATE INDEX "network_events_detection_status_idx" ON "network_events" USING btree ("detection_status","received_at");
