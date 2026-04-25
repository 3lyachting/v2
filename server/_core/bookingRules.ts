import { eq } from "drizzle-orm";
import { disponibilites, reservations } from "../../drizzle/schema";

type BookingDb = any;

export type BookingUsage = {
  totalUnits: number;
  reservedUnits: number;
  hasPrivate: boolean;
  status: "disponible" | "option" | "reserve" | "ferme";
};

const CONFIRMED_WORKFLOW_STATUSES = ["contrat_signe", "acompte_confirme", "solde_confirme"] as const;
const OPTION_WORKFLOW_STATUSES = ["validee_owner", "contrat_envoye"] as const;
const OPTION_HOLD_DAYS = 7;
const BLOCKING_WORKFLOW_STATUSES = [
  ...OPTION_WORKFLOW_STATUSES,
  ...CONFIRMED_WORKFLOW_STATUSES,
] as const;

function toIsoDay(value: any) {
  return new Date(value).toISOString().slice(0, 10);
}

function overlapsIsoDayRange(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && aEnd >= bStart;
}

function getInclusiveReservationIsoRange(r: any) {
  const start = toIsoDay(r.dateDebut);
  const endRaw = toIsoDay(r.dateFin);
  const end = endRaw < start ? start : endRaw;
  return { start, end };
}

function isActiveOptionReservation(r: any) {
  const ws = String(r?.workflowStatut || "");
  const requestValidated = String(r?.requestStatus || "") === "validee";
  if (!OPTION_WORKFLOW_STATUSES.includes(ws as any) && !requestValidated) return false;
  const baseDateRaw = r?.ownerValidatedAt || r?.updatedAt || r?.createdAt;
  if (!baseDateRaw) return false;
  const baseDate = new Date(baseDateRaw);
  if (Number.isNaN(baseDate.getTime())) return false;
  const expiry = new Date(baseDate);
  expiry.setUTCDate(expiry.getUTCDate() + OPTION_HOLD_DAYS);
  return expiry.getTime() > Date.now();
}

