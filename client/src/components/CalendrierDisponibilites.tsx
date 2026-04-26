import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";

type Statut = "disponible" | "reserve" | "option" | "ferme";
type Produit = "all" | "med" | "transat" | "caraibes" | "journee";
type ReservationMode = "priva" | "cabine";

type Disponibilite = {
  id: number;
  debut: string;
  fin: string;
  statut: Statut;
  planningType?: "charter" | "technical_stop" | "maintenance" | "blocked";
  tarif: number | null;
  tarifCabine?: number | null;
  tarifJourPersonne?: number | null;
  tarifJourPriva?: number | null;
  destination: string;
  notePublique?: string | null;
  capaciteTotale?: number;
  cabinesReservees?: number;
};

const BRAND_DEEP = "#00384A";

function toIsoDay(input: string | Date) {
  return new Date(input).toISOString().slice(0, 10);
}

function parseIsoDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function getProduct(dispo: Disponibilite): Produit {
  const destination = String(dispo.destination || "").toLowerCase();
  const isDay = toIsoDay(dispo.debut) === toIsoDay(dispo.fin);
  if (isDay && destination.includes("la ciotat")) return "journee";
  if (destination.includes("transat")) return "transat";
  if (destination.includes("cara")) return "caraibes";
  return "med";
}

function isBookable(dispo?: Disponibilite | null) {
  if (!dispo) return false;
  if (dispo.planningType && dispo.planningType !== "charter") return false;
  return dispo.statut === "disponible" || dispo.statut === "option";
}

function getTotalUnits(dispo?: Disponibilite | null) {
  if (!dispo?.capaciteTotale) return 0;
  return dispo.capaciteTotale;
}

function getReservedUnits(dispo?: Disponibilite | null) {
  return Math.max(0, dispo?.cabinesReservees || 0);
}

function getBadgeClass(dispo: Disponibilite) {
  if (dispo.planningType && dispo.planningType !== "charter") return "bg-slate-300 text-slate-700 border-slate-400";
  if (dispo.statut === "reserve" || dispo.statut === "ferme") return "bg-red-500 text-white border-red-600";
  if (dispo.statut === "option") return "bg-orange-400 text-white border-orange-500";
  return "bg-emerald-500 text-white border-emerald-600";
}

