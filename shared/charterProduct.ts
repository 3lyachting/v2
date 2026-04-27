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

export function isCharterProductCode(value: unknown): value is CharterProductCode {
  return typeof value === "string" && (CHARTER_PRODUCTS as readonly string[]).includes(value);
}
