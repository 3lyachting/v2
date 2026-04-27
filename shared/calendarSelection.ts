export type DisponibiliteLike = {
  debut: string | Date;
  fin: string | Date;
  statut: "disponible" | "reserve" | "option" | "ferme";
  destination: string;
  note?: string | null;
  planningType?: "charter" | "technical_stop" | "maintenance" | "blocked";
};

export type ProductType = "med" | "transat" | "caraibes" | "journee";
import { inferSlotType, isTransatType, slotTypePriority } from "./slotRules";

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
  const slotType = inferSlotType(dispo);
  if (isTransatType(slotType)) return "transat";
  if (slotType === "day_private") return "journee";
  if (slotType === "caribbean_week") return "caraibes";
  return "med";
}

function isInvalidTransatOutsideWindow(dispo: Pick<DisponibiliteLike, "destination" | "debut" | "fin">) {
  const destination = String(dispo.destination || "").toLowerCase();
  if (!destination.includes("transat")) return false;
  return !isTransatType(inferSlotType(dispo));
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
    status === "reserve" ? 0 : status === "option" ? 1 : status === "ferme" ? 2 : 3;

  const sorted = rows
    .slice()
    .sort((a, b) => {
      const aStatus = statusRank(a.statut);
      const bStatus = statusRank(b.statut);
      if (aStatus !== bStatus) return aStatus - bStatus;

      const aProduct = getProductFromDisponibilite(a);
      const bProduct = getProductFromDisponibilite(b);
      const aInvalidTransat = isInvalidTransatOutsideWindow(a) ? 1 : 0;
      const bInvalidTransat = isInvalidTransatOutsideWindow(b) ? 1 : 0;
      if (aInvalidTransat !== bInvalidTransat) return aInvalidTransat - bInvalidTransat;
      const aTypePriority = slotTypePriority(inferSlotType(a), month);
      const bTypePriority = slotTypePriority(inferSlotType(b), month);
      if (aTypePriority !== bTypePriority) return aTypePriority - bTypePriority;
      if (inAprilMay) {
        const aIsWrongTransat = aProduct === "transat" ? 1 : 0;
        const bIsWrongTransat = bProduct === "transat" ? 1 : 0;
        if (aIsWrongTransat !== bIsWrongTransat) return aIsWrongTransat - bIsWrongTransat;
      }
      if (month >= 6 && month <= 8) {
        const aWeekly = getDurationDays(a) === 8 ? 0 : 1;
        const bWeekly = getDurationDays(b) === 8 ? 0 : 1;
        if (aWeekly !== bWeekly) return aWeekly - bWeekly;
      }

      const aDuration = getDurationDays(a);
      const bDuration = getDurationDays(b);
      if (aDuration !== bDuration) return aDuration - bDuration;

      const aStartsToday = toIsoDayUtc(a.debut) === isoDay ? 0 : 1;
      const bStartsToday = toIsoDayUtc(b.debut) === isoDay ? 0 : 1;
      if (aStartsToday !== bStartsToday) return aStartsToday - bStartsToday;

      const aBookable = isBookableDisponibilite(a) ? 0 : 1;
      const bBookable = isBookableDisponibilite(b) ? 0 : 1;
      if (aBookable !== bBookable) return aBookable - bBookable;

      return String(a.destination).localeCompare(String(b.destination), "fr");
    });

  return sorted[0] || null;
}