function getDateLabel(iso: string) {
  const d = parseIsoDay(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function statusBadge(statut: Statut, isEnglish: boolean) {
  if (statut === "disponible") return { label: isEnglish ? "Available" : "Disponible", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" };
  if (statut === "option") return { label: "Option", cls: "bg-orange-100 text-orange-800 border-orange-300" };
  if (statut === "reserve") return { label: isEnglish ? "Booked" : "Complet", cls: "bg-red-100 text-red-800 border-red-300" };
  return { label: isEnglish ? "Closed" : "Fermé", cls: "bg-slate-100 text-slate-700 border-slate-300" };
}

function monthLabel(iso: string) {
  const d = parseIsoDay(iso);
  return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function firstDayOfMonth(iso: string) {
  const d = parseIsoDay(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function addMonths(isoMonthStart: string, count: number) {
  const d = parseIsoDay(isoMonthStart);
  d.setUTCMonth(d.getUTCMonth() + count);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function getMonthSpan(dispos: Disponibilite[]) {
  if (!dispos.length) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    return Array.from({ length: 12 }).map((_, i) => addMonths(start, i));
  }
  const starts = dispos.map((d) => firstDayOfMonth(toIsoDay(d.debut))).sort();
  const ends = dispos.map((d) => firstDayOfMonth(toIsoDay(d.fin))).sort();
  const minMonth = starts[0];
  const maxMonth = ends[ends.length - 1];
  const out: string[] = [];
  let cursor = minMonth;
  while (cursor <= maxMonth) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

function daysBetweenInclusive(startIso: string, endIso: string) {
  const start = parseIsoDay(startIso).getTime();
  const end = parseIsoDay(endIso).getTime();
  return Math.max(1, Math.floor((end - start) / (24 * 3600 * 1000)) + 1);
}

export default function CalendrierDisponibilites({ isEnglish = false }: { isEnglish?: boolean }) {
  const [dispos, setDispos] = useState<Disponibilite[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Disponibilite | null>(null);
  const [filter, setFilter] = useState<Produit>("all");
  const [reservationMode, setReservationMode] = useState<ReservationMode>("cabine");

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/disponibilites?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch disponibilites");
        const rows: Disponibilite[] = await res.json();
        const sorted = rows.slice().sort((a, b) => new Date(a.debut).getTime() - new Date(b.debut).getTime());
        setDispos(sorted);
        const first = sorted.find((d) => isBookable(d));
        if (first) {
          setSelected(first);
        }
      } catch {
        setDispos([]);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, []);

  const filtered = useMemo(() => dispos.filter((d) => (filter === "all" ? true : getProduct(d) === filter)), [dispos, filter]);
  const monthSpan = useMemo(() => getMonthSpan(filtered), [filtered]);
  const timelineStart = monthSpan[0];
  const timelineEnd = addMonths(monthSpan[monthSpan.length - 1] || firstDayOfMonth(toIsoDay(new Date())), 1);
  const timelineDays = daysBetweenInclusive(timelineStart, timelineEnd);

  const groupedByLane = useMemo(() => {
    const lanes = {
      journee: filtered.filter((d) => getProduct(d) === "journee"),
      med: filtered.filter((d) => getProduct(d) === "med"),
      transat: filtered.filter((d) => getProduct(d) === "transat"),
      caraibes: filtered.filter((d) => getProduct(d) === "caraibes"),
      stop: filtered.filter((d) => d.planningType === "technical_stop" || d.planningType === "maintenance" || d.planningType === "blocked"),
    };
    return lanes;
  }, [filtered]);

  const selectedProduct = selected ? getProduct(selected) : "med";
  const isDayTrip = selectedProduct === "journee";
  const totalUnits = getTotalUnits(selected);
  const reservedUnits = getReservedUnits(selected);
  const hasPriva = Boolean(selected && (selected.tarifJourPriva || selected.tarif));
  const hasCabine = Boolean(selected && (selected.tarifCabine || selected.tarifJourPersonne));
  const canBookPrivate = Boolean(selected && isBookable(selected) && hasPriva && reservedUnits === 0);
  const canBookCabine = Boolean(selected && isBookable(selected) && !isDayTrip && hasCabine && reservedUnits < totalUnits);
  const price =
    reservationMode === "priva"
      ? selected?.tarifJourPriva ?? selected?.tarif ?? 0
      : selected?.tarifCabine ?? selected?.tarifJourPersonne ?? selected?.tarif ?? 0;

  useEffect(() => {
    if (reservationMode === "priva" && !canBookPrivate && canBookCabine) setReservationMode("cabine");
    if (reservationMode === "cabine" && !canBookCabine && canBookPrivate) setReservationMode("priva");
  }, [reservationMode, canBookPrivate, canBookCabine]);

  return (
    <div className="rounded-3xl border p-6 lg:p-10 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.35)]" style={{ borderColor: "#dcc6ae", background: "linear-gradient(180deg,#fbf3ea,#f2e3d1)" }}>
      <div className="mb-6 flex flex-wrap gap-2">
        {[
          { id: "all", label: isEnglish ? "All" : "Tous" },
          { id: "med", label: isEnglish ? "Med / Corsica" : "Méditerranée / Corse" },
          { id: "transat", label: "Transat" },
          { id: "caraibes", label: isEnglish ? "Caribbean" : "Caraïbes" },
          { id: "journee", label: isEnglish ? "Day trips" : "Journées La Ciotat" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id as Produit)}
            className={`rounded-full px-4 py-2 text-sm font-semibold border ${filter === item.id ? "text-white" : "bg-white"}`}
            style={filter === item.id ? { backgroundColor: BRAND_DEEP, borderColor: BRAND_DEEP } : { color: BRAND_DEEP, borderColor: "#dbc4aa" }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-10 text-center">{isEnglish ? "Loading..." : "Chargement..."}</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-4 sm:p-6 lg:p-7" style={{ borderColor: "#dac2a7" }}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold" style={{ color: BRAND_DEEP }}>
                {isEnglish ? "Season timeline" : "Timeline des saisons"}
              </h3>
              <div className="flex gap-2 text-[11px]">
                <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">{isEnglish ? "Available" : "Disponible"}</span>
                <span className="inline-flex items-center rounded-full border border-orange-300 bg-orange-100 px-2 py-1 font-semibold text-orange-800">Option</span>
                <span className="inline-flex items-center rounded-full border border-red-300 bg-red-100 px-2 py-1 font-semibold text-red-800">{isEnglish ? "Booked" : "Complet"}</span>
                <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-1 font-semibold text-slate-700">{isEnglish ? "Closed" : "Fermé"}</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                <div className="grid grid-cols-[220px_1fr] gap-3 pb-2">
                  <div />
                  <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${monthSpan.length}, minmax(0, 1fr))` }}>
                    {monthSpan.map((m) => (
                      <div key={m} className="text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {monthLabel(m)}
                      </div>
                    ))}
                  </div>
                </div>

                {[
                  { key: "journee", label: isEnglish ? "Day trips La Ciotat" : "Journées La Ciotat" },
                  { key: "med", label: isEnglish ? "Mediterranean weeks" : "Semaines Méditerranée" },
                  { key: "transat", label: "Transatlantique" },
                  { key: "caraibes", label: isEnglish ? "Caribbean weeks" : "Semaines Caraïbes" },
                  { key: "stop", label: isEnglish ? "Technical stop" : "Arrêt technique" },
                ].map((lane) => {
                  const laneDispos = (groupedByLane as any)[lane.key] as Disponibilite[];
                  return (
                    <div key={lane.key} className="grid grid-cols-[220px_1fr] gap-3 py-2">
                      <div className="flex items-center text-sm font-semibold text-slate-700">{lane.label}</div>
                      <div className="relative h-12 rounded-xl border border-slate-200 bg-slate-50">
                        {monthSpan.map((m) => {
                          const offsetDays = daysBetweenInclusive(timelineStart, m) - 1;
                          const leftPct = (offsetDays / timelineDays) * 100;
                          return <div key={m} className="absolute inset-y-0 w-px bg-slate-200" style={{ left: `${leftPct}%` }} />;
                        })}
                        {laneDispos.map((d) => {
                          const start = toIsoDay(d.debut);
                          const end = toIsoDay(d.fin);
                          const left = ((daysBetweenInclusive(timelineStart, start) - 1) / timelineDays) * 100;
                          const width = (daysBetweenInclusive(start, end) / timelineDays) * 100;
                          const b = statusBadge(d.statut, isEnglish);
                          const barBg =
                            d.planningType && d.planningType !== "charter"
                              ? "bg-slate-400 border-slate-500"
                              : d.statut === "reserve"
                                ? "bg-red-500 border-red-600"
                                : d.statut === "option"
                                  ? "bg-orange-500 border-orange-600"
                                  : "bg-emerald-500 border-emerald-600";
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => setSelected(d)}
                              className={`absolute top-1/2 -translate-y-1/2 h-8 rounded-lg border px-2 text-left text-[11px] font-semibold text-white shadow-sm transition hover:scale-[1.01] ${barBg}`}
                              style={{ left: `${left}%`, width: `${Math.max(width, 5)}%` }}
                              title={`${d.destination} · ${b.label}`}
                            >
                              <span className="truncate block">{d.destination}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-6 lg:p-7" style={{ borderColor: "#dac2a7" }}>
            <h3 className="mb-4 text-xl font-bold" style={{ color: BRAND_DEEP }}>{isEnglish ? "Details" : "Détails"}</h3>
            {!selected ? (
              <div className="py-6 text-center text-slate-500">
                <Info className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                {isEnglish ? "Select a date to see availability." : "Sélectionnez une date pour voir la disponibilité."}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p><span className="font-semibold">{isEnglish ? "Period:" : "Période:"}</span> {getDateLabel(toIsoDay(selected.debut))} - {getDateLabel(toIsoDay(selected.fin))}</p>
                <p><span className="font-semibold">{isEnglish ? "Destination:" : "Destination:"}</span> {selected.destination}</p>
                <p><span className="font-semibold">{isEnglish ? "Status:" : "Statut:"}</span> {selected.statut}</p>
                <p><span className="font-semibold">{isEnglish ? "Remaining units:" : "Unités restantes:"}</span> {Math.max(0, totalUnits - reservedUnits)} / {totalUnits || "?"}</p>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadge(selected.statut, isEnglish).cls}`}>
                  {statusBadge(selected.statut, isEnglish).label}
                </span>
                {!!selected.notePublique && <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{selected.notePublique}</p>}
                {isBookable(selected) && (
                  <>
                    <div className={`grid gap-2 ${isDayTrip ? "grid-cols-1" : "grid-cols-2"}`}>
                      <button
                        onClick={() => setReservationMode("priva")}
                        disabled={!canBookPrivate}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold ${reservationMode === "priva" ? "text-white" : ""} ${canBookPrivate ? "" : "opacity-40 cursor-not-allowed"}`}
                        style={reservationMode === "priva" ? { backgroundColor: BRAND_DEEP, borderColor: BRAND_DEEP } : { color: BRAND_DEEP, borderColor: "#d8c1a6" }}
                      >
                        {isEnglish ? "Private" : "Privatif"}
                      </button>
                      {!isDayTrip && (
                        <button
                          onClick={() => setReservationMode("cabine")}
                          disabled={!canBookCabine}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold ${reservationMode === "cabine" ? "text-white" : ""} ${canBookCabine ? "" : "opacity-40 cursor-not-allowed"}`}
                          style={reservationMode === "cabine" ? { backgroundColor: BRAND_DEEP, borderColor: BRAND_DEEP } : { color: BRAND_DEEP, borderColor: "#d8c1a6" }}
                        >
                          {isEnglish ? "Cabin/seat" : "Cabine/place"}
                        </button>
                      )}
                    </div>
                    <p className="text-2xl font-bold" style={{ color: BRAND_DEEP }}>{price.toLocaleString("fr-FR")} €</p>
                    {(canBookPrivate || canBookCabine) && (
                      <a
                        href={`/reservation?id=${selected.id}&destination=${encodeURIComponent(selected.destination || "")}&formule=${isDayTrip ? "journee" : "semaine"}&typeReservation=${reservationMode === "priva" ? "bateau_entier" : "cabine"}&montant=${price}&dateDebut=${encodeURIComponent(toIsoDay(selected.debut))}&dateFin=${encodeURIComponent(toIsoDay(selected.fin))}`}
                        className="block rounded-xl px-4 py-3 text-center font-bold text-white"
                        style={{ backgroundColor: BRAND_DEEP }}
                      >
                        {isEnglish ? "Book now" : "Réserver"}
                      </a>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
