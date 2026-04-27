import "dotenv/config";
import { and, eq, gte, lte, like } from "drizzle-orm";
import { disponibilites, reservations } from "../../drizzle/schema";
import { getDb } from "../db";

function toUtcDate(isoDay: string) {
  return new Date(`${isoDay}T00:00:00.000Z`);
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA <= endB && endA >= startB;
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible.");

  const year = 2026;
  const transatStart = toUtcDate(`${year}-11-05`);
  const transatEnd = toUtcDate(`${year}-12-05`);

  const candidates = await db
    .select()
    .from(disponibilites)
    .where(
      and(
        like(disponibilites.destination, "%Méditerranée%"),
        gte(disponibilites.debut, toUtcDate(`${year}-10-01`)),
        lte(disponibilites.fin, toUtcDate(`${year}-12-31`)),
      ),
    );

  let deleted = 0;
  for (const slot of candidates) {
    if (!overlaps(new Date(slot.debut), new Date(slot.fin), transatStart, transatEnd)) continue;
    const linkedReservations = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.disponibiliteId, slot.id))
      .limit(1);
    if (linkedReservations.length > 0) continue;
    await db.delete(disponibilites).where(eq(disponibilites.id, slot.id));
    deleted += 1;
  }

  console.log(`[cleanup-transat-overlaps] Créneaux supprimés: ${deleted}`);
}

main().catch((error) => {
  console.error("[cleanup-transat-overlaps] Echec:", error);
  process.exit(1);
});

