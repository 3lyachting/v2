export type ReservationPolicyResult =
  | { ok: true; policy: "weekly_saturday" | "april_may_flexible" }
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

export function validateReservationPolicy(input: {
  dateDebut: string | Date;
  dateFin: string | Date;
  destination?: string | null;
  now?: Date;
}): ReservationPolicyResult {
  const startIso = toIsoDay(input.dateDebut);
  const endIsoRaw = toIsoDay(input.dateFin);
  if (!startIso || !endIsoRaw) return { ok: false, reason: "Dates invalides." };
  const endIso = endIsoRaw < startIso ? startIso : endIsoRaw;
  const startYear = Number(startIso.slice(0, 4));

  const aprilMayStart = `${startYear}-04-01`;
  const aprilMayEnd = `${startYear}-05-31`;
  if (isInsideWindow(startIso, endIso, aprilMayStart, aprilMayEnd)) {
    return { ok: true, policy: "april_may_flexible" };
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
