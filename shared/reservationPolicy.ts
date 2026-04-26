import { inferSlotType, isTransatType } from "./slotRules";

export type ReservationPolicyResult =
  | { ok: true; policy: "weekly_saturday" | "april_may_private_daytrip" | "summer_weekly_private_or_cabine" | "transat_window" }
  | { ok: false; reason: string };

function toIsoDay(value: string | Date) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function dayOfWeekIso(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

function inIsoRange(iso: string, start: string, end: string) {
  return iso >= start && iso <= end;
}

function isInsideWindow(startIso: string, endIso: string, windowStart: string, windowEnd: string) {
  return startIso >= windowStart && endIso <= windowEnd;
}

function diffDays(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T00:00:00.000Z`).getTime();
  const end = new Date(`${endIso}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 86400000);
}

function isLaCiotatDestination(destination?: string | null) {
  if (!destination) return true;
  return destination.toLowerCase().includes("ciotat");
}

function isTransatDestination(destination?: string | null) {
  return String(destination || "").toLowerCase().includes("transat");
}

export function validateReservationPolicy(input: {
  dateDebut: string | Date;
  dateFin: string | Date;
  destination?: string | null;
  typeReservation?: "bateau_entier" | "cabine" | "place" | null;
  nbCabines?: number | null;
  now?: Date;
}): ReservationPolicyResult {
  const startIso = toIsoDay(input.dateDebut);
  const endIsoRaw = toIsoDay(input.dateFin);
  if (!startIso || !endIsoRaw) return { ok: false, reason: "Dates invalides." };
  const endIso = endIsoRaw < startIso ? startIso : endIsoRaw;
  const startYear = Number(startIso.slice(0, 4));
  const transatReturnStart = `${startYear}-04-05`;
  const transatReturnEnd = `${startYear}-05-15`;
  const transatOutboundStart = `${startYear}-11-05`;
  const transatOutboundEnd = `${startYear}-12-05`;
  const inferredSlotType = inferSlotType({
    debut: `${startIso}T00:00:00.000Z`,
    fin: `${endIso}T00:00:00.000Z`,
    destination: input.destination || "",
  });
  const insideTransatWindow =
    isInsideWindow(startIso, endIso, transatReturnStart, transatReturnEnd) ||
    isInsideWindow(startIso, endIso, transatOutboundStart, transatOutboundEnd);

  if (isTransatDestination(input.destination) && !insideTransatWindow) {
    return { ok: false, reason: "Les transats sont autorisées uniquement du 05/04 au 15/05 et du 05/11 au 05/12." };
  }
  if (isTransatType(inferredSlotType) && insideTransatWindow) {
    return { ok: true, policy: "transat_window" };
  }

  const aprilMayStart = `${startYear}-04-01`;
  const aprilMayEnd = `${startYear}-05-31`;
  if (isInsideWindow(startIso, endIso, aprilMayStart, aprilMayEnd)) {
    if (startIso !== endIso) {
      return { ok: false, reason: "En avril/mai, seule la réservation privative à la journée est autorisée." };
    }
    if (input.typeReservation && input.typeReservation !== "bateau_entier") {
      return { ok: false, reason: "En avril/mai, la réservation est uniquement en mode privatif." };
    }
    if (!isLaCiotatDestination(input.destination)) {
      return { ok: false, reason: "En avril/mai, le départ est uniquement à La Ciotat." };
    }
    return { ok: true, policy: "april_may_private_daytrip" };
  }

  const summerStart = `${startYear}-06-01`;
  const summerEnd = `${startYear}-08-31`;
  if (isInsideWindow(startIso, endIso, summerStart, summerEnd)) {
    const startSaturday = dayOfWeekIso(startIso) === 6;
    const endSaturday = dayOfWeekIso(endIso) === 6;
    const weeklySpan = diffDays(startIso, endIso) === 7;
    if (!startSaturday || !endSaturday || !weeklySpan) {
      return { ok: false, reason: "En juin/juillet/août, les réservations sont obligatoirement du samedi au samedi." };
    }
    if (input.typeReservation && input.typeReservation !== "bateau_entier" && input.typeReservation !== "cabine") {
      return { ok: false, reason: "En juin/juillet/août, seuls les modes cabine et privatif sont autorisés." };
    }
    if (input.typeReservation === "cabine" && input.nbCabines !== undefined && input.nbCabines !== null) {
      if (!Number.isInteger(input.nbCabines) || input.nbCabines < 1 || input.nbCabines > 4) {
        return { ok: false, reason: "En mode cabine été, le nombre de cabines doit être compris entre 1 et 4." };
      }
    }
    return { ok: true, policy: "summer_weekly_private_or_cabine" };
  }

  const startSaturday = dayOfWeekIso(startIso) === 6;
  const endSaturday = dayOfWeekIso(endIso) === 6;
  if (!startSaturday || !endSaturday) {
    return { ok: false, reason: "En dehors des exceptions, les réservations sont obligatoirement du samedi au samedi." };
  }
  return { ok: true, policy: "weekly_saturday" };
}

export function isSaturdayOnlyDay(isoDay: string, destination?: string | null, now?: Date) {
  const year = Number(isoDay.slice(0, 4));
  if (inIsoRange(isoDay, `${year}-04-01`, `${year}-05-31`)) return false;
  return true;
}
