/**
 * Offres proposées sur les créneaux (aligné sur les clés des tarifs saisonniers).
 */
export const CHARTER_PRODUCTS = ["med", "caraibes", "journee", "journee_guadeloupe", "soiree", "transat"] as const;

export type CharterProductCode = (typeof CHARTER_PRODUCTS)[number];

export const CHARTER_PRODUCT_LABELS: Record<CharterProductCode, string> = {
  med: "Croisière Méditerranée",
  caraibes: "Croisière Caraïbes",
  journee: "Journée La Ciotat",
  journee_guadeloupe: "Journée Guadeloupe",
  soiree: "Soirée coucher de soleil La Ciotat",
  transat: "Transatlantique",
};

export const CHARTER_PRODUCT_LABELS_EN: Record<CharterProductCode, string> = {
  med: "Mediterranean Cruise",
  caraibes: "Caribbean Cruise",
  journee: "Day Trip La Ciotat",
  journee_guadeloupe: "Guadeloupe Day Trip",
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
  if (product === "journee_guadeloupe") return "journee_guadeloupe";
  if (product === "soiree") return "soiree_coucher_soleil";
  return "semaine";
}

export function isSingleDayPrivateProduct(
  product: string | CharterProductCode | null | undefined
): boolean {
  return product === "journee" || product === "journee_guadeloupe" || product === "soiree";
}

export const GUADELOUPE_DEPARTURE_PORTS = [
  { value: "gosier", label: "Le Gosier" },
  { value: "sainte_anne", label: "Sainte-Anne" },
  { value: "deshaies", label: "Deshaies" },
] as const;

export type GuadeloupeDeparturePort = (typeof GUADELOUPE_DEPARTURE_PORTS)[number]["value"];

export const GUADELOUPE_DAY_PUBLIC_NOTE =
  "Voile, baignade, Marie-Galante, Les Saintes, EVJF, soirées. Départ au choix : Le Gosier, Sainte-Anne ou Deshaies.";

export function isGuadeloupeDeparturePort(value: unknown): value is GuadeloupeDeparturePort {
  return GUADELOUPE_DEPARTURE_PORTS.some((port) => port.value === value);
}

export function guadeloupeDepartureLabel(value: string | null | undefined): string {
  return GUADELOUPE_DEPARTURE_PORTS.find((port) => port.value === value)?.label || "";
}

export function charterProductDestination(
  product: CharterProductCode,
  departurePort?: string | null
): string {
  const label = CHARTER_PRODUCT_LABELS[product];
  if (product !== "journee_guadeloupe") return label;
  const port = guadeloupeDepartureLabel(departurePort);
  return port ? `${label} — ${port}` : label;
}

export const CHARTER_PRODUCT_DEFAULT_HOURS: Record<
  "journee" | "journee_guadeloupe" | "soiree",
  { embark: string; disembark: string }
> = {
  journee: { embark: "10:00", disembark: "16:00" },
  journee_guadeloupe: { embark: "10:00", disembark: "16:00" },
  soiree: { embark: "18:30", disembark: "22:00" },
};
