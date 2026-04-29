import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL manquante.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'charter_product') THEN
          CREATE TYPE "public"."charter_product" AS ENUM ('med', 'caraibes', 'journee', 'transat');
        END IF;
      END $$;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "charterSlots" (
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
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "charterSlots_uniq_range_product_idx"
      ON "charterSlots" USING btree ("debut","fin","product");
    `);

    console.log("OK - table charterSlots verifiee/cree.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[ensureCharterSlotsTable] Echec:", error);
  process.exit(1);
});
