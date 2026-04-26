import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";

type Statut = "disponible" | "reserve" | "option" | "ferme";
type Produit = "all" | "med" | "transat" | "caraibes" | "journee";
type ReservationMode = "priva" | "cabine";
type SeasonPricingProduct = "med" | "transat" | "caraibes" | "journee";

type ProductSeasonPricing = {
  highSeasonPerPassenger: number | null;
  lowSeasonPerPassenger: number | null;
};

type SeasonPricingConfig = Record<SeasonPricingProduct, ProductSeasonPricing>;

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
const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const DEFAULT_SEASON_PRICING: SeasonPricingConfig = {
  med: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
  transat: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
  caraibes: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
  journee: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
};

function safeToIsoDay(input: string | Date | null | undefined) {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseIsoDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getProduct(dispo: Disponibilite): Produit {
  const destination = String(dispo.destination || "").toLowerCase();
  const start = safeToIsoDay(dispo.debut);
  const end = safeToIsoDay(dispo.fin);
  const isDay = Boolean(start && end && start === end);
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
  if (!d) return "--/--";
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isHighSeasonDate(dateInput: string | Date) {
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

function toSeasonPricingProduct(product: Produit): SeasonPricingProduct {
  if (product === "all") return "med";
  return product;
}

export default function CalendrierDisponibilites({ isEnglish = false }: { isEnglish?: boolean }) {
  const [dispos, setDispos] = useState<Disponibilite[]>([]);
  const [loading, setLoading] = useState(true);
  const [pricing, setPricing] = useState<SeasonPricingConfig>(DEFAULT_SEASON_PRICING);
  const [month, setMonth] = useState(new Date());
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
        const normalized = rows.filter((r) => Boolean(safeToIsoDay(r.debut) && safeToIsoDay(r.fin)));
        const sorted = normalized.slice().sort((a, b) => new Date(a.debut).getTime() - new Date(b.debut).getTime());
        setDispos(sorted);
        const first = sorted.find((d) => isBookable(d));
        if (first) {
          const start = new Date(first.debut);
          setMonth(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)));
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

  useEffect(() => {
    const loadPricing = async () => {
      try {
        const res = await fetch("/api/backoffice-ops/season-pricing", { cache: "no-store" });
        if (!res.ok) return;
        const payload = await res.json();
        setPricing({ ...DEFAULT_SEASON_PRICING, ...(payload || {}) });
      } catch {
        // fallback silencieux sur défauts
      }
    };
    void loadPricing();
  }, []);

  const filtered = useMemo(() => dispos.filter((d) => (filter === "all" ? true : getProduct(d) === filter)), [dispos, filter]);
  const byDay = useMemo(() => {
    const map = new Map<string, Disponibilite[]>();
    for (const d of filtered) {
      const start = safeToIsoDay(d.debut);
      const end = safeToIsoDay(d.fin);
      if (!start || !end) continue;
      let cursor = start;
      while (cursor <= end) {
        const current = map.get(cursor) || [];
        current.push(d);
        map.set(cursor, current);
        const next = parseIsoDay(cursor);
        if (!next) break;
        next.setUTCDate(next.getUTCDate() + 1);
        cursor = next.toISOString().slice(0, 10);
      }
    }
    return map;
  }, [filtered]);

  const bestForDay = (iso: string) => {
    const rows = byDay.get(iso) || [];
    if (!rows.length) return null;
    return rows
      .slice()
      .sort((a, b) => {
        const p = (v: Disponibilite) => (v.statut === "reserve" ? 4 : v.statut === "option" ? 3 : v.statut === "ferme" ? 2 : 1);
        return p(b) - p(a);
      })[0];
  };

  const year = month.getUTCFullYear();
  const monthIdx = month.getUTCMonth();
  const first = new Date(Date.UTC(year, monthIdx, 1));
  const last = new Date(Date.UTC(year, monthIdx + 1, 0));
  const startOffset = (first.getUTCDay() + 6) % 7;
  const days: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= last.getUTCDate(); d++) days.push(new Date(Date.UTC(year, monthIdx, d)));

  const selectedProduct = selected ? getProduct(selected) : "med";
  const isDayTrip = selectedProduct === "journee";
  const totalUnits = getTotalUnits(selected);
  const reservedUnits = getReservedUnits(selected);
  const hasPriva = Boolean(selected && (selected.tarifJourPriva || selected.tarif));
  const hasCabine = Boolean(selected && (selected.tarifCabine || selected.tarifJourPersonne || selected.tarif));
  const hasCabineCapacity = totalUnits > 0 && reservedUnits < totalUnits;
  const canBookPrivate = Boolean(selected && isBookable(selected) && hasPriva);
  const canBookCabine = Boolean(selected && isBookable(selected) && !isDayTrip && hasCabine && hasCabineCapacity);
  const seasonPricePerPassenger = useMemo(() => {
    if (!selected) return null;
    const product = toSeasonPricingProduct(selectedProduct);
    const dateIso = safeToIsoDay(selected.debut);
    if (!dateIso) return null;
    const productPricing = pricing[product];
    if (!productPricing) return null;
    return isHighSeasonDate(dateIso) ? productPricing.highSeasonPerPassenger : productPricing.lowSeasonPerPassenger;
  }, [selected, selectedProduct, pricing]);

  const fallbackPrice =
    reservationMode === "priva"
      ? selected?.tarifJourPriva ?? selected?.tarif ?? 0
      : selected?.tarifCabine ?? selected?.tarifJourPersonne ?? selected?.tarif ?? 0;
  const price = reservationMode === "cabine" && seasonPricePerPassenger !== null ? seasonPricePerPassenger : fallbackPrice;

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
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl border bg-white p-4 sm:p-6" style={{ borderColor: "#dac2a7" }}>
            <div className="mb-4 flex items-center justify-between">
              <button onClick={() => setMonth(new Date(Date.UTC(year, monthIdx - 1, 1)))} className="rounded-lg p-2 hover:bg-slate-100">
                <ChevronLeft className="h-5 w-5" style={{ color: BRAND_DEEP }} />
              </button>
              <h3 className="text-xl font-bold" style={{ color: BRAND_DEEP }}>{MONTHS_FR[monthIdx]} {year}</h3>
              <button onClick={() => setMonth(new Date(Date.UTC(year, monthIdx + 1, 1)))} className="rounded-lg p-2 hover:bg-slate-100">
                <ChevronRight className="h-5 w-5" style={{ color: BRAND_DEEP }} />
              </button>
            </div>
            <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-semibold text-slate-500">
              {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {days.map((d, idx) => {
                if (!d) return <div key={`empty-${idx}`} className="aspect-square min-h-[48px]" />;
                const iso = d.toISOString().slice(0, 10);
                const slot = bestForDay(iso);
                const selectedRange =
                  selected &&
                  (() => {
                    const s = safeToIsoDay(selected.debut);
                    const e = safeToIsoDay(selected.fin);
                    if (!s || !e) return false;
                    const sDate = parseIsoDay(s);
                    const eDate = parseIsoDay(e);
                    if (!sDate || !eDate) return false;
                    return sDate.getTime() <= d.getTime() && d.getTime() <= eDate.getTime();
                  })();
                return (
                  <button
                    key={iso}
                    onClick={() => slot && setSelected(slot)}
                    className={`aspect-square min-h-[48px] rounded-lg border text-xs font-semibold ${slot ? getBadgeClass(slot) : "bg-slate-100 text-slate-400 border-slate-200"} ${selectedRange ? "ring-2 ring-offset-2" : ""}`}
                    style={selectedRange ? { ["--tw-ring-color" as any]: BRAND_DEEP } : undefined}
                  >
                    <span>{d.getUTCDate()}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-6" style={{ borderColor: "#dac2a7" }}>
            <h3 className="mb-4 text-xl font-bold" style={{ color: BRAND_DEEP }}>{isEnglish ? "Details" : "Détails"}</h3>
            {!selected ? (
              <div className="py-6 text-center text-slate-500">
                <Info className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                {isEnglish ? "Select a date to see availability." : "Sélectionnez une date pour voir la disponibilité."}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p>
                  <span className="font-semibold">{isEnglish ? "Period:" : "Période:"}</span>{" "}
                  {getDateLabel(safeToIsoDay(selected.debut) || "")} - {getDateLabel(safeToIsoDay(selected.fin) || "")}
                </p>
                <p><span className="font-semibold">{isEnglish ? "Destination:" : "Destination:"}</span> {selected.destination}</p>
                <p><span className="font-semibold">{isEnglish ? "Status:" : "Statut:"}</span> {selected.statut}</p>
                <p><span className="font-semibold">{isEnglish ? "Remaining units:" : "Unités restantes:"}</span> {Math.max(0, totalUnits - reservedUnits)} / {totalUnits || "?"}</p>
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
                    {reservationMode === "cabine" && seasonPricePerPassenger !== null && (
                      <p className="text-xs text-slate-500">
                        {isEnglish ? "Season price per passenger" : "Tarif saison par passager"}
                      </p>
                    )}
                    {(canBookPrivate || canBookCabine) && (
                      <a
                        href={`/reservation?id=${selected.id}&destination=${encodeURIComponent(selected.destination || "")}&formule=${isDayTrip ? "journee" : "semaine"}&typeReservation=${reservationMode === "priva" ? "bateau_entier" : "cabine"}&montant=${price}&dateDebut=${encodeURIComponent(safeToIsoDay(selected.debut) || "")}&dateFin=${encodeURIComponent(safeToIsoDay(selected.fin) || "")}`}
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
