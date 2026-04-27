import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { disponibilites, reservations } from "../../drizzle/schema";
import { getDb } from "../db";
import { inferSlotType, isTransatType } from "@shared/slotRules";
import {
  refreshDisponibiliteBookingState,
  resolveDisponibiliteIdForReservation,
  syncDisponibilitesFromReservations,
} from "../_core/bookingRules";

type DispoRow = typeof disponibilites.$inferSelect;
type ReservationRow = {
  id: number;
  disponibiliteId: number | null;
  typeReservation: "bateau_entier" | "cabine" | "place";
  nbCabines: number | null;
  requestStatus: string | null;
  workflowStatut: string | null;
  dateDebut: Date | string;
  dateFin: Date | string;
  destination: string | null;
  formule: string | null;
  ownerValidatedAt: Date | string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

async function listReservationsLite(db: any): Promise<ReservationRow[]> {
  const result = await db.execute(
    `select id, "disponibiliteId", "typeReservation", "nbCabines", "requestStatus", "workflowStatut",
            "dateDebut", "dateFin", destination, formule, "ownerValidatedAt", "createdAt", "updatedAt"
       from reservations`,
  );
  return ((result as any)?.rows || []) as ReservationRow[];
}

function toIsoDay(value: unknown) {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toHalfOpenRange(row: DispoRow) {
  const start = toIsoDay(row.debut);
  const end = toIsoDay(row.fin);
  if (!start || !end) return null;
  const endExclusive = start === end ? addDays(end, 1) : end;
  return { start, end, endExclusive };
}

function overlapsHalfOpen(a: { start: string; endExclusive: string }, b: { start: string; endExclusive: string }) {
  return a.start < b.endExclusive && b.start < a.endExclusive;
}

function overlapsInclusive(a: { start: string; end: string }, b: { start: string; end: string }) {
  return a.start <= b.end && b.start <= a.end;
}

function getBucket(row: DispoRow): "transat" | "journee" | "caraibes" | "med" {
  const slotType = inferSlotType(row as any);
  if (isTransatType(slotType)) return "transat";
  if (slotType === "day_private") return "journee";
  if (slotType === "caribbean_week") return "caraibes";
  return "med";
}

function getReservationRange(r: ReservationRow) {
  const start = toIsoDay(r.dateDebut);
  const endRaw = toIsoDay(r.dateFin);
  if (!start || !endRaw) return null;
  const end = endRaw < start ? start : endRaw;
  return { start, end };
}

function scoreForKeep(row: DispoRow, linkedReservationCount: number) {
  const statusPriority: Record<string, number> = {
    reserve: 0,
    option: 1,
    ferme: 2,
    disponible: 3,
  };
  const statusScore = statusPriority[String(row.statut)] ?? 99;
  const updatedAtScore = new Date(row.updatedAt).getTime() || 0;
  return [
    linkedReservationCount > 0 ? 1 : 0,
    -statusScore,
    updatedAtScore,
    row.id,
  ] as const;
}

function compareTuple(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av === bv) continue;
    return av > bv ? -1 : 1;
  }
  return 0;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible.");

  const allDispos = await db.select().from(disponibilites);
  const allReservations = await listReservationsLite(db);
  const reservationCountByDispo = new Map<number, number>();
  for (const r of allReservations) {
    if (!r.disponibiliteId) continue;
    reservationCountByDispo.set(r.disponibiliteId, (reservationCountByDispo.get(r.disponibiliteId) || 0) + 1);
  }

  const byExactKey = new Map<string, DispoRow[]>();
  for (const d of allDispos) {
    const start = toIsoDay(d.debut);
    const end = toIsoDay(d.fin);
    if (!start || !end) continue;
    const key = `${start}|${end}|${d.destination}`;
    byExactKey.set(key, [...(byExactKey.get(key) || []), d]);
  }

  const duplicateGroups = Array.from(byExactKey.entries()).filter(([, rows]) => rows.length > 1);
  const rangeGroups = new Map<string, DispoRow[]>();
  for (const d of allDispos) {
    const start = toIsoDay(d.debut);
    const end = toIsoDay(d.fin);
    if (!start || !end) continue;
    const key = `${start}|${end}`;
    rangeGroups.set(key, [...(rangeGroups.get(key) || []), d]);
  }
  const duplicateRanges = Array.from(rangeGroups.entries()).filter(([, rows]) => rows.length > 1);

  const duplicatePlan = duplicateRanges.map(([, rows]) => {
    const sorted = rows.slice().sort((a, b) =>
      compareTuple(
        scoreForKeep(a, reservationCountByDispo.get(a.id) || 0),
        scoreForKeep(b, reservationCountByDispo.get(b.id) || 0),
      ),
    );
    return {
      keep: sorted[0],
      drop: sorted.slice(1),
    };
  });
  const duplicateRowsToDelete = duplicatePlan.flatMap((g) => g.drop);

  const dispoById = new Map(allDispos.map((d) => [d.id, d]));
  const reservationsWithoutDispo = allReservations.filter((r) => r.disponibiliteId && !dispoById.has(r.disponibiliteId));
  const reservationRangeMismatch = allReservations.filter((r) => {
    if (!r.disponibiliteId) return false;
    const d = dispoById.get(r.disponibiliteId);
    if (!d) return false;
    const rr = getReservationRange(r);
    const dr = toHalfOpenRange(d);
    if (!rr || !dr) return false;
    return !overlapsInclusive(rr, { start: dr.start, end: dr.end });
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const pastStillBookable = allDispos.filter((d) => {
    const end = toIsoDay(d.fin);
    if (!end || end >= todayIso) return false;
    return String(d.statut) !== "ferme";
  });

  const linkedReservationsByDispo = new Map<number, ReservationRow[]>();
  for (const r of allReservations) {
    if (!r.disponibiliteId) continue;
    linkedReservationsByDispo.set(r.disponibiliteId, [...(linkedReservationsByDispo.get(r.disponibiliteId) || []), r]);
  }
  const capacityConflicts = allDispos.filter((d) => {
    const linked = linkedReservationsByDispo.get(d.id) || [];
    if (linked.length === 0) return false;
    const confirmed = new Set(["contrat_signe", "acompte_confirme", "solde_confirme"]);
    const blocking = new Set(["validee_owner", "devis_emis", "devis_accepte", "contrat_envoye", "acompte_attente"]);
    const reservedUnits = linked.reduce((sum, r) => {
      const ws = String(r.workflowStatut || "");
      const reqValidated = String(r.requestStatus || "") === "validee";
      if (!confirmed.has(ws) && !blocking.has(ws) && !reqValidated) return sum;
      if (String(r.typeReservation || "") === "bateau_entier") return d.capaciteTotale || 4;
      return sum + Math.max(1, Number(r.nbCabines || 1));
    }, 0);
    return reservedUnits > (d.capaciteTotale || 4);
  });

  const charters = allDispos.filter((d) => String(d.planningType) === "charter");
  const overlaps: Array<{ aId: number; bId: number; bucket: string; aRange: string; bRange: string }> = [];
  for (let i = 0; i < charters.length; i += 1) {
    const a = charters[i];
    const aRange = toHalfOpenRange(a);
    if (!aRange) continue;
    const aBucket = getBucket(a);
    for (let j = i + 1; j < charters.length; j += 1) {
      const b = charters[j];
      if (a.id === b.id) continue;
      const bBucket = getBucket(b);
      if (aBucket !== bBucket) continue;
      const bRange = toHalfOpenRange(b);
      if (!bRange) continue;
      if (!overlapsHalfOpen(aRange, bRange)) continue;
      const exactSame = aRange.start === bRange.start && aRange.end === bRange.end && a.destination === b.destination;
      if (exactSame) continue;
      overlaps.push({
        aId: a.id,
        bId: b.id,
        bucket: aBucket,
        aRange: `${aRange.start}..${aRange.end}`,
        bRange: `${bRange.start}..${bRange.end}`,
      });
    }
  }

  const focusWindows = [
    { label: "avril-mai", start: "2026-04-01", end: "2026-05-31" },
    { label: "aout", start: "2026-08-01", end: "2026-08-31" },
    { label: "novembre-transat", start: "2026-11-01", end: "2026-11-30" },
  ];
  const windowStats = focusWindows.map((w) => {
    const inWindow = allDispos.filter((d) => {
      const r = toHalfOpenRange(d);
      if (!r) return false;
      return r.start <= w.end && r.end >= w.start;
    });
    const uniqueExactKeys = new Set(
      inWindow
        .map((d) => {
          const start = toIsoDay(d.debut);
          const end = toIsoDay(d.fin);
          if (!start || !end) return null;
          return `${start}|${end}|${d.destination}`;
        })
        .filter((k): k is string => Boolean(k)),
    ).size;
    return {
      label: w.label,
      slots: inWindow.length,
      exactDuplicates: inWindow.length - uniqueExactKeys,
    };
  });

  console.log("[audit-disponibilites] BEFORE");
  console.log(JSON.stringify({
    totalSlots: allDispos.length,
    exactDuplicateGroups: duplicateGroups.length,
    capacityConflicts: capacityConflicts.length,
    reservationsWithoutDispo: reservationsWithoutDispo.length,
    reservationRangeMismatch: reservationRangeMismatch.length,
    duplicateRanges: duplicateRanges.length,
    pastStillBookable: pastStillBookable.length,
    exactDuplicateRows: duplicateRowsToDelete.length,
    overlapsSameBucket: overlaps.length,
    windowStats,
  }, null, 2));

  if (apply) {
    for (const group of duplicatePlan) {
      const keepId = group.keep.id;
      for (const loser of group.drop) {
        const linked = allReservations.filter((r) => r.disponibiliteId === loser.id).map((r) => r.id);
        if (linked.length > 0) {
          await db
            .update(reservations)
            .set({ disponibiliteId: keepId, updatedAt: new Date() })
            .where(inArray(reservations.id, linked));
        }
        await db.delete(disponibilites).where(eq(disponibilites.id, loser.id));
      }
    }

    const toRepair = allReservations.filter((r) => {
      const hasMissingLink = Boolean(r.disponibiliteId && !dispoById.has(r.disponibiliteId));
      if (hasMissingLink) return true;
      if (!r.disponibiliteId) return false;
      const d = dispoById.get(r.disponibiliteId);
      if (!d) return true;
      const rr = getReservationRange(r);
      const dr = toHalfOpenRange(d);
      if (!rr || !dr) return false;
      return !overlapsInclusive(rr, { start: dr.start, end: dr.end });
    });
    for (const r of toRepair) {
      const bestId = await resolveDisponibiliteIdForReservation(db, { ...r, disponibiliteId: null });
      if (bestId && bestId !== r.disponibiliteId) {
        await db
          .update(reservations)
          .set({ disponibiliteId: bestId, updatedAt: new Date() })
          .where(eq(reservations.id, r.id));
      } else if (!bestId && r.disponibiliteId) {
        await db
          .update(reservations)
          .set({ disponibiliteId: null, updatedAt: new Date() })
          .where(eq(reservations.id, r.id));
      }
    }

    const allAfterRelink = await db.select().from(disponibilites);
    const pastBookableIds = allAfterRelink
      .filter((d) => {
        const end = toIsoDay(d.fin);
        if (!end || end >= todayIso) return false;
        return String(d.statut) !== "ferme";
      })
      .map((d) => d.id);
    if (pastBookableIds.length > 0) {
      await db
        .update(disponibilites)
        .set({
          statut: "ferme",
          cabinesReservees: 0,
          updatedAt: new Date(),
        })
        .where(inArray(disponibilites.id, pastBookableIds));
    }

    await syncDisponibilitesFromReservations(db);

    const refreshedDispos = await db.select({ id: disponibilites.id }).from(disponibilites);
    for (const d of refreshedDispos) {
      await refreshDisponibiliteBookingState(db, d.id);
    }
  }

  const afterDispos = await db.select().from(disponibilites);
  const afterReservations = await listReservationsLite(db);
  const afterByExactKey = new Map<string, number>();
  for (const d of afterDispos) {
    const start = toIsoDay(d.debut);
    const end = toIsoDay(d.fin);
    if (!start || !end) continue;
    const key = `${start}|${end}|${d.destination}`;
    afterByExactKey.set(key, (afterByExactKey.get(key) || 0) + 1);
  }
  const afterDuplicateRows = Array.from(afterByExactKey.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  const afterRangeGroups = new Map<string, number[]>();
  for (const d of afterDispos) {
    const start = toIsoDay(d.debut);
    const end = toIsoDay(d.fin);
    if (!start || !end) continue;
    const key = `${start}|${end}`;
    afterRangeGroups.set(key, [...(afterRangeGroups.get(key) || []), d.id]);
  }
  const afterDuplicateRanges = Array.from(afterRangeGroups.values()).filter((ids) => ids.length > 1).length;
  const afterByDispo = new Map(afterDispos.map((d) => [d.id, d]));
  const afterReservationsWithoutDispo = afterReservations.filter((r) => r.disponibiliteId && !afterByDispo.has(r.disponibiliteId)).length;
  const afterReservationRangeMismatch = afterReservations.filter((r) => {
    if (!r.disponibiliteId) return false;
    const d = afterByDispo.get(r.disponibiliteId);
    if (!d) return false;
    const rr = getReservationRange(r);
    const dr = toHalfOpenRange(d);
    if (!rr || !dr) return false;
    return !overlapsInclusive(rr, { start: dr.start, end: dr.end });
  }).length;
  const afterPastStillBookable = afterDispos.filter((d) => {
    const end = toIsoDay(d.fin);
    if (!end || end >= todayIso) return false;
    return String(d.statut) !== "ferme";
  }).length;
  const afterExactDuplicateGroups = Array.from(afterByExactKey.values()).filter((count) => count > 1).length;

  const linkedAfter = new Map<number, ReservationRow[]>();
  for (const r of afterReservations) {
    if (!r.disponibiliteId) continue;
    linkedAfter.set(r.disponibiliteId, [...(linkedAfter.get(r.disponibiliteId) || []), r]);
  }
  const afterCapacityConflicts = afterDispos.filter((d) => {
    const linked = linkedAfter.get(d.id) || [];
    if (linked.length === 0) return false;
    const confirmed = new Set(["contrat_signe", "acompte_confirme", "solde_confirme"]);
    const blocking = new Set(["validee_owner", "devis_emis", "devis_accepte", "contrat_envoye", "acompte_attente"]);
    const reservedUnits = linked.reduce((sum, r) => {
      const ws = String(r.workflowStatut || "");
      const reqValidated = String(r.requestStatus || "") === "validee";
      if (!confirmed.has(ws) && !blocking.has(ws) && !reqValidated) return sum;
      if (String(r.typeReservation || "") === "bateau_entier") return d.capaciteTotale || 4;
      return sum + Math.max(1, Number(r.nbCabines || 1));
    }, 0);
    return reservedUnits > (d.capaciteTotale || 4);
  }).length;

  console.log("[audit-disponibilites] AFTER");
  console.log(JSON.stringify({
    totalSlots: afterDispos.length,
    exactDuplicateGroups: afterExactDuplicateGroups,
    capacityConflicts: afterCapacityConflicts,
    reservationsWithoutDispo: afterReservationsWithoutDispo,
    reservationRangeMismatch: afterReservationRangeMismatch,
    duplicateRanges: afterDuplicateRanges,
    pastStillBookable: afterPastStillBookable,
    exactDuplicateRows: afterDuplicateRows,
    applied: apply,
  }, null, 2));
}

main().catch((error) => {
  console.error("[audit-disponibilites] Echec:", error);
  process.exit(1);
});

