import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import {
  chooseBestDisponibiliteForDay,
  getProductFromDisponibilite,
  isBookableDisponibilite,
  parseIsoDayUtc,
  toIsoDayUtc,
} from "@shared/calendarSelection";

type Statut = "disponible" | "reserve" | "option" | "ferme";
type Produit = "all" | "med" | "transat" | "caraibes" | "journee";
type ReservationMode = "priva" | "cabine";
type SeasonPricingProduct = "med" | "transat" | "caraibes" | "journee";

type ProductSeasonPricing = {
  highSeasonPerPassenger: number | null;
  lowSeasonPerPassenger: number | null;
  highSeasonPrivate: number | null;
  lowSeasonPrivate: number | null;
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
  med: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null, highSeasonPrivate: null, lowSeasonPrivate: null },
  transat: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null, highSeasonPrivate: null, lowSeasonPrivate: null },
  caraibes: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null, highSeasonPrivate: null, lowSeasonPrivate: null },
  journee: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null, highSeasonPrivate: null, lowSeasonPrivate: null },
};
const FILTER_ANCHOR_MONTH_BY_PRODUCT: Partial<Record<Produit, number>> = {
  med: 6, // Juillet
  transat: 10, // Novembre
  caraibes: 11, // Decembre
};

function toUtcMonthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function normalizeProductFilter(value: string): Produit {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  if (["med", "mediterranee", "mediterranean", "croisiere_mediterranee"].includes(normalized)) return "med";
  if (["transat", "transatlantique", "traversee", "atlantic"].includes(normalized)) return "transat";
  if (["caraibes", "caribbean", "antilles", "croisiere_caraibes"].includes(normalized)) return "caraibes";
  if (["journee", "daytrip", "day_trip", "journee_privee"].includes(normalized)) return "journee";
  if (normalized === "all" || normalized === "tous") return "all";
  return "all";
}

function getAnchorMonthForFilter(filter: Produit, today: Date) {
  const monthIdx = FILTER_ANCHOR_MONTH_BY_PRODUCT[normalizeProductFilter(filter)];
  if (monthIdx === undefined) return toUtcMonthStart(today);
  return new Date(Date.UTC(today.getUTCFullYear(), monthIdx, 1));
}

function getProduct(dispo: Disponibilite): Produit {
  return getProductFromDisponibilite(dispo);
}

