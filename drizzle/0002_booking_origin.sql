CREATE TYPE "public"."booking_origin" AS ENUM('direct', 'clicknboat', 'skippair', 'samboat');--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "bookingOrigin" "booking_origin" DEFAULT 'direct' NOT NULL;
