import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { disponibilites } from "../../drizzle/schema";
import { getDb } from "../db";

function toUtcDay(isoDay: string) {
  return new Date(`${isoDay}T00:00:00.000Z`);
}

async function upsertDailySlot(isoDay: string) {
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible.");

  const debut = toUtcDay(isoDay);
  const fin = toUtcDay(isoDay);
  const destination = "La Ciotat";

  const existing = await db
    .select({
      id: disponibilites.id,
      planningType: disponibilites.planningType,
    })
    .from(disponibilites)
    .where(
      and(eq(disponibilites.debut, debut), eq(disponibilites.fin, fin), eq(disponibilites.destination, destination))
    )
    .limit(1);

  if (existing[0]?.id) {
    if (existing[0].planningType !== "charter") {
      console.log(`= ${isoDay} conservé (non-charter)`);
      return;
    }
    await db
      .update(disponibilites)
      .set({
        statut: "disponible",
        planningType: "charter",
        tarif: null,
        tarifCabine: null,
        tarifJourPersonne: 130,
        tarifJourPriva: 950,
        capaciteTotale: 4,
        notePublique: "Journée vendable",
        updatedAt: new Date(),
      })
      .where(eq(disponibilites.id, existing[0].id));
    console.log(`~ ${isoDay} mis à jour`);
    return;
  }

  await db.insert(disponibilites).values({
    planningType: "charter",
    debut,
    fin,
    statut: "disponible",
    destination,
    tarif: null,
    tarifCabine: null,
    tarifJourPersonne: 130,
    tarifJourPriva: 950,
    capaciteTotale: 4,
    cabinesReservees: 0,
    notePublique: "Journée vendable",
    note: null,
  });
  console.log(`+ ${isoDay} créé`);
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible.");

  const year = 2026;
  const start = new Date(Date.UTC(year, 4, 1, 0, 0, 0, 0)); // Mai
  const end = new Date(Date.UTC(year, 4, 31, 0, 0, 0, 0));

  const cursor = new Date(start);
  while (cursor <= end) {
    const isoDay = cursor.toISOString().slice(0, 10);
    await upsertDailySlot(isoDay);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  console.log("OK — disponibilités quotidiennes de mai générées.");
}

main().catch((error) => {
  console.error("[seed-may-daily-disponibilites] Echec:", error);
  process.exit(1);
});

