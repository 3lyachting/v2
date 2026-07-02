export type CharterPeriodLike = {
  id: number;
  startIso: string;
  endIso: string;
  publicNote?: string | null;
};

/** Retrouve la période charter couvrant une sélection (exacte ou incluse, ex. transat). */
export function findCharterPeriodForRange(
  periods: CharterPeriodLike[],
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): CharterPeriodLike | null {
  if (!startIso || !periods.length) return null;
  const end = endIso || startIso;
  const exact = periods.find((slot) => slot.startIso === startIso && slot.endIso === end);
  if (exact) return exact;
  const covering = periods.find((slot) => startIso >= slot.startIso && end <= slot.endIso);
  if (covering) return covering;
  return periods.find((slot) => startIso >= slot.startIso && startIso <= slot.endIso) || null;
}
