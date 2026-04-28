export type SeasonPricingProduct = "med" | "caraibes" | "journee" | "transat";

export type ProductSeasonPricing = {
  highSeasonPerPassenger: number | null;
  lowSeasonPerPassenger: number | null;
};

export type SeasonPricingConfig = Record<SeasonPricingProduct, ProductSeasonPricing>;

export const DEFAULT_SEASON_PRICING: SeasonPricingConfig = {
  med: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
  caraibes: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
  journee: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
  transat: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
};

function toNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

export function normalizeSeasonPricing(input: unknown): SeasonPricingConfig {
  const source = (input && typeof input === "object" ? (input as Record<string, any>) : {}) || {};
  const next: SeasonPricingConfig = { ...DEFAULT_SEASON_PRICING };
  (Object.keys(DEFAULT_SEASON_PRICING) as SeasonPricingProduct[]).forEach((product) => {
    const row = (source[product] && typeof source[product] === "object" ? source[product] : {}) as Record<string, any>;
    next[product] = {
      highSeasonPerPassenger: toNonNegativeNumber(row.highSeasonPerPassenger),
      lowSeasonPerPassenger: toNonNegativeNumber(row.lowSeasonPerPassenger),
    };
  });
  return next;
}

export function isHighSeasonDate(dateInput: string | Date) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return false;
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  if (month === 7 || month === 8) return true;
  if (month === 12 && day >= 15) return true;
  if (month === 1 && day <= 8) return true;
  if (month === 2) return true;
  return false;
}

export function getSeasonPriceForDate(
  pricing: SeasonPricingConfig,
  product: SeasonPricingProduct,
  dateInput: string | Date
): number | null {
  const row = pricing[product] || DEFAULT_SEASON_PRICING[product];
  const highSeason = isHighSeasonDate(dateInput);
  return highSeason ? row.highSeasonPerPassenger : row.lowSeasonPerPassenger;
}

export const TRANSAT_PER_PERSON_EUR = 3000;

/** Période samedi → samedi: nombre de “semaine(s)” d’enchaînement (0 si même jour). */
export function calendarDaySpan(startIso: string, endIso: string): number {
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Indicatif total “par personne / place” (aligné CalendrierDisponibilites) pour l’MVP.
 * Transat: 3000€/p sauf surchargé plus tard. Sinon tarif saison, × nb de périodes de 7j si le séjour est en blocs entiers.
 */
export function estimateMvpIndicativeTotalEur(
  pricing: SeasonPricingConfig,
  product: SeasonPricingProduct,
  startIso: string,
  endIso: string
): { total: number | null; unitEur: number | null; weekBlocks: number; label: "per_person" } {
  if (product === "transat") {
    // Prix par personne / traversée (même principe que le calendrier dispo, une traversée = un montant forfaitaire)
    return {
      total: TRANSAT_PER_PERSON_EUR,
      unitEur: TRANSAT_PER_PERSON_EUR,
      weekBlocks: 1,
      label: "per_person",
    };
  }
  const unit = getSeasonPriceForDate(pricing, product, startIso);
  if (unit == null) {
    return { total: null, unitEur: null, weekBlocks: 1, label: "per_person" };
  }
  const span = calendarDaySpan(startIso, endIso);
  const weekBlocks = span === 0 ? 1 : span % 7 === 0 ? Math.max(1, span / 7) : 1;
  return { total: Math.round(unit * weekBlocks), unitEur: unit, weekBlocks, label: "per_person" };
}
