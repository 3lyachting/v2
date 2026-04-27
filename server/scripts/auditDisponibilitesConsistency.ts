import "dotenv/config";
import { inArray } from "drizzle-orm";
import { disponibilites, reservations } from "../../drizzle/schema";
import { getDb } from "../db";
import { inferSlotType, isTransatType } from "@shared/slotRules";

type DispoRow = typeof disponibilites.$inferSelect;

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

function getBucket(row: DispoRow): "transat" | "journee" | "caraibes" | "med" {
  const slotType = inferSlotType(row as any);
  if (isTransatType(slotType)) return "transat";
  if (slotType === "day_private") return "journee";
  if (slotType === "caribbean_week") return "caraibes";
  return "med";
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
  const allReservations = await db.select({ id: reservations.id, disponibiliteId: reservations.disponibiliteId }).from(reservations);
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
  const duplicateRowsToDelete: DispoRow[] = [];
  for (const [, rows] of duplicateGroups) {
    const sorted = rows
      .slice()
      .sort((a, b) =>
        compareTuple(
          scoreForKeep(a, reservationCountByDispo.get(a.id) || 0),
          scoreForKeep(b, reservationCountByDispo.get(b.id) || 0),
        ),
      );
    duplicateRowsToDelete.push(...sorted.slice(1));
  }

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
    exactDuplicateRows: duplicateRowsToDelete.length,
    overlapsSameBucket: overlaps.length,
    windowStats,
  }, null, 2));

  if (apply && duplicateRowsToDelete.length > 0) {
    const ids = duplicateRowsToDelete.map((d) => d.id);
    await db.delete(disponibilites).where(inArray(disponibilites.id, ids));

    const reservationsToRepair = allReservations
      .filter((r) => r.disponibiliteId && ids.includes(r.disponibiliteId))
      .map((r) => r.id);
    if (reservationsToRepair.length > 0) {
      // Defensive fallback: unlink any reservations still attached to deleted duplicates.
      await db
        .update(reservations)
        .set({ disponibiliteId: null, updatedAt: new Date() })
        .where(inArray(reservations.id, reservationsToRepair));
    }
  }

  const afterDispos = await db.select().from(disponibilites);
  const afterByExactKey = new Map<string, number>();
  for (const d of afterDispos) {
    const start = toIsoDay(d.debut);
    const end = toIsoDay(d.fin);
    if (!start || !end) continue;
    const key = `${start}|${end}|${d.destination}`;
    afterByExactKey.set(key, (afterByExactKey.get(key) || 0) + 1);
  }
  const afterDuplicateRows = Array.from(afterByExactKey.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  console.log("[audit-disponibilites] AFTER");
  console.log(JSON.stringify({
    totalSlots: afterDispos.length,
    exactDuplicateRows: afterDuplicateRows,
    applied: apply,
  }, null, 2));
}

main().catch((error) => {
  console.error("[audit-disponibilites] Echec:", error);
  process.exit(1);
});

