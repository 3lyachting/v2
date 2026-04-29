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
