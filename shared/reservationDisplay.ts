import { CHARTER_PRODUCT_DEFAULT_HOURS } from "./charterProduct";

export type ReservationCharterKind = "journee" | "soiree" | "semaine" | "transat" | "other";

function toIsoDay(value?: string | null) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function formatFrDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("fr-FR");
}

export function getReservationCharterKind(r: {
  formule?: string | null;
  destination?: string | null;
  dateDebut?: string | null;
  dateFin?: string | null;
}): ReservationCharterKind {
  const formule = String(r.formule || "").toLowerCase();
  const destination = String(r.destination || "").toLowerCase();
  if (
    formule.includes("soiree") ||
    formule.includes("soirée") ||
    destination.includes("soiree") ||
    destination.includes("soirée") ||
    destination.includes("coucher") ||
    destination.includes("sunset")
  ) {
    return "soiree";
  }
  if (formule.includes("transat") || formule.includes("traversee") || destination.includes("transat")) {
    return "transat";
  }
  const start = toIsoDay(r.dateDebut);
  const end = toIsoDay(r.dateFin);
  if (
    formule.includes("journee") ||
    formule.includes("journ") ||
    destination.includes("journee") ||
    (start && end && start === end)
  ) {
    return "journee";
  }
  if (
    formule.includes("semaine") ||
    formule.includes("weekend") ||
    formule.includes("croisiere") ||
    formule.includes("méditerranée") ||
    formule.includes("caraibes") ||
    formule.includes("caraïbes")
  ) {
    return "semaine";
  }
  return "other";
}

export function isShortCharterKind(kind: ReservationCharterKind) {
  return kind === "journee" || kind === "soiree";
}

export function extractTimeFromIso(isoLike: string | null | undefined, fallback: string): string {
  const raw = String(isoLike || "");
  const match = raw.match(/T(\d{2}):(\d{2})/i);
  if (!match) return fallback;
  if (match[1] === "00" && match[2] === "00") return fallback;
  return `${match[1]}:${match[2]}`;
}

export function formatTimeFr(hhmm: string) {
  return hhmm.replace(":", "h");
}

export function reservationScheduleLines(r: {
  dateDebut: string;
  dateFin: string;
  formule?: string | null;
  destination?: string | null;
}): { dateLine: string; hoursLine: string | null; kind: ReservationCharterKind } {
  const kind = getReservationCharterKind(r);
  const startIso = toIsoDay(r.dateDebut);
  const endIso = toIsoDay(r.dateFin);

  const dateLine =
    kind === "journee" || kind === "soiree"
      ? formatFrDate(startIso || String(r.dateDebut).slice(0, 10))
      : `${formatFrDate(startIso || String(r.dateDebut).slice(0, 10))} → ${formatFrDate(endIso || String(r.dateFin).slice(0, 10))}`;

  let hoursLine: string | null = null;
  if (kind === "journee" || kind === "soiree") {
    const defaults = CHARTER_PRODUCT_DEFAULT_HOURS[kind];
    const embark = formatTimeFr(extractTimeFromIso(r.dateDebut, defaults.embark));
    const disembark = formatTimeFr(extractTimeFromIso(r.dateFin, defaults.disembark));
    hoursLine = `${embark} – ${disembark}`;
  } else {
    const embark = extractTimeFromIso(r.dateDebut, "15:00");
    const disembark = extractTimeFromIso(r.dateFin, "10:00");
    hoursLine = `Emb. ${formatTimeFr(embark)} · Déb. ${formatTimeFr(disembark)}`;
  }

  return { dateLine, hoursLine, kind };
}

export const RESERVATION_KIND_STYLES: Record<
  ReservationCharterKind,
  { row: string; badge: string; label: string }
> = {
  journee: {
    row: "bg-amber-50/90 border-l-4 border-amber-400",
    badge: "bg-amber-100 text-amber-950 border border-amber-300",
    label: "Journée",
  },
  soiree: {
    row: "bg-violet-50/90 border-l-4 border-violet-500",
    badge: "bg-violet-100 text-violet-950 border border-violet-300",
    label: "Soirée",
  },
  semaine: {
    row: "bg-sky-50/40 border-l-4 border-sky-300",
    badge: "bg-sky-100 text-sky-950 border border-sky-200",
    label: "Semaine",
  },
  transat: {
    row: "bg-slate-50/90 border-l-4 border-slate-400",
    badge: "bg-slate-100 text-slate-800 border border-slate-300",
    label: "Transat",
  },
  other: {
    row: "",
    badge: "bg-slate-50 text-slate-700 border border-slate-200",
    label: "Autre",
  },
};
