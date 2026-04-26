import "dotenv/config";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { disponibilites } from "../../drizzle/schema";
import { getDb } from "../db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB indisponible");

  const reservationsCount = await db.execute(sql`select count(*)::int as c from "reservations"`);
  const closedCount = await db
    .select({ c: sql<number>`count(*)` })
    .from(disponibilites)
    .where(eq(disponibilites.statut, "ferme"));
  const transatAllerCount = await db
    .select({ c: sql<number>`count(*)` })
    .from(disponibilites)
    .where(
      and(
        eq(disponibilites.destination, "Transat aller — La Ciotat -> Pointe-à-Pitre via Canaries et Cap-Vert"),
        gte(disponibilites.debut, new Date("2026-04-05T00:00:00.000Z")),
        lte(disponibilites.fin, new Date("2026-12-15T00:00:00.000Z"))
      )
    );
  const transatRetourCurrentYear = await db
    .select({ c: sql<number>`count(*)` })
    .from(disponibilites)
    .where(
      and(
        eq(disponibilites.destination, "Transat retour — Pointe-à-Pitre -> La Ciotat"),
        gte(disponibilites.debut, new Date("2026-04-05T00:00:00.000Z")),
        lte(disponibilites.fin, new Date("2026-05-15T00:00:00.000Z"))
      )
    );
  const transatRetourPrevYear = await db
    .select({ c: sql<number>`count(*)` })
    .from(disponibilites)
    .where(
      and(
        eq(disponibilites.destination, "Transat retour — Pointe-à-Pitre -> La Ciotat"),
        gte(disponibilites.debut, new Date("2025-04-05T00:00:00.000Z")),
        lte(disponibilites.fin, new Date("2025-05-15T00:00:00.000Z"))
      )
    );
  const aprilMayDaySlots = await db
    .select({ c: sql<number>`count(*)` })
    .from(disponibilites)
    .where(
      and(
        eq(disponibilites.destination, "La Ciotat - Cassis (plage de l'Arène) - retour"),
        gte(disponibilites.debut, new Date("2026-04-01T00:00:00.000Z")),
        lte(disponibilites.fin, new Date("2026-05-31T00:00:00.000Z"))
      )
    );

  console.info(
    JSON.stringify({
      reservations: reservationsCount.rows?.[0]?.c ?? 0,
      ferme: Number(closedCount[0]?.c || 0),
      transatAllerSlots: Number(transatAllerCount[0]?.c || 0),
      transatRetourCurrentYear: Number(transatRetourCurrentYear[0]?.c || 0),
      transatRetourPrevYear: Number(transatRetourPrevYear[0]?.c || 0),
      aprilMayDaySlots: Number(aprilMayDaySlots[0]?.c || 0),
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
