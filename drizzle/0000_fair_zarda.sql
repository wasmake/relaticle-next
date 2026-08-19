CREATE TABLE "subscription_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subscription_id" bigint NOT NULL,
	"stripe_id" varchar(255) NOT NULL,
	"stripe_product" varchar(255) NOT NULL,
	"stripe_price" varchar(255) NOT NULL,
	"quantity" integer,
	"meter_id" varchar(255),
	"meter_event_name" varchar(255),
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "subscription_items_stripe_id_unique" UNIQUE("stripe_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"type" varchar(255) NOT NULL,
	"stripe_id" varchar(255) NOT NULL,
	"stripe_status" varchar(255) NOT NULL,
	"stripe_price" varchar(255),
	"quantity" integer,
	"trial_ends_at" timestamp,
	"ends_at" timestamp,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "subscriptions_stripe_id_unique" UNIQUE("stripe_id")
);
--> statement-breakpoint
CREATE TABLE "agent_conversation_message_mentions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"message_id" varchar(36) NOT NULL,
	"type" varchar(32) NOT NULL,
	"record_id" char(26) NOT NULL,
	"label" varchar(255) NOT NULL,
	"source" varchar(32) DEFAULT 'mention' NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_conversation_messages" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(36) NOT NULL,
	"participant_id" varchar(255),
	"agent" varchar(255) NOT NULL,
	"role" varchar(25) NOT NULL,
	"content" text NOT NULL,
	"attachments" jsonb NOT NULL,
	"tool_calls" jsonb NOT NULL,
	"tool_results" jsonb NOT NULL,
	"usage" jsonb NOT NULL,
	"meta" jsonb NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp,
	"document" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL,
	"superseded_at" timestamp,
	"participant_type" varchar(255),
	"approval_state" text
);
--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"participant_id" varchar(255),
	"team_id" char(26),
	"title" varchar(255) NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp,
	"participant_type" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "ai_credit_balances" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"credits_remaining" integer DEFAULT 0 NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"period_starts_at" timestamp NOT NULL,
	"period_ends_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp,
	"purchased_credits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_credit_balances_team_id_unique" UNIQUE("team_id"),
	CONSTRAINT "ai_credit_balances_credits_nonneg" CHECK ("ai_credit_balances"."credits_remaining" >= 0),
	CONSTRAINT "ai_credit_balances_credits_used_nonneg" CHECK ("ai_credit_balances"."credits_used" >= 0),
	CONSTRAINT "ai_credit_balances_period_order" CHECK ("ai_credit_balances"."period_starts_at" < "ai_credit_balances"."period_ends_at"),
	CONSTRAINT "ai_credit_balances_purchased_nonneg" CHECK ("ai_credit_balances"."purchased_credits" >= 0),
	CONSTRAINT "ai_credit_balances_purchased_lte_remaining" CHECK ("ai_credit_balances"."purchased_credits" <= "ai_credit_balances"."credits_remaining")
);
--> statement-breakpoint
CREATE TABLE "ai_credit_transactions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"user_id" char(26),
	"conversation_id" varchar(36),
	"idempotency_key" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"model" varchar(255) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_credit_transactions_team_id_idempotency_key_unique" UNIQUE("team_id","idempotency_key"),
	CONSTRAINT "ai_credit_transactions_input_tokens_nonneg" CHECK ("ai_credit_transactions"."input_tokens" >= 0),
	CONSTRAINT "ai_credit_transactions_output_tokens_nonneg" CHECK ("ai_credit_transactions"."output_tokens" >= 0),
	CONSTRAINT "ai_credit_transactions_credits_charged_nonneg" CHECK ("ai_credit_transactions"."credits_charged" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chat_message_feedback" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"user_id" char(26) NOT NULL,
	"conversation_id" varchar(36) NOT NULL,
	"message_id" varchar(36) NOT NULL,
	"rating" varchar(8) NOT NULL,
	"category" varchar(32),
	"comment" varchar(1000),
	"model" varchar(64),
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "chat_message_feedback_user_id_message_id_unique" UNIQUE("user_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"user_id" char(26) NOT NULL,
	"conversation_id" varchar(36),
	"message_id" varchar(36),
	"action_class" varchar(255) NOT NULL,
	"operation" varchar(255) NOT NULL,
	"entity_type" varchar(255) NOT NULL,
	"action_data" jsonb NOT NULL,
	"display_data" jsonb NOT NULL,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"result_data" jsonb,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "blog_categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp,
	"deleted_at" timestamp,
	CONSTRAINT "blog_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "blog_post_tag" (
	"post_id" bigint NOT NULL,
	"tag_id" bigint NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "blog_post_tag_pkey" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"excerpt" text,
	"featured_image" varchar(255),
	"category_id" bigint,
	"author_id" varchar(26),
	"status" varchar(255) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp,
	"updated_at" timestamp,
	"deleted_at" timestamp,
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "blog_tags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "blog_tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "system_administrators" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_verified_at" timestamp,
	"password" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"remember_token" varchar(100),
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "system_administrators_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "team_invitations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(255),
	"expires_at" timestamp,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "team_invitations_team_id_email_unique" UNIQUE("team_id","email")
);
--> statement-breakpoint
CREATE TABLE "team_user" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"user_id" char(26) NOT NULL,
	"role" varchar(255),
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "team_user_team_id_user_id_unique" UNIQUE("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"invite_link_token" varchar(40),
	"invite_link_token_expires_at" timestamp,
	"personal_team" boolean NOT NULL,
	"scheduled_deletion_at" timestamp,
	"onboarding_use_case" varchar(255),
	"onboarding_context" jsonb,
	"onboarding_referral_source" varchar(255),
	"plan" varchar(32) DEFAULT 'free' NOT NULL,
	"stripe_id" varchar(255),
	"pm_type" varchar(255),
	"pm_last_four" varchar(4),
	"trial_ends_at" timestamp,
	"hosted_free_grandfathered_at" timestamp,
	"pro_trial_used_at" timestamp,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug"),
	CONSTRAINT "teams_invite_link_token_unique" UNIQUE("invite_link_token")
);
--> statement-breakpoint
CREATE TABLE "user_social_accounts" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"provider_name" varchar(255),
	"provider_id" varchar(255),
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "user_social_accounts_provider_name_provider_id_unique" UNIQUE("provider_name","provider_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_verified_at" timestamp,
	"last_login_at" timestamp,
	"password" varchar(255),
	"two_factor_secret" text,
	"two_factor_recovery_codes" text,
	"two_factor_confirmed_at" timestamp,
	"remember_token" varchar(100),
	"scheduled_deletion_at" timestamp,
	"mailcoach_subscriber_uuid" varchar(255),
	"subscriber_recency_bucket" varchar(255),
	"current_team_id" char(26),
	"profile_photo_path" varchar(2048),
	"timezone" varchar(64),
	"notification_preferences" jsonb,
	"ai_preferences" jsonb,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"creator_id" char(26),
	"account_owner_id" char(26),
	"name" varchar(255) NOT NULL,
	"creation_source" varchar(50) NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "noteables" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"note_id" char(26) NOT NULL,
	"noteable_type" varchar(255) NOT NULL,
	"noteable_id" char(26) NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"creator_id" char(26),
	"title" varchar(255) NOT NULL,
	"creation_source" varchar(50) NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"creator_id" char(26),
	"company_id" char(26),
	"contact_id" char(26),
	"name" varchar(255) NOT NULL,
	"creation_source" varchar(50) NOT NULL,
	"order_column" numeric(20, 10),
	"created_at" timestamp,
	"updated_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"creator_id" char(26),
	"company_id" char(26),
	"name" varchar(255) NOT NULL,
	"creation_source" varchar(50) NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "task_user" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" char(26) NOT NULL,
	"user_id" char(26) NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "taskables" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" char(26) NOT NULL,
	"taskable_type" varchar(255) NOT NULL,
	"taskable_id" char(26) NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26) NOT NULL,
	"creator_id" char(26),
	"title" varchar(255) NOT NULL,
	"creation_source" varchar(50) NOT NULL,
	"order_column" numeric(20, 10),
	"created_at" timestamp,
	"updated_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "custom_field_options" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"tenant_id" char(26),
	"custom_field_id" char(26) NOT NULL,
	"name" varchar(255),
	"sort_order" bigint,
	"settings" json,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "custom_field_options_custom_field_id_name_tenant_id_unique" UNIQUE("custom_field_id","name","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "custom_field_sections" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"tenant_id" char(26),
	"width" varchar(255),
	"code" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"entity_type" varchar(255) NOT NULL,
	"sort_order" bigint,
	"description" varchar(255),
	"active" boolean DEFAULT true NOT NULL,
	"system_defined" boolean DEFAULT false NOT NULL,
	"settings" json,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "custom_field_sections_entity_type_code_tenant_id_unique" UNIQUE("entity_type","code","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"tenant_id" char(26),
	"entity_type" varchar(255) NOT NULL,
	"entity_id" char(26) NOT NULL,
	"custom_field_id" char(26) NOT NULL,
	"string_value" text,
	"text_value" text,
	"boolean_value" boolean,
	"integer_value" bigint,
	"float_value" double precision,
	"date_value" date,
	"datetime_value" timestamp,
	"json_value" json,
	CONSTRAINT "custom_field_values_entity_type_unique" UNIQUE("entity_type","entity_id","custom_field_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"custom_field_section_id" char(26),
	"width" varchar(255),
	"tenant_id" char(26),
	"code" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"lookup_type" varchar(255),
	"entity_type" varchar(255) NOT NULL,
	"sort_order" bigint,
	"validation_rules" json,
	"active" boolean DEFAULT true NOT NULL,
	"system_defined" boolean DEFAULT false NOT NULL,
	"settings" json,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "custom_fields_code_entity_type_tenant_id_unique" UNIQUE("code","entity_type","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "cache" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"expiration" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cache_locks" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"owner" varchar(255) NOT NULL,
	"expiration" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failed_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"uuid" varchar(255) NOT NULL,
	"connection" text NOT NULL,
	"queue" text NOT NULL,
	"payload" text NOT NULL,
	"exception" text NOT NULL,
	"failed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "failed_jobs_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "job_batches" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"total_jobs" integer NOT NULL,
	"pending_jobs" integer NOT NULL,
	"failed_jobs" integer NOT NULL,
	"failed_job_ids" text NOT NULL,
	"options" text,
	"cancelled_at" integer,
	"created_at" integer NOT NULL,
	"finished_at" integer
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"queue" varchar(255) NOT NULL,
	"payload" text NOT NULL,
	"attempts" smallint NOT NULL,
	"reserved_at" integer,
	"available_at" integer NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"email" varchar(255) PRIMARY KEY NOT NULL,
	"token" varchar(255) NOT NULL,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" char(26),
	"ip_address" varchar(45),
	"user_agent" text,
	"payload" text NOT NULL,
	"last_activity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_access_tokens" (
	"id" char(80) PRIMARY KEY NOT NULL,
	"user_id" char(26),
	"client_id" uuid NOT NULL,
	"team_id" char(26),
	"name" varchar(255),
	"scopes" text,
	"revoked" boolean NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_auth_codes" (
	"id" char(80) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"client_id" uuid NOT NULL,
	"team_id" char(26),
	"scopes" text,
	"revoked" boolean NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_type" varchar(255),
	"owner_id" char(26),
	"name" varchar(255) NOT NULL,
	"secret" varchar(255),
	"provider" varchar(255),
	"redirect_uris" text NOT NULL,
	"grant_types" text NOT NULL,
	"revoked" boolean NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_device_codes" (
	"id" char(80) PRIMARY KEY NOT NULL,
	"user_id" char(26),
	"client_id" uuid NOT NULL,
	"user_code" char(8) NOT NULL,
	"scopes" text NOT NULL,
	"revoked" boolean NOT NULL,
	"user_approved_at" timestamp,
	"last_polled_at" timestamp,
	"expires_at" timestamp,
	CONSTRAINT "oauth_device_codes_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"id" char(80) PRIMARY KEY NOT NULL,
	"access_token_id" char(80) NOT NULL,
	"revoked" boolean NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "personal_access_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tokenable_type" varchar(255) NOT NULL,
	"tokenable_id" char(26) NOT NULL,
	"team_id" char(26),
	"name" varchar(255) NOT NULL,
	"token" varchar(64) NOT NULL,
	"abilities" text,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "personal_access_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" char(26),
	"log_name" varchar(255),
	"description" text NOT NULL,
	"subject_type" varchar(255),
	"subject_id" char(26),
	"event" varchar(255),
	"causer_type" varchar(255),
	"causer_id" char(26),
	"attribute_changes" json,
	"properties" json,
	"created_at" timestamp,
	"updated_at" timestamp,
	"batch_uuid" uuid
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26),
	"completed_at" timestamp,
	"file_disk" varchar(255) NOT NULL,
	"file_name" varchar(255),
	"exporter" varchar(255) NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"total_rows" integer NOT NULL,
	"successful_rows" integer DEFAULT 0 NOT NULL,
	"user_id" char(26) NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "failed_import_rows" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26),
	"data" json NOT NULL,
	"import_id" char(26) NOT NULL,
	"validation_error" text,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"team_id" char(26),
	"completed_at" timestamp,
	"file_name" varchar(255) NOT NULL,
	"total_rows" integer NOT NULL,
	"user_id" char(26) NOT NULL,
	"entity_type" varchar(255),
	"status" varchar(255) DEFAULT 'uploading' NOT NULL,
	"headers" json,
	"column_mappings" json,
	"created_rows" integer DEFAULT 0 NOT NULL,
	"updated_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"model_type" varchar(255) NOT NULL,
	"model_id" char(26) NOT NULL,
	"uuid" uuid,
	"collection_name" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(255),
	"disk" varchar(255) NOT NULL,
	"conversions_disk" varchar(255),
	"size" bigint NOT NULL,
	"manipulations" json NOT NULL,
	"custom_properties" json NOT NULL,
	"generated_conversions" json NOT NULL,
	"responsive_images" json NOT NULL,
	"order_column" integer,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "media_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(255) NOT NULL,
	"notifiable_type" varchar(255) NOT NULL,
	"notifiable_id" char(26) NOT NULL,
	"data" json NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "seo" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"model_type" varchar(255) NOT NULL,
	"model_id" bigint NOT NULL,
	"description" text,
	"title" varchar(255),
	"image" varchar(255),
	"author" varchar(255),
	"robots" varchar(255),
	"canonical_url" varchar(255),
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "seo_model_type_model_id_unique" UNIQUE("model_type","model_id")
);
--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_foreign" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_message_mentions" ADD CONSTRAINT "agent_conversation_message_mentions_message_id_foreign" FOREIGN KEY ("message_id") REFERENCES "public"."agent_conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_messages" ADD CONSTRAINT "agent_conversation_messages_conversation_id_foreign" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_balances" ADD CONSTRAINT "ai_credit_balances_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_conversation_id_foreign" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_conversation_id_foreign" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_message_id_foreign" FOREIGN KEY ("message_id") REFERENCES "public"."agent_conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_conversation_id_foreign" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_message_id_foreign" FOREIGN KEY ("message_id") REFERENCES "public"."agent_conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_tag" ADD CONSTRAINT "blog_post_tag_post_id_foreign" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_tag" ADD CONSTRAINT "blog_post_tag_tag_id_foreign" FOREIGN KEY ("tag_id") REFERENCES "public"."blog_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_category_id_foreign" FOREIGN KEY ("category_id") REFERENCES "public"."blog_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_foreign" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_user" ADD CONSTRAINT "team_user_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_user" ADD CONSTRAINT "team_user_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_social_accounts" ADD CONSTRAINT "user_social_accounts_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_current_team_id_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_creator_id_foreign" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_account_owner_id_foreign" FOREIGN KEY ("account_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noteables" ADD CONSTRAINT "noteables_note_id_foreign" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_creator_id_foreign" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_creator_id_foreign" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_foreign" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_id_foreign" FOREIGN KEY ("contact_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_creator_id_foreign" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_foreign" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_user" ADD CONSTRAINT "task_user_task_id_foreign" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_user" ADD CONSTRAINT "task_user_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taskables" ADD CONSTRAINT "taskables_task_id_foreign" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_id_foreign" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_options" ADD CONSTRAINT "custom_field_options_tenant_id_foreign" FOREIGN KEY ("tenant_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_options" ADD CONSTRAINT "custom_field_options_custom_field_id_foreign" FOREIGN KEY ("custom_field_id") REFERENCES "public"."custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_sections" ADD CONSTRAINT "custom_field_sections_tenant_id_foreign" FOREIGN KEY ("tenant_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_tenant_id_foreign" FOREIGN KEY ("tenant_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_custom_field_id_foreign" FOREIGN KEY ("custom_field_id") REFERENCES "public"."custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_custom_field_section_id_foreign" FOREIGN KEY ("custom_field_section_id") REFERENCES "public"."custom_field_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_tenant_id_foreign" FOREIGN KEY ("tenant_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_access_token_id_foreign" FOREIGN KEY ("access_token_id") REFERENCES "public"."oauth_access_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_import_rows" ADD CONSTRAINT "failed_import_rows_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_import_rows" ADD CONSTRAINT "failed_import_rows_import_id_foreign" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_team_id_foreign" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_foreign" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_items_subscription_id_stripe_price_index" ON "subscription_items" USING btree ("subscription_id","stripe_price");--> statement-breakpoint
CREATE INDEX "subscriptions_team_id_stripe_status_index" ON "subscriptions" USING btree ("team_id","stripe_status");--> statement-breakpoint
CREATE INDEX "agent_conversation_message_mentions_message_id_type_index" ON "agent_conversation_message_mentions" USING btree ("message_id","type");--> statement-breakpoint
CREATE INDEX "agent_conversation_message_mentions_type_record_id_index" ON "agent_conversation_message_mentions" USING btree ("type","record_id");--> statement-breakpoint
CREATE INDEX "agent_conversation_message_mentions_message_id_source_index" ON "agent_conversation_message_mentions" USING btree ("message_id","source");--> statement-breakpoint
CREATE INDEX "conversation_index" ON "agent_conversation_messages" USING btree ("conversation_id","participant_type","participant_id","updated_at");--> statement-breakpoint
CREATE INDEX "participant_index" ON "agent_conversation_messages" USING btree ("participant_type","participant_id");--> statement-breakpoint
CREATE INDEX "participant_updated_at_index" ON "agent_conversations" USING btree ("participant_type","participant_id","updated_at");--> statement-breakpoint
CREATE INDEX "team_participant_updated_at_index" ON "agent_conversations" USING btree ("team_id","participant_type","participant_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_credit_transactions_team_id_created_at_index" ON "ai_credit_transactions" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_credit_transactions_type_created_at_index" ON "ai_credit_transactions" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "ai_credit_transactions_conversation_id_index" ON "ai_credit_transactions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_credit_transactions_team_id_user_id_created_at_index" ON "ai_credit_transactions" USING btree ("team_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_message_feedback_team_id_rating_created_at_index" ON "chat_message_feedback" USING btree ("team_id","rating","created_at");--> statement-breakpoint
CREATE INDEX "pending_actions_team_id_status_index" ON "pending_actions" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "pending_actions_conversation_id_status_index" ON "pending_actions" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "pending_actions_expires_at_index" ON "pending_actions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pending_actions_status_expires_at_index" ON "pending_actions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "pending_actions_team_id_user_id_status_index" ON "pending_actions" USING btree ("team_id","user_id","status");--> statement-breakpoint
CREATE INDEX "pending_actions_message_id_index" ON "pending_actions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "blog_post_tag_tag_id_index" ON "blog_post_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "blog_posts_status_published_at_index" ON "blog_posts" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "system_administrators_email_index" ON "system_administrators" USING btree ("email");--> statement-breakpoint
CREATE INDEX "team_invitations_expires_at_index" ON "team_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "teams_user_id_index" ON "teams" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teams_scheduled_deletion_at_index" ON "teams" USING btree ("scheduled_deletion_at");--> statement-breakpoint
CREATE INDEX "teams_stripe_id_index" ON "teams" USING btree ("stripe_id");--> statement-breakpoint
CREATE INDEX "teams_trial_ends_at_index" ON "teams" USING btree ("trial_ends_at") WHERE "teams"."trial_ends_at" is not null;--> statement-breakpoint
CREATE INDEX "users_mailcoach_subscriber_uuid_index" ON "users" USING btree ("mailcoach_subscriber_uuid");--> statement-breakpoint
CREATE INDEX "users_scheduled_deletion_at_index" ON "users" USING btree ("scheduled_deletion_at");--> statement-breakpoint
CREATE INDEX "users_timezone_index" ON "users" USING btree ("timezone");--> statement-breakpoint
CREATE INDEX "idx_companies_team_activity" ON "companies" USING btree ("team_id","deleted_at","creation_source","created_at");--> statement-breakpoint
CREATE INDEX "noteables_noteable_type_noteable_id_index" ON "noteables" USING btree ("noteable_type","noteable_id");--> statement-breakpoint
CREATE INDEX "idx_notes_team_activity" ON "notes" USING btree ("team_id","deleted_at","creation_source","created_at");--> statement-breakpoint
CREATE INDEX "idx_opportunities_team_activity" ON "opportunities" USING btree ("team_id","deleted_at","creation_source","created_at");--> statement-breakpoint
CREATE INDEX "idx_people_team_activity" ON "people" USING btree ("team_id","deleted_at","creation_source","created_at");--> statement-breakpoint
CREATE INDEX "task_user_user_id_task_id_idx" ON "task_user" USING btree ("user_id","task_id");--> statement-breakpoint
CREATE INDEX "task_user_task_id_idx" ON "task_user" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "taskables_taskable_type_taskable_id_index" ON "taskables" USING btree ("taskable_type","taskable_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_team_activity" ON "tasks" USING btree ("team_id","deleted_at","creation_source","created_at");--> statement-breakpoint
CREATE INDEX "custom_field_options_tenant_id_index" ON "custom_field_options" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "custom_field_sections_tenant_id_index" ON "custom_field_sections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "custom_field_sections_tenant_entity_active_idx" ON "custom_field_sections" USING btree ("tenant_id","entity_type","active");--> statement-breakpoint
CREATE INDEX "custom_field_values_tenant_id_index" ON "custom_field_values" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_entity_type_entity_id_index" ON "custom_field_values" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_tenant_entity_idx" ON "custom_field_values" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_entity_id_custom_field_id_index" ON "custom_field_values" USING btree ("entity_id","custom_field_id");--> statement-breakpoint
CREATE INDEX "cfv_field_float_idx" ON "custom_field_values" USING btree ("custom_field_id","float_value");--> statement-breakpoint
CREATE INDEX "cfv_field_date_idx" ON "custom_field_values" USING btree ("custom_field_id","date_value");--> statement-breakpoint
CREATE INDEX "cfv_field_datetime_idx" ON "custom_field_values" USING btree ("custom_field_id","datetime_value");--> statement-breakpoint
CREATE INDEX "cfv_field_string_idx" ON "custom_field_values" USING btree ("custom_field_id","string_value");--> statement-breakpoint
CREATE INDEX "cfv_field_integer_idx" ON "custom_field_values" USING btree ("custom_field_id","integer_value");--> statement-breakpoint
CREATE INDEX "cfv_field_boolean_idx" ON "custom_field_values" USING btree ("custom_field_id","boolean_value");--> statement-breakpoint
CREATE INDEX "custom_fields_tenant_id_index" ON "custom_fields" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_global_code_entity_type_unique" ON "custom_fields" USING btree ("code","entity_type") WHERE "tenant_id" is null;--> statement-breakpoint
CREATE INDEX "custom_fields_tenant_entity_active_idx" ON "custom_fields" USING btree ("tenant_id","entity_type","active");--> statement-breakpoint
CREATE INDEX "jobs_queue_index" ON "jobs" USING btree ("queue");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_last_activity_index" ON "sessions" USING btree ("last_activity");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_user_id_index" ON "oauth_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_team_id_index" ON "oauth_access_tokens" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "oauth_auth_codes_user_id_index" ON "oauth_auth_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_auth_codes_team_id_index" ON "oauth_auth_codes" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "oauth_clients_owner_type_owner_id_index" ON "oauth_clients" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "oauth_device_codes_user_id_index" ON "oauth_device_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_device_codes_client_id_index" ON "oauth_device_codes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "personal_access_tokens_tokenable_type_tokenable_id_index" ON "personal_access_tokens" USING btree ("tokenable_type","tokenable_id");--> statement-breakpoint
CREATE INDEX "personal_access_tokens_team_id_index" ON "personal_access_tokens" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "activity_log_log_name_index" ON "activity_log" USING btree ("log_name");--> statement-breakpoint
CREATE INDEX "subject" ON "activity_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "causer" ON "activity_log" USING btree ("causer_type","causer_id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_subject_timeline" ON "activity_log" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_log_team_activity" ON "activity_log" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_batch_uuid_index" ON "activity_log" USING btree ("batch_uuid");--> statement-breakpoint
CREATE INDEX "media_model_type_model_id_index" ON "media" USING btree ("model_type","model_id");--> statement-breakpoint
CREATE INDEX "media_order_column_index" ON "media" USING btree ("order_column");--> statement-breakpoint
CREATE INDEX "notifications_notifiable_type_notifiable_id_index" ON "notifications" USING btree ("notifiable_type","notifiable_id");--> statement-breakpoint
CREATE INDEX "seo_model_type_model_id_index" ON "seo" USING btree ("model_type","model_id");
