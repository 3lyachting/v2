/**
 * Cinq offres proposées sur les créneaux (aligné sur les clés des tarifs saisonniers).
 */
export const CHARTER_PRODUCTS = ["med", "caraibes", "journee", "soiree", "transat"] as const;

export type CharterProductCode = (typeof CHARTER_PRODUCTS)[number];

export const CHARTER_PRODUCT_LABELS: Record<CharterProductCode, string> = {
  med: "Croisière Méditerranée",
  caraibes: "Croisière Caraïbes",
  journee: "Journée La Ciotat",
  soiree: "Soirée coucher de soleil La Ciotat",
  transat: "Transatlantique",
};

export const CHARTER_PRODUCT_LABELS_EN: Record<CharterProductCode, string> = {
  med: "Mediterranean Cruise",
  caraibes: "Caribbean Cruise",
  journee: "Day Trip La Ciotat",
  soiree: "Sunset Evening La Ciotat",
  transat: "Transatlantic",
};

export function charterProductLabel(code: CharterProductCode, isEnglish = false): string {
  return isEnglish ? CHARTER_PRODUCT_LABELS_EN[code] : CHARTER_PRODUCT_LABELS[code];
}

export function isCharterProductCode(value: unknown): value is CharterProductCode {
  return typeof value === "string" && (CHARTER_PRODUCTS as readonly string[]).includes(value);
}

export function charterProductFormule(product: CharterProductCode): string {
  if (product === "journee") return "journee_privee";
  if (product === "soiree") return "soiree_coucher_soleil";
  return "semaine";
}

export function isSingleDayPrivateProduct(
  product: string | CharterProductCode | null | undefined
): boolean {
  return product === "journee" || product === "soiree";
}

export const CHARTER_PRODUCT_DEFAULT_HOURS: Record<
  "journee" | "soiree",
  { embark: string; disembark: string }
> = {
  journee: { embark: "10:00", disembark: "16:00" },
  soiree: { embark: "18:30", disembark: "22:00" },
};
