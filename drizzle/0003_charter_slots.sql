CREATE TYPE "public"."charter_product" AS ENUM('med', 'caraibes', 'journee', 'transat');--> statement-breakpoint
CREATE TABLE "charterSlots" (
	"id" serial PRIMARY KEY NOT NULL,
	"product" "charter_product" NOT NULL,
	"debut" timestamp NOT NULL,
	"fin" timestamp NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"publicNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "charterSlots_uniq_range_product_idx" ON "charterSlots" USING btree ("debut","fin","product");
