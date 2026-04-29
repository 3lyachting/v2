import type { CharterProductCode } from "./charterProduct";

/** Nombre de cabines doubles (unités de stock) pour Med / Caraïbes / Transat. */
export const CHARTER_CRUISE_CABIN_UNITS = 4 as const;

export function isCruiseMultiUnitProduct(p: string | CharterProductCode | undefined | null): boolean {
  return p === "med" || p === "caraibes" || p === "transat";
}

export type OccupancyReservation = {
  typeReservation?: string | null;
  nbCabines?: number | null;
  requestStatus?: string | null;
  workflowStatut?: string | null;
};

export function computeReservedUnits(params: {
  typeReservation?: string | null;
  nbPersonnes?: number | null;
  nbCabines?: number | null;
}): number {
  const type = String(params.typeReservation || "");
  const persons = Math.max(1, Number(params.nbPersonnes) || 1);
  const cabins = Math.max(1, Number(params.nbCabines) || 1);
  if (type === "bateau_entier") return CHARTER_CRUISE_CABIN_UNITS;
  if (type === "place") return persons;
  if (type === "cabine") return Math.max(1, Math.ceil(persons / 2));
  return cabins;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function toYmd(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const s = value.slice(0, 10);
    return YMD.test(s) ? s : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Chevauchement sur logique "séjour" : dateFin est traitée comme exclusive
 * (sauf créneau d'une seule journée, qui occupe bien 1 jour).
 */
export function rangesOverlapForStay(
  startA: unknown,
  endA: unknown,
  startB: unknown,
  endB: unknown
): boolean {
  const aStart = toYmd(startA);
  const aEnd = toYmd(endA);
  const bStart = toYmd(startB);
  const bEnd = toYmd(endB);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;

  const aEndExclusive = aStart === aEnd ? addOneDay(aEnd) : aEnd;
  const bEndExclusive = bStart === bEnd ? addOneDay(bEnd) : bEnd;
  return aStart < bEndExclusive && aEndExclusive > bStart;
}

/** Aligné sur le calendrier public (blocked-days) : toute résa non refusée/archivée compte. */
export function isReservationBlockingForCharterCalendar(r: OccupancyReservation): boolean {
  const req = String(r.requestStatus || "");
  const wf = String(r.workflowStatut || "");
  if (req === "refusee" || req === "archivee") return false;
  const isBlockingByRequest = req !== "refusee" && req !== "archivee";
  const isBlockingByWorkflow = [
    "validee_owner",
    "devis_accepte",
    "contrat_envoye",
    "contrat_signe",
    "acompte_confirme",
    "solde_confirme",
  ].includes(wf);
  return isBlockingByRequest || isBlockingByWorkflow;
}

/** Agrège l'occupation cabines / privatif sur une même période charter. */
export function aggregateCruiseCabineOccupancy(rows: OccupancyReservation[]): { hasPrivate: boolean; reservedUnits: number } {
  const blocking = rows.filter(isReservationBlockingForCharterCalendar);
  let hasPrivate = false;
  let reservedUnits = 0;
  for (const r of blocking) {
    const t = String(r.typeReservation || "");
    if (t === "bateau_entier") {
      return { hasPrivate: true, reservedUnits: CHARTER_CRUISE_CABIN_UNITS };
    }
    if (t === "cabine" || t === "place") {
      reservedUnits += Math.max(1, Number(r.nbCabines) || 1);
    }
  }
  return { hasPrivate, reservedUnits };
}
