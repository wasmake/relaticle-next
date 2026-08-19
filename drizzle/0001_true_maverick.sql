ALTER TABLE "subscriptions" ADD COLUMN "stripe_event_created_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "stripe_event_id" varchar(255);
