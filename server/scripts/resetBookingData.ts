import "dotenv/config";
import { sql } from "drizzle-orm";
import { cabinesReservees, disponibilites, reservations } from "../../drizzle/schema";
import { getDb } from "../db";
import { runBookingConsistencyAudit, seedDefaultAvailabilitySlots, syncDisponibilitesFromReservations } from "../_core/bookingRules";

async function main() {
  const db = await getDb();
  if (!db) {
    throw new Error("DATABASE_URL absent ou DB indisponible.");
  }

  const currentYear = new Date().getUTCFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  await db.execute(sql`TRUNCATE TABLE "reservations" RESTART IDENTITY CASCADE`);
  await db.delete(cabinesReservees);
  await db.delete(disponibilites);

  await seedDefaultAvailabilitySlots(db, years);
  await syncDisponibilitesFromReservations(db);

  const audit = await runBookingConsistencyAudit(db);
  console.info("[resetBookingData] done", audit.summary);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[resetBookingData] failed", error);
    process.exit(1);
  });