function isBookable(dispo?: Disponibilite | null) {
  return isBookableDisponibilite(dispo);
}
function isPastIso(iso?: string | null) {
  if (!iso) return false;
  const today = new Date().toISOString().slice(0, 10);
  return iso < today;
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
  const d = parseIsoDayUtc(iso);
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
  const [todayAnchor] = useState(() => toUtcMonthStart(new Date()));
  const [dispos, setDispos] = useState<Disponibilite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<SeasonPricingConfig>(DEFAULT_SEASON_PRICING);
  const [month, setMonth] = useState(todayAnchor);
  const [selected, setSelected] = useState<Disponibilite | null>(null);
  const [filter, setFilter] = useState<Produit>("all");
  const [reservationMode, setReservationMode] = useState<ReservationMode>("cabine");

  const loadDisponibilites = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        setLoading(true);
      setLoadError(null);
      const res = await fetch(`/api/disponibilites?t=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error("L'API disponibilités a répondu en erreur.");
      }
      const rows: Disponibilite[] = await res.json();
      const normalized = rows.filter((r) => Boolean(toIsoDayUtc(r.debut) && toIsoDayUtc(r.fin)));
      const sorted = normalized.slice().sort((a, b) => new Date(a.debut).getTime() - new Date(b.debut).getTime());
      setDispos(sorted);
      const first = sorted.find((d) => isBookable(d));
      setSelected((prev) => prev || first || null);
    } catch (error: any) {
      setDispos([]);
      const isTimeout = error?.name === "AbortError";
      setLoadError(
        isTimeout
          ? "Le chargement des disponibilités a expiré. Réessayez."
          : "Impossible de charger les disponibilités pour le moment."
      );
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDisponibilites();
  }, [loadDisponibilites]);

  useEffect(() => {
    setMonth(getAnchorMonthForFilter(filter, todayAnchor));
  }, [filter, todayAnchor]);

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
      const start = toIsoDayUtc(d.debut);
      const end = toIsoDayUtc(d.fin);
      if (!start || !end) continue;
      const isSingleDay = start === end;
      let cursor = start;
      while (cursor < end || (isSingleDay && cursor === end)) {
        const current = map.get(cursor) || [];
        current.push(d);
        map.set(cursor, current);
        const next = parseIsoDayUtc(cursor);
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
    return chooseBestDisponibiliteForDay(rows, iso);
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
  const isTransatSelected = selectedProduct === "transat";
  const selectedStartIso = selected ? toIsoDayUtc(selected.debut) : null;
  const selectedEndIso = selected ? toIsoDayUtc(selected.fin) : null;
  const isPastSelection = Boolean(
    (selectedStartIso && isPastIso(selectedStartIso)) || (selectedEndIso && isPastIso(selectedEndIso)),
  );
  const totalUnits = getTotalUnits(selected);
  const reservedUnits = getReservedUnits(selected);
  const privateBasePrice = isTransatSelected ? null : selected?.tarifJourPriva ?? selected?.tarif ?? null;
  const directCabinePrice = isTransatSelected ? (selected?.tarif ?? 3000) : selected?.tarifCabine ?? selected?.tarifJourPersonne ?? null;
  const hasPriva = Boolean(selected && privateBasePrice !== null);
  const hasCabine = Boolean(selected && directCabinePrice !== null);
  const hasCabineCapacity = totalUnits > 0 && reservedUnits < totalUnits;
  const canBookPrivate = Boolean(selected && !isPastSelection && isBookable(selected) && hasPriva && !isTransatSelected);
  const canBookCabine = Boolean(selected && !isPastSelection && isBookable(selected) && !isDayTrip && hasCabine && hasCabineCapacity);
  const seasonPricePerPassenger = useMemo(() => {
    if (!selected) return null;
    const product = toSeasonPricingProduct(selectedProduct);
    const dateIso = toIsoDayUtc(selected.debut);
    if (!dateIso) return null;
    const productPricing = pricing[product];
    if (!productPricing) return null;
    return isHighSeasonDate(dateIso) ? productPricing.highSeasonPerPassenger : productPricing.lowSeasonPerPassenger;
  }, [selected, selectedProduct, pricing]);
  const seasonPrivatePrice = useMemo(() => {
    if (!selected) return null;
    const product = toSeasonPricingProduct(selectedProduct);
    const dateIso = toIsoDayUtc(selected.debut);
    if (!dateIso) return null;
    const productPricing = pricing[product];
    if (!productPricing) return null;
    return isHighSeasonDate(dateIso) ? productPricing.highSeasonPrivate : productPricing.lowSeasonPrivate;
  }, [selected, selectedProduct, pricing]);

  const cabinPrice = isTransatSelected ? 3000 : seasonPricePerPassenger ?? directCabinePrice ?? 0;
  const privatePrice = seasonPrivatePrice ?? privateBasePrice ?? 0;
  const price = reservationMode === "cabine" ? cabinPrice : privatePrice;

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
      ) : loadError ? (
        <div className="py-10 text-center space-y-3">
          <p className="text-sm text-red-700">{isEnglish ? "Failed to load availability." : loadError}</p>
          <button
            onClick={() => void loadDisponibilites()}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: BRAND_DEEP }}
          >
            {isEnglish ? "Retry" : "Réessayer"}
          </button>
        </div>
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
                const isPastDay = isPastIso(iso);
                const selectedRange =
                  selected &&
                  (() => {
                    const s = toIsoDayUtc(selected.debut);
                    const e = toIsoDayUtc(selected.fin);
                    if (!s || !e) return false;
                    const sDate = parseIsoDayUtc(s);
                    const eDate = parseIsoDayUtc(e);
                    if (!sDate || !eDate) return false;
                    return sDate.getTime() <= d.getTime() && d.getTime() <= eDate.getTime();
                  })();
                  return (
                    <button
                    key={iso}
                    onClick={() => slot && !isPastDay && setSelected(slot)}
                    disabled={isPastDay}
                    className={`aspect-square min-h-[48px] rounded-lg border text-xs font-semibold ${slot ? getBadgeClass(slot) : "bg-slate-100 text-slate-400 border-slate-200"} ${selectedRange ? "ring-2 ring-offset-2" : ""} ${isPastDay ? "opacity-45 cursor-not-allowed" : ""}`}
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
                  {getDateLabel(toIsoDayUtc(selected.debut) || "")} - {getDateLabel(toIsoDayUtc(selected.fin) || "")}
                </p>
                <p><span className="font-semibold">{isEnglish ? "Destination:" : "Destination:"}</span> {selected.destination}</p>
                <p><span className="font-semibold">{isEnglish ? "Status:" : "Statut:"}</span> {selected.statut}</p>
                {isPastSelection && (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                    Cette date est dans le passé: réservation indisponible.
                  </p>
                )}
                <p><span className="font-semibold">{isEnglish ? "Remaining units:" : "Unités restantes:"}</span> {Math.max(0, totalUnits - reservedUnits)} / {totalUnits || "?"}</p>
                {!!selected.notePublique && <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{selected.notePublique}</p>}
                {isBookable(selected) && (
                  <>
                    <div className={`grid gap-2 ${isDayTrip || isTransatSelected ? "grid-cols-1" : "grid-cols-2"}`}>
                      {!isTransatSelected && (
                        <button
                          onClick={() => setReservationMode("priva")}
                          disabled={!canBookPrivate}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold ${reservationMode === "priva" ? "text-white" : ""} ${canBookPrivate ? "" : "opacity-40 cursor-not-allowed"}`}
                          style={reservationMode === "priva" ? { backgroundColor: BRAND_DEEP, borderColor: BRAND_DEEP } : { color: BRAND_DEEP, borderColor: "#d8c1a6" }}
                        >
                          {isEnglish ? "Private" : "Privatif"}
                        </button>
                      )}
                      {!isDayTrip && (
                        <button
                          onClick={() => setReservationMode("cabine")}
                          disabled={!canBookCabine}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold ${reservationMode === "cabine" ? "text-white" : ""} ${canBookCabine ? "" : "opacity-40 cursor-not-allowed"}`}
                          style={reservationMode === "cabine" ? { backgroundColor: BRAND_DEEP, borderColor: BRAND_DEEP } : { color: BRAND_DEEP, borderColor: "#d8c1a6" }}
                        >
                          {isTransatSelected ? (isEnglish ? "Seat" : "Place") : (isEnglish ? "Cabin/seat" : "Cabine/place")}
                        </button>
                      )}
                      </div>
                    <p className="text-2xl font-bold" style={{ color: BRAND_DEEP }}>{price.toLocaleString("fr-FR")} €</p>
                    {isTransatSelected && (
                      <p className="text-xs text-slate-500">{isEnglish ? "3000€ per person · full transatlantic leg" : "3000€/personne · traversée complète automatique"}</p>
                    )}
                    {reservationMode === "cabine" && seasonPricePerPassenger !== null && !isTransatSelected && (
                      <p className="text-xs text-slate-500">
                        {isEnglish ? "Season price per passenger" : "Tarif saison par passager"}
                      </p>
                    )}
                    {(canBookPrivate || canBookCabine) && (
                      <a
                        href={`/reservation?id=${selected.id}&destination=${encodeURIComponent(selected.destination || "")}&formule=${isDayTrip ? "journee" : "semaine"}&typeReservation=${isTransatSelected ? "place" : reservationMode === "priva" ? "bateau_entier" : "cabine"}&montant=${price}&dateDebut=${encodeURIComponent(toIsoDayUtc(selected.debut) || "")}&dateFin=${encodeURIComponent(toIsoDayUtc(selected.fin) || "")}`}
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
