/**
 * Quatre offres proposées sur les créneaux (aligné sur les clés des tarifs saisonniers).
 */
export const CHARTER_PRODUCTS = ["med", "caraibes", "journee", "transat"] as const;

export type CharterProductCode = (typeof CHARTER_PRODUCTS)[number];

export const CHARTER_PRODUCT_LABELS: Record<CharterProductCode, string> = {
  med: "Croisière Méditerranée",
  caraibes: "Croisière Caraïbes",
  journee: "Journée La Ciotat",
  transat: "Transatlantique",
};

export const CHARTER_PRODUCT_LABELS_EN: Record<CharterProductCode, string> = {
  med: "Mediterranean Cruise",
  caraibes: "Caribbean Cruise",
  journee: "Day Trip La Ciotat",
  transat: "Transatlantic",
};

export function charterProductLabel(code: CharterProductCode, isEnglish = false): string {
  return isEnglish ? CHARTER_PRODUCT_LABELS_EN[code] : CHARTER_PRODUCT_LABELS[code];
}

export function isCharterProductCode(value: unknown): value is CharterProductCode {
  return typeof value === "string" && (CHARTER_PRODUCTS as readonly string[]).includes(value);
}
