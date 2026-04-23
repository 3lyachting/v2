import { and, eq, inArray } from "drizzle-orm";
import { disponibilites, reservations } from "../../drizzle/schema";

type BookingDb = any;

export type BookingUsage = {
  totalUnits: number;
  reservedUnits: number;
  hasPrivate: boolean;
  status: "disponible" | "option" | "reserve" | "ferme";
};

const CONFIRMED_WORKFLOW_STATUSES = ["contrat_signe", "acompte_confirme", "solde_confirme"] as const;

export async function resolveDisponibiliteIdForReservation(db: BookingDb, r: any): Promise<number | null> {
  if (r.disponibiliteId) return r.disponibiliteId;
  const rows = await db.select().from(disponibilites);
  const reservationStart = new Date(r.dateDebut).toISOString().slice(0, 10);
  const reservationEnd = new Date(r.dateFin).toISOString().slice(0, 10);
  let match = rows.find((d: any) => {
    const dStart = new Date(d.debut).toISOString().slice(0, 10);
    const dEnd = new Date(d.fin).toISOString().slice(0, 10);
    return dStart === reservationStart && dEnd === reservationEnd;
  });
  if (!match) {
    const rStartMs = new Date(r.dateDebut).getTime();
    const rEndMs = new Date(r.dateFin).getTime();
    match = rows.find((d: any) => {
      const dStartMs = new Date(d.debut).getTime();
      const dEndMs = new Date(d.fin).getTime();
      return rStartMs < dEndMs && rEndMs > dStartMs;
    });
  }
  return match?.id || null;
}

export async function getConfirmedBookingUsage(db: BookingDb, disponibiliteId: number): Promise<BookingUsage> {
  const dispoRows = await db
    .select()
    .from(disponibilites)
    .where(eq(disponibilites.id, disponibiliteId))
    .limit(1);
  const dispo = dispoRows[0];
  const totalUnits = dispo?.capaciteTotale || 4;
  if (!dispo) {
    return { totalUnits, reservedUnits: 0, hasPrivate: false, status: "disponible" };
  }
  if (dispo.planningType && dispo.planningType !== "charter") {
    return { totalUnits, reservedUnits: 0, hasPrivate: false, status: "ferme" };
  }

  const confirmedReservations = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.disponibiliteId, disponibiliteId),
        inArray(reservations.workflowStatut, [...CONFIRMED_WORKFLOW_STATUSES] as any)
      )
    );

  const hasPrivate = confirmedReservations.some((r: any) => r.typeReservation === "bateau_entier");
  const reservedUnits = hasPrivate
    ? totalUnits
    : confirmedReservations
        .filter((r: any) => r.typeReservation === "cabine" || r.typeReservation === "place")
        .reduce((sum: number, r: any) => sum + Math.max(1, r.nbCabines || 1), 0);
  const clampedReserved = Math.max(0, Math.min(totalUnits, reservedUnits));

  let status: BookingUsage["status"] = "disponible";
  if (hasPrivate || clampedReserved >= totalUnits) status = "reserve";
  else if (clampedReserved > 0) status = "option";

  return {
    totalUnits,
    reservedUnits: clampedReserved,
    hasPrivate,
    status,
  };
}

export async function refreshDisponibiliteBookingState(db: BookingDb, disponibiliteId: number) {
  const usage = await getConfirmedBookingUsage(db, disponibiliteId);
  await db
    .update(disponibilites)
    .set({
      statut: usage.status,
      cabinesReservees: usage.status === "ferme" ? 0 : usage.reservedUnits,
      updatedAt: new Date(),
    })
    .where(eq(disponibilites.id, disponibiliteId));
}

export async function syncDisponibilitesFromReservations(db: BookingDb) {
  const allDispos = await db.select().from(disponibilites);
  const allReservations = await db.select().from(reservations);

  for (const r of allReservations) {
    const bestId = await resolveDisponibiliteIdForReservation(db, r);
    if (bestId && r.disponibiliteId !== bestId) {
      await db
        .update(reservations)
        .set({
          disponibiliteId: bestId,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, r.id));
    }
  }

  for (const dispo of allDispos) {
    await refreshDisponibiliteBookingState(db, dispo.id);
  }
}