export async function resolveDisponibiliteIdForReservation(db: BookingDb, r: any): Promise<number | null> {
  if (r.disponibiliteId) return r.disponibiliteId;
  const rows = await db.select().from(disponibilites);
  const { start: reservationStart, end: reservationEnd } = getInclusiveReservationIsoRange(r);
  let match = rows.find((d: any) => {
    const dStart = toIsoDay(d.debut);
    const dEnd = toIsoDay(d.fin);
    return dStart === reservationStart && dEnd === reservationEnd;
  });
  if (!match) {
    match = rows.find((d: any) => {
      const dStart = toIsoDay(d.debut);
      const dEnd = toIsoDay(d.fin);
      return overlapsIsoDayRange(reservationStart, reservationEnd, dStart, dEnd);
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

  const allReservations = await db
    .select()
    .from(reservations)
    .where(eq(reservations.disponibiliteId, disponibiliteId));

  const confirmedReservations = allReservations.filter((r: any) =>
    CONFIRMED_WORKFLOW_STATUSES.includes(r.workflowStatut as any)
  );
  const activeOptionReservations = allReservations.filter((r: any) => isActiveOptionReservation(r));

  const hasPrivate = confirmedReservations.some((r: any) => r.typeReservation === "bateau_entier");
  const hasPrivateOption = !hasPrivate && activeOptionReservations.some((r: any) => r.typeReservation === "bateau_entier");
  const confirmedUnits = hasPrivate
    ? totalUnits
    : confirmedReservations
        .filter((r: any) => r.typeReservation === "cabine" || r.typeReservation === "place")
        .reduce((sum: number, r: any) => sum + Math.max(1, r.nbCabines || 1), 0);
  const optionUnits = hasPrivateOption
    ? totalUnits
    : activeOptionReservations
        .filter((r: any) => r.typeReservation === "cabine" || r.typeReservation === "place")
        .reduce((sum: number, r: any) => sum + Math.max(1, r.nbCabines || 1), 0);
  const confirmedClamped = Math.max(0, Math.min(totalUnits, confirmedUnits));
  const reservedUnits = hasPrivate ? confirmedUnits : confirmedUnits + optionUnits;
  const clampedReserved = Math.max(0, Math.min(totalUnits, reservedUnits));

  let status: BookingUsage["status"] = "disponible";
  if (hasPrivate || confirmedClamped >= totalUnits) status = "reserve";
  else if (clampedReserved > 0 || hasPrivateOption) status = "option";

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
  const daySlotByIso = new Map<string, any>(
    allDispos
      .filter((d: any) => toIsoDay(d.debut) === toIsoDay(d.fin))
      .map((d: any) => [toIsoDay(d.debut), d])
  );
  const existingDaySlots = new Set(
    allDispos
      .filter((d: any) => toIsoDay(d.debut) === toIsoDay(d.fin))
      .map((d: any) => toIsoDay(d.debut))
  );
  const dayTripPeriods = [
    { start: "2026-04-01", end: "2026-05-31" },
    { start: "2026-09-01", end: "2026-09-30" },
  ];
  for (const period of dayTripPeriods) {
    let cursor = new Date(`${period.start}T00:00:00.000Z`);
    const end = new Date(`${period.end}T00:00:00.000Z`);
    while (cursor <= end) {
      const iso = cursor.toISOString().slice(0, 10);
      if (existingDaySlots.has(iso)) {
        const existing = daySlotByIso.get(iso);
        if (existing?.id) {
          await db
            .update(disponibilites)
            .set({
              destination: "La Ciotat - Cassis (plage de l'Arène) - retour",
              tarifJourPriva: 1000,
              tarifJourPersonne: null,
              tarifCabine: null,
              notePublique: "Journée privative tout inclus (1000€) : voile, kayak, paddle.",
              updatedAt: new Date(),
            })
            .where(eq(disponibilites.id, existing.id));
        }
      } else {
        const inserted = await db
          .insert(disponibilites)
          .values({
            planningType: "charter",
            debut: new Date(cursor),
            fin: new Date(cursor),
            statut: "disponible",
            destination: "La Ciotat - Cassis (plage de l'Arène) - retour",
            tarifJourPriva: 1000,
            tarifJourPersonne: null,
            tarifCabine: null,
            notePublique: "Journée privative tout inclus (1000€) : voile, kayak, paddle.",
            capaciteTotale: 4,
          })
          .returning({ id: disponibilites.id });
        if (inserted[0]?.id) {
          existingDaySlots.add(iso);
          daySlotByIso.set(iso, { id: inserted[0].id });
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const allDisposAfterSeed = await db.select().from(disponibilites);
  const allReservations = await db.select().from(reservations);
  const createdDispoIds: number[] = [];

  for (const r of allReservations) {
    let bestId = await resolveDisponibiliteIdForReservation(db, r);
    const isBlockingByWorkflow = BLOCKING_WORKFLOW_STATUSES.includes(String(r.workflowStatut || "") as any);
    const isBlockingByRequest = String(r?.requestStatus || "") === "validee";
    if (!bestId && (isBlockingByWorkflow || isBlockingByRequest)) {
      // Si une réservation est déjà en phase bloquante (option/confirmée) mais ne matche aucun créneau,
      // on crée un créneau dédié pour que le calendrier client/backoffice reflète bien l'occupation.
      const created = await db
        .insert(disponibilites)
        .values({
          planningType: "charter",
          debut: new Date(r.dateDebut),
          fin: new Date(r.dateFin),
          statut: CONFIRMED_WORKFLOW_STATUSES.includes(String(r.workflowStatut || "") as any) ? "reserve" : "option",
          destination: r.destination || "La Ciotat",
          notePublique: "Créneau créé automatiquement depuis réservation",
          capaciteTotale: 4,
        })
        .returning({ id: disponibilites.id });
      bestId = created[0]?.id || null;
      if (bestId) createdDispoIds.push(bestId);
    }
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

  const idsToRefresh = [...new Set([...allDisposAfterSeed.map((d: any) => d.id), ...createdDispoIds])];
  for (const dispoId of idsToRefresh) {
    if (!dispoId) continue;
    await refreshDisponibiliteBookingState(db, dispoId);
  }
}
