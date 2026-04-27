/**
 * Haute saison : réservation d’au moins une semaine complète (embarquement samedi 16h,
 * débarquement samedi 9h : donc samedi → samedi en dates calendrier, par blocs d’une ou plusieurs semaines).
 */

export const CHARTER_HIGH_SEASON_MONTHS: ReadonlySet<number> = new Set([2, 7, 8, 12]);

function parseLocalYmd(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Toute la période [start, end] intersecte le mois de février, juillet, août ou décembre. */
export function dayRangeTouchesHighSeason(startIso: string, endIso: string): boolean {
  const a0 = parseLocalYmd(startIso);
  const b0 = parseLocalYmd(endIso);
  if (!a0 || !b0) return false;
  const from = a0.getTime() <= b0.getTime() ? a0 : b0;
  const to = a0.getTime() <= b0.getTime() ? b0 : a0;
  const c = new Date(from);
  while (c.getTime() <= to.getTime()) {
    if (CHARTER_HIGH_SEASON_MONTHS.has(c.getMonth() + 1)) return true;
    c.setDate(c.getDate() + 1);
  }
  return false;
}

/** Samedi = jour civil local (aligné sur le calendrier du site). */
export function isLocalSaturday(iso: string): boolean {
  const d = parseLocalYmd(iso);
  return d != null && d.getDay() === 6;
}

export function dayDiffLocalStartEnd(startIso: string, endIso: string): number {
  const a = parseLocalYmd(startIso);
  const b = parseLocalYmd(endIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Semaine charter entière = départ et fin un samedi, écart d’un multiple de 7 jours (≥7).
 * Ex. 1 semaine: samedi → samedi +7 j; 2 sem.: +14 j, etc.
 */
export function isValidCharterHighSeasonSpan(startIso: string, endIso: string): boolean {
  if (!isLocalSaturday(startIso) || !isLocalSaturday(endIso)) return false;
  const n = dayDiffLocalStartEnd(startIso, endIso);
  if (n < 7) return false;
  return n % 7 === 0;
}

export type CalendarSelectionMode = "single" | "range";

export function getCharterHighSeasonError(
  startIso: string | null,
  endIso: string | null,
  mode: CalendarSelectionMode,
  opts: { isEnglish: boolean }
): string | null {
  if (!startIso) return null;
  if (mode === "range" && !endIso) return null;

  const end = endIso || startIso;
  if (!dayRangeTouchesHighSeason(startIso, end)) return null;

  if (mode === "single") {
    return opts.isEnglish
      ? "July, August, December, and February: please select a full week from Saturday 4:00 p.m. to the following Saturday 9:00 a.m. (use a date range from one Saturday to the next Saturday, or more weeks in full blocks)."
      : "En juillet, août, décembre et février, choisissez une semaine entière : du samedi 16h00 au samedi 9h00. Utilisez la plage de dates, d'un samedi à un samedi (ou plusieurs semaines, par blocs complets).";
  }

  if (mode === "range" && endIso && isValidCharterHighSeasonSpan(startIso, endIso)) return null;

  if (mode === "range" && endIso) {
    return opts.isEnglish
      ? "In these months, select from one Saturday to another, for one or more full week(s) (4:00 p.m. boarding to 9:00 a.m. on the return Saturday)."
      : "Sur cette période, indiquez une plage d’un samedi à un samedi : une semaine (ou plus) en blocs de 7 jours (samedi 16h00 → samedi 9h00).";
  }

  return null;
}

/** Champs type input date: dateFin manquant = règle partielle. */
export function getCharterHighSeasonErrorForForm(
  dateDebut: string,
  dateFin: string,
  isEnglish: boolean
): string | null {
  const a = (dateDebut || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) return null;
  const b = (dateFin || "").trim();
  const hasEnd = /^\d{4}-\d{2}-\d{2}$/.test(b);
  if (!hasEnd) {
    if (dayRangeTouchesHighSeason(a, a)) {
      return isEnglish
        ? "Please set an end date (a Saturday) for a full week in July, August, December, or February."
        : "Renseignez la date de fin (un samedi) pour une semaine complète (juillet, août, décembre ou février).";
    }
    return null;
  }
  if (a === b) {
    return getCharterHighSeasonError(a, b, "single", { isEnglish });
  }
  return getCharterHighSeasonError(a, b, "range", { isEnglish });
}
