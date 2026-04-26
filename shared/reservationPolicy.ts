export type ReservationPolicyResult =
  | { ok: true; policy: "weekly_saturday" | "may_june_flexible" | "transat_outbound" | "transat_return" }
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

function includesAny(text: string, needles: string[]) {
  const source = text.toLowerCase();
  return needles.some((needle) => source.includes(needle));
}

function isTransatOutboundRoute(destination: string) {
  return includesAny(destination, ["la ciotat", "pointe", "canaries", "cap-vert"]);
}

function isTransatReturnRoute(destination: string) {
  const source = destination.toLowerCase();
  const hasTransat = source.includes("transat");
  const hasReturnHint = source.includes("retour") || source.includes("pointe") || source.includes("cara");
  return hasTransat && hasReturnHint;
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
  const destination = String(input.destination || "");

  const startYear = Number(startIso.slice(0, 4));
  const nowYear = (input.now || new Date()).getUTCFullYear();

  const returnStart = `${startYear}-04-05`;
  const returnEnd = `${startYear}-05-15`;
  const isInReturnWindow = isInsideWindow(startIso, endIso, returnStart, returnEnd);
  if (isTransatReturnRoute(destination) && isInReturnWindow) {
    if (startYear === nowYear) {
      return { ok: false, reason: "La transat retour n'est pas ouverte sur l'année courante." };
    }
    return { ok: true, policy: "transat_return" };
  }

  const mayJuneStart = `${startYear}-05-01`;
  const mayJuneEnd = `${startYear}-06-30`;
  if (isInsideWindow(startIso, endIso, mayJuneStart, mayJuneEnd)) {
    return { ok: true, policy: "may_june_flexible" };
  }

  const outboundStart = `${startYear}-04-05`;
  const outboundEnd = `${startYear}-12-15`;
  if (isTransatOutboundRoute(destination) && isInsideWindow(startIso, endIso, outboundStart, outboundEnd)) {
    return { ok: true, policy: "transat_outbound" };
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
  if (inIsoRange(isoDay, `${year}-05-01`, `${year}-06-30`)) return false;
  if (String(destination || "").length > 0) {
    if (isTransatOutboundRoute(String(destination)) && inIsoRange(isoDay, `${year}-04-05`, `${year}-12-15`)) return false;
    if (year !== (now || new Date()).getUTCFullYear() && isTransatReturnRoute(String(destination)) && inIsoRange(isoDay, `${year}-04-05`, `${year}-05-15`)) return false;
  }
  return true;
}
