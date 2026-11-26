ALTER TYPE "public"."charter_product" ADD VALUE IF NOT EXISTS 'journee_guadeloupe';--> statement-breakpoint
ALTER TYPE "public"."booking_origin" ADD VALUE IF NOT EXISTS 'baptiste';--> statement-breakpoint
ALTER TYPE "public"."booking_origin" ADD VALUE IF NOT EXISTS 'intersail';--> statement-breakpoint
ALTER TYPE "public"."booking_origin" ADD VALUE IF NOT EXISTS 'globesailor';--> statement-breakpoint
ALTER TABLE "charterSlots" ADD COLUMN IF NOT EXISTS "departurePort" varchar(80);
