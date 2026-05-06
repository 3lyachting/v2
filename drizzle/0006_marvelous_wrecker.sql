ALTER TYPE "public"."document_category" ADD VALUE 'crew';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'passenger';--> statement-breakpoint
CREATE TABLE "backoffice_local_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"passwordHash" text NOT NULL,
	"role" varchar(20) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "backoffice_local_accounts_email_unique" UNIQUE("email")
);
