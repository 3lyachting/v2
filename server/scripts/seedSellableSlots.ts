import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { disponibilites } from "../../drizzle/schema";
import { getDb } from "../db";

type SlotInput = {
  debut: Date;
  fin: Date;
  destination: string;
  statut: "disponible" | "reserve" | "option" | "ferme";
  planningType: "charter" | "technical_stop" | "maintenance" | "blocked";
  tarif: number | null;
  tarifCabine: number | null;
  tarifJourPersonne: number | null;
  tarifJourPriva: number | null;
  capaciteTotale: number;
  notePublique?: string | null;
};

function toUtcDate(isoDay: string) {
  return new Date(`${isoDay}T00:00:00.000Z`);
}

function addDays(isoDay: string, days: number) {
  const d = toUtcDate(isoDay);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function saturdaysBetween(startIso: string, endIso: string) {
  const result: string[] = [];
  let cur = toUtcDate(startIso);
  while (cur.getUTCDay() !== 6) {
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  while (cur <= toUtcDate(endIso)) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return result;
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return startA <= endB && endA >= startB;
}

async function upsertSlot(slot: SlotInput) {
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible.");
  const existing = await db
    .select({ id: disponibilites.id, statut: disponibilites.statut, planningType: disponibilites.planningType })
    .from(disponibilites)
    .where(and(eq(disponibilites.debut, slot.debut), eq(disponibilites.fin, slot.fin), eq(disponibilites.destination, slot.destination)))
    .limit(1);

  if (existing[0]?.id) {
    // Preserve explicit non-charter blocks/maintenance.
    if (existing[0].planningType !== "charter") return;
    await db
      .update(disponibilites)
      .set({
        planningType: slot.planningType,
        tarif: slot.tarif,
        tarifCabine: slot.tarifCabine,
        tarifJourPersonne: slot.tarifJourPersonne,
        tarifJourPriva: slot.tarifJourPriva,
        capaciteTotale: slot.capaciteTotale,
        notePublique: slot.notePublique ?? null,
        updatedAt: new Date(),
      })
      .where(eq(disponibilites.id, existing[0].id));
    return;
  }

  await db.insert(disponibilites).values({
    planningType: slot.planningType,
    debut: slot.debut,
    fin: slot.fin,
    statut: slot.statut,
    destination: slot.destination,
    tarif: slot.tarif,
    tarifCabine: slot.tarifCabine,
    tarifJourPersonne: slot.tarifJourPersonne,
    tarifJourPriva: slot.tarifJourPriva,
    capaciteTotale: slot.capaciteTotale,
    cabinesReservees: 0,
    notePublique: slot.notePublique ?? null,
    note: null,
  });
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible.");
  const year = 2026;

  // 1) Journées vendables avril/mai/juin (privatif de base)
  const dayStart = `${year}-04-01`;
  const dayEnd = `${year}-06-30`;
  let cursor = toUtcDate(dayStart);
  const dayEndDate = toUtcDate(dayEnd);
  while (cursor <= dayEndDate) {
    const iso = cursor.toISOString().slice(0, 10);
    await upsertSlot({
      debut: toUtcDate(iso),
      fin: toUtcDate(iso),
      destination: "La Ciotat",
      statut: "disponible",
      planningType: "charter",
      tarif: null,
      tarifCabine: null,
      tarifJourPersonne: 130,
      tarifJourPriva: 950,
      capaciteTotale: 4,
      notePublique: "Journée vendable",
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // 2) Semaines vendables ensuite (samedi -> samedi)
  const weekStart = `${year}-07-01`;
  const weekEnd = `${year}-12-31`;
  const transatOutboundStart = `${year}-11-05`;
  const transatOutboundEnd = `${year}-12-05`;
  for (const saturday of saturdaysBetween(weekStart, weekEnd)) {
    const end = addDays(saturday, 7);
    // Do not generate Med/Corse weekly slots overlapping the transat window.
    if (rangesOverlap(saturday, end, transatOutboundStart, transatOutboundEnd)) {
      continue;
    }
    await upsertSlot({
      debut: toUtcDate(saturday),
      fin: toUtcDate(end),
      destination: "Méditerranée / Corse",
      statut: "disponible",
      planningType: "charter",
      tarif: 16000,
      tarifCabine: 2000,
      tarifJourPersonne: null,
      tarifJourPriva: null,
      capaciteTotale: 4,
      notePublique: "Semaine du samedi au samedi",
    });
  }

  console.log("[seed-sellable-slots] Créneaux journée + semaines générés.");
}

main().catch((error) => {
  console.error("[seed-sellable-slots] Echec:", error);
  process.exit(1);
});

