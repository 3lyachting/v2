import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { disponibilites } from "../../drizzle/schema";
import { getDb } from "../db";

function toUtcDayStart(isoDay: string) {
  return new Date(`${isoDay}T00:00:00.000Z`);
}

const DAYS = ["2026-04-15", "2026-04-25"] as const;

async function upsertDailySlot(isoDay: string) {
  const db = await getDb();
  if (!db) throw new Error("Base de donnees non disponible.");

  const debut = toUtcDayStart(isoDay);
  const fin = toUtcDayStart(isoDay);
  const destination = "La Ciotat";

  const existing = await db
    .select({ id: disponibilites.id, planningType: disponibilites.planningType })
    .from(disponibilites)
    .where(
      and(eq(disponibilites.debut, debut), eq(disponibilites.fin, fin), eq(disponibilites.destination, destination)),
    )
    .limit(1);

  if (existing[0]?.id) {
    if (existing[0].planningType !== "charter") {
      console.log(`= ${isoDay} conserve (non-charter)`);
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
        notePublique: "Journee passee (stats)",
        note: "Ajout manuel pour statistiques",
        updatedAt: new Date(),
      })
      .where(eq(disponibilites.id, existing[0].id));
    console.log(`~ ${isoDay} mis a jour`);
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
    notePublique: "Journee passee (stats)",
    note: "Ajout manuel pour statistiques",
  });
  console.log(`+ ${isoDay} cree`);
}

async function main() {
  for (const day of DAYS) {
    await upsertDailySlot(day);
  }
  console.log("OK - Journees passees avril creees pour stats.");
}

main().catch((error) => {
  console.error("[seedPastJourneeDisponibilitesApril2026] Echec:", error);
  process.exit(1);
});
