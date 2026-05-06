-- Secours si 0006_marvelous_wrecker n'a pas été appliqué sur cet environnement (IF NOT EXISTS = idempotent).
CREATE TABLE IF NOT EXISTS "backoffice_local_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"passwordHash" text NOT NULL,
	"role" varchar(20) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "backoffice_local_accounts_email_unique" UNIQUE("email")
);
