import "dotenv/config";
import { eq } from "drizzle-orm";
import { disponibilites, reservations } from "../../drizzle/schema";
import { getDb } from "../db";
import { SLOT_NOTE_PREFIX } from "../../shared/slotRules";

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function looksLikeAutoCaraibesSlot(row: any) {
  const destination = String(row.destination || "").toLowerCase();
  const note = String(row.note || "");
  const notePublique = String(row.notePublique || "");
  const start = toIso(row.debut);
  const end = toIso(row.fin);
  if (!start || !end) return false;
  const inSummerWindow = start >= "2026-06-01" && end <= "2026-08-31";
  if (!inSummerWindow) return false;
  if (!destination.includes("cara")) return false;
  return (
    note.startsWith(`${SLOT_NOTE_PREFIX}:`) ||
    notePublique.includes("Croisière Caraïbes") ||
    notePublique.includes("créé automatiquement")
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible.");

  const all = await db.select().from(disponibilites);
  const candidates = all.filter(looksLikeAutoCaraibesSlot);

  const withLinks: Array<{ id: number; reservations: number }> = [];
  const deletable: number[] = [];
  for (const row of candidates) {
    const linked = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.disponibiliteId, row.id));
    if (linked.length > 0) {
      withLinks.push({ id: row.id, reservations: linked.length });
      continue;
    }
    deletable.push(row.id);
  }

  console.log("[cleanup-caraibes-parasites] BEFORE");
  console.log(
    JSON.stringify(
      {
        totalSlots: all.length,
        candidateParasites: candidates.length,
        linkedToReservations: withLinks.length,
        deletableParasites: deletable.length,
        sampleDeletableIds: deletable.slice(0, 10),
        apply,
      },
      null,
      2,
    ),
  );

  if (apply && deletable.length > 0) {
    for (const id of deletable) {
      await db.delete(disponibilites).where(eq(disponibilites.id, id));
    }
  }

  const after = await db.select().from(disponibilites);
  const afterCandidates = after.filter(looksLikeAutoCaraibesSlot);
  console.log("[cleanup-caraibes-parasites] AFTER");
  console.log(
    JSON.stringify(
      {
        totalSlots: after.length,
        remainingCandidateParasites: afterCandidates.length,
        deleted: apply ? deletable.length - afterCandidates.length : 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[cleanup-caraibes-parasites] Echec:", error);
  process.exit(1);
});
