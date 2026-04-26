export type DisponibiliteLike = {
  debut: string | Date;
  fin: string | Date;
  statut: "disponible" | "reserve" | "option" | "ferme";
  destination: string;
  planningType?: "charter" | "technical_stop" | "maintenance" | "blocked";
};

export type ProductType = "med" | "transat" | "caraibes" | "journee";

export function toIsoDayUtc(input: string | Date | null | undefined) {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseIsoDayUtc(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function getProductFromDisponibilite(dispo: Pick<DisponibiliteLike, "destination" | "debut" | "fin">): ProductType {
  const destination = String(dispo.destination || "").toLowerCase();
  const start = toIsoDayUtc(dispo.debut);
  const end = toIsoDayUtc(dispo.fin);
  const isDay = Boolean(start && end && start === end);
  if (isDay && destination.includes("la ciotat")) return "journee";
  if (destination.includes("transat")) return "transat";
  if (destination.includes("cara")) return "caraibes";
  return "med";
}

export function isBookableDisponibilite(dispo?: DisponibiliteLike | null) {
  if (!dispo) return false;
  if (dispo.planningType && dispo.planningType !== "charter") return false;
  return dispo.statut === "disponible" || dispo.statut === "option";
}

function getDurationDays(dispo: Pick<DisponibiliteLike, "debut" | "fin">) {
  const start = toIsoDayUtc(dispo.debut);
  const end = toIsoDayUtc(dispo.fin);
  if (!start || !end) return Number.POSITIVE_INFINITY;
  const startDate = parseIsoDayUtc(start);
  const endDate = parseIsoDayUtc(end);
  if (!startDate || !endDate) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
}

export function chooseBestDisponibiliteForDay<T extends DisponibiliteLike>(rows: T[], isoDay: string): T | null {
  if (!rows.length) return null;
  const month = Number(isoDay.slice(5, 7));
  const inAprilMay = month === 4 || month === 5;
  const statusRank = (status: T["statut"]) =>
    status === "disponible" ? 0 : status === "option" ? 1 : status === "reserve" ? 2 : 3;

  const sorted = rows
    .slice()
    .sort((a, b) => {
      const aBookable = isBookableDisponibilite(a) ? 0 : 1;
      const bBookable = isBookableDisponibilite(b) ? 0 : 1;
      if (aBookable !== bBookable) return aBookable - bBookable;

      const aProduct = getProductFromDisponibilite(a);
      const bProduct = getProductFromDisponibilite(b);
      if (inAprilMay) {
        const aIsWrongTransat = aProduct === "transat" ? 1 : 0;
        const bIsWrongTransat = bProduct === "transat" ? 1 : 0;
        if (aIsWrongTransat !== bIsWrongTransat) return aIsWrongTransat - bIsWrongTransat;
      }

      const aDuration = getDurationDays(a);
      const bDuration = getDurationDays(b);
      if (aDuration !== bDuration) return aDuration - bDuration;

      const aStartsToday = toIsoDayUtc(a.debut) === isoDay ? 0 : 1;
      const bStartsToday = toIsoDayUtc(b.debut) === isoDay ? 0 : 1;
      if (aStartsToday !== bStartsToday) return aStartsToday - bStartsToday;

      const aStatus = statusRank(a.statut);
      const bStatus = statusRank(b.statut);
      if (aStatus !== bStatus) return aStatus - bStatus;

      return String(a.destination).localeCompare(String(b.destination), "fr");
    });

  return sorted[0] || null;
}
