import "dotenv/config";
import { Pool } from "pg";

async function run(pool: Pool) {
  await pool.query(
    `ALTER TYPE "public"."booking_origin" ADD VALUE IF NOT EXISTS 'boataround';`
  );
  const { rows } = await pool.query<{ enumlabel: string }>(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'booking_origin'
    ORDER BY e.enumsortorder;
  `);
  console.log(
    "OK — booking_origin:",
    rows.map((r) => r.enumlabel).join(", ")
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL manquante.");
  }

  const hostNeedsSsl =
    /supabase|render\.com|neon\.tech|aws|azure|digitalocean|pooler/i.test(
      databaseUrl
    );

  const trySsl = async (ssl: boolean) => {
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: ssl ? { rejectUnauthorized: false } : false,
    });
    try {
      await run(pool);
    } finally {
      await pool.end();
    }
  };

  try {
    await trySsl(hostNeedsSsl || process.env.NODE_ENV === "production");
  } catch (first) {
    if (hostNeedsSsl) throw first;
    console.warn("Première tentative sans SSL échouée, nouvel essai avec SSL…");
    await trySsl(true);
  }
}

main().catch((error) => {
  console.error("[applyBoataroundBookingOrigin] Échec:", error);
  process.exit(1);
});
