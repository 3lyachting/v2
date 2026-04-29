import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CHARTER_PRODUCT_LABELS, type CharterProductCode } from "@shared/charterProduct";
import { getCharterHighSeasonError } from "@shared/charterWeekPolicy";
import { getProductFromDisponibilite } from "@shared/calendarSelection";
import {
  DEFAULT_SEASON_PRICING,
  type SeasonPricingConfig,
  type SeasonPricingProduct,
  estimateMvpIndicativeTotalEur,
  getSeasonPriceForDate,
  TRANSAT_PER_PERSON_EUR,
} from "@shared/seasonPricing";
import { CHARTER_CRUISE_CABIN_UNITS, isCruiseMultiUnitProduct } from "@shared/charterCapacity";
import { apiUrl } from "@/lib/apiBase";

type SelectionMode = "single" | "range";
type ReservationMode = "cabine" | "priva";
type DisponibiliteLite = {
  id?: number;
  debut: string;
  fin: string;
  destination: string;
  cabinesReservees?: number | null;
  statut?: "disponible" | "reserve" | "option" | "ferme";
};

const BRAND_DEEP = "#00384A";
const BRAND_SAND = "#D8C19E";

const DEFAULT_PRIVATE_WEEKLY_PRICE: Record<Exclude<CharterProductCode, "transat">, number> = {
  med: 14000,
  caraibes: 14000,
  journee: 1000,
};

function maxPassengersByProduct(product: CharterProductCode): number {
  return product === "journee" ? 12 : 8;
}

function startOfWeekSaturday(iso: string): string {
  const d = fromIso(iso);
  const dow = d.getDay(); // 0 sunday ... 6 saturday
  const offset = (dow + 1) % 7; // saturday => 0, sunday => 1, monday => 2, ...
  d.setDate(d.getDate() - offset);
  return toIso(d);
}

function addDaysLocalIso(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

function startOfMonthFromIso(iso: string): Date {
  const d = fromIso(iso);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateDiffDays(startIso: string, endIso: string) {
  const start = fromIso(startIso).getTime();
  const end = fromIso(endIso).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function addOneDayIso(iso: string) {
  const d = fromIso(iso);
  d.setDate(d.getDate() + 1);
  return toIso(d);
}

function coverageForRange(availability: Set<string> | null, startIso: string | null, endIso: string | null) {
  if (!startIso) return { kind: "none" as const, missingDays: 0, totalDays: 0 };
  const end = endIso || startIso;
  if (!availability) {
    return { kind: "unknown" as const, missingDays: 0, totalDays: dateDiffDays(startIso, end) };
  }
  let cur = startIso;
  let total = 0;
  let ok = 0;
  while (cur <= end) {
    total += 1;
    if (availability.has(cur)) ok += 1;
    if (cur === end) break;
    cur = addOneDayIso(cur);
  }
  if (ok === 0) return { kind: "empty" as const, missingDays: total - ok, totalDays: total };
  if (ok === total) return { kind: "full" as const, missingDays: 0, totalDays: total };
  return { kind: "partial" as const, missingDays: total - ok, totalDays: total };
}

export default function AirbnbCalendarMvp({
  isEnglish = false,
  onSelectionChange,
  product,
  dayAvailability,
  blockedDays = new Set<string>(),
  charterPeriods = [],
  slotOccupancy = {},
}: {
  isEnglish?: boolean;
  onSelectionChange?: (startIso: string | null, endIso: string | null) => void;
  /** Filtre affichage / validation: un des 4 produits. */
  product: CharterProductCode;
  /**
   * Jours proposés pour le produit courant. null = chargement / inconnu.
   * Les dates hors ensemble sont grisés et non cliquables.
   */
  dayAvailability: Set<string> | null;
  /** Jours explicitement bloqués par des réservations (coloration visuelle prioritaire). */
  blockedDays?: Set<string>;
  /** Périodes publiées (charterSlots) : une réservation = une seule période entière. */
  charterPeriods?: Array<{ id: number; startIso: string; endIso: string }>;
  /** Occupation cabines / privatif par id de période (API blocked-days). */
  slotOccupancy?: Record<string, { reservedUnits: number; hasPrivate: boolean }>;
}) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("range");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [seasonPricing, setSeasonPricing] = useState<SeasonPricingConfig>(DEFAULT_SEASON_PRICING);
  const [soldDays, setSoldDays] = useState<Set<string>>(new Set());
  const [reservationMode, setReservationMode] = useState<ReservationMode>("cabine");
  const [passengerCount, setPassengerCount] = useState<number>(2);
  const today = new Date();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/backoffice-ops/season-pricing"), { cache: "no-store" });
        if (!res.ok) throw new Error("pricing");
        const data = (await res.json()) as SeasonPricingConfig;
        if (!cancelled) {
          setSeasonPricing({ ...DEFAULT_SEASON_PRICING, ...data });
        }
      } catch {
        if (!cancelled) setSeasonPricing(DEFAULT_SEASON_PRICING);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/disponibilites"), { cache: "no-store" });
        if (!res.ok) throw new Error("dispos");
        const rows = (await res.json()) as DisponibiliteLite[];
        if (cancelled) return;
        const set = new Set<string>();
        for (const row of rows) {
          const rowProduct = getProductFromDisponibilite({
            debut: row.debut,
            fin: row.fin,
            destination: row.destination,
          });
          if (rowProduct !== product) continue;
          const a = String(row.debut).slice(0, 10);
          const b = String(row.fin).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || a > b) continue;
          const sold = Number(row.cabinesReservees || 0) > 0;
          if (!sold) continue;
          let cur = a;
          for (;;) {
            set.add(cur);
            if (cur >= b) break;
            cur = addOneDayIso(cur);
          }
        }
        setSoldDays(set);
      } catch {
        if (!cancelled) {
          setSoldDays(new Set());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product]);

  const monthLabel = month.toLocaleDateString(isEnglish ? "en-US" : "fr-FR", {
    month: "long",
    year: "numeric",
  });

  const days = useMemo(() => {
    const firstDayIndex = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const numberOfDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: Date[] = [];

    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), i - firstDayIndex + 1));
    }
    for (let i = 1; i <= numberOfDays; i++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), i));
    }
    while (cells.length < 42) {
      const next = cells.length - (firstDayIndex + numberOfDays) + 1;
      cells.push(new Date(month.getFullYear(), month.getMonth() + 1, next));
    }
    return cells;
  }, [month]);

  const inRange = (iso: string) => {
    if (!startDate || !endDate) return false;
    return iso >= startDate && iso <= endDate;
  };

  const handleSelectDate = (date: Date) => {
    const iso = toIso(date);
    if (dayAvailability && !dayAvailability.has(iso)) {
      return;
    }
    if (charterPeriods.length > 0) {
      const matched = charterPeriods.find((slot) => iso >= slot.startIso && iso <= slot.endIso);
      if (matched) {
        setStartDate(matched.startIso);
        setEndDate(matched.endIso);
      }
      return;
    }
    const isoMonth = Number(iso.slice(5, 7));
    const shouldAutoWeek = isoMonth === 2 || isoMonth === 7 || isoMonth === 8 || isoMonth === 12;
    if (shouldAutoWeek && selectionMode === "range") {
      const start = startOfWeekSaturday(iso);
      const end = addDaysLocalIso(start, 7);
      const hasAllDays =
        !dayAvailability ||
        (() => {
          let cur = start;
          for (;;) {
            if (!dayAvailability.has(cur)) return false;
            if (cur >= end) break;
            cur = addOneDayIso(cur);
          }
          return true;
        })();
      if (hasAllDays) {
        setStartDate(start);
        setEndDate(end);
        return;
      }
    }
    if (selectionMode === "single") {
      setStartDate(iso);
      setEndDate(iso);
      return;
    }
    if (!startDate || (startDate && endDate)) {
      setStartDate(iso);
      setEndDate(null);
      return;
    }
    if (iso < startDate) {
      setEndDate(startDate);
      setStartDate(iso);
      return;
    }
    setEndDate(iso);
  };

  useEffect(() => {
    onSelectionChange?.(startDate, endDate);
  }, [endDate, onSelectionChange, startDate]);

  // Au changement de produit (et donc de disponibilités), naviguer vers la prochaine date disponible.
  useEffect(() => {
    if (!dayAvailability || dayAvailability.size === 0) return;
    const todayIso = toIso(new Date());
    const sorted = Array.from(dayAvailability).sort();
    const next = sorted.find((d) => d >= todayIso) || sorted[0];
    if (!next) return;
    setMonth(startOfMonthFromIso(next));
  }, [dayAvailability, product]);

  const nights = startDate && endDate ? dateDiffDays(startDate, endDate) : 0;
  const panelTitle = isEnglish ? "Stay details" : "Détails du séjour";
  const productLabel = CHARTER_PRODUCT_LABELS[product];
  const rangeCoverage = useMemo(
    () => coverageForRange(dayAvailability, startDate, endDate),
    [dayAvailability, endDate, startDate]
  );
  const availabilityHint =
    rangeCoverage.kind === "unknown"
      ? isEnglish
        ? "Loading availability…"
        : "Chargement des periodes…"
      : rangeCoverage.kind === "empty"
        ? isEnglish
          ? "No published slots for this product on these dates (choose another product or different dates)."
          : "Aucune periode active publiee pour ce produit sur cette periode (changez de produit ou de dates)."
        : rangeCoverage.kind === "partial"
          ? isEnglish
            ? `Only ${rangeCoverage.totalDays - rangeCoverage.missingDays} of ${rangeCoverage.totalDays} day(s) are in your published window for this product.`
            : `Seulement ${rangeCoverage.totalDays - rangeCoverage.missingDays} / ${rangeCoverage.totalDays} jour(s) entrent dans vos periodes actives (produit: ${productLabel}).`
          : rangeCoverage.kind === "full" && endDate
            ? isEnglish
              ? "Your selection is fully within published availability for this product."
              : "Votre selection est entierement couverte par vos periodes actives (produit courant)."
            : "";

  const highSeasonError = getCharterHighSeasonError(startDate, endDate, selectionMode, { isEnglish });
  const isDayTrip = product === "journee";
  const isTransat = product === "transat";
  const canChooseCabine = !isDayTrip;

  const selectedCharterOccupancy = useMemo(() => {
    if (!startDate) return null;
    const end = endDate || startDate;
    const p = charterPeriods.find((s) => s.startIso === startDate && s.endIso === end);
    if (!p) return null;
    const raw = slotOccupancy[String(p.id)];
    const occ =
      raw && typeof raw.reservedUnits === "number"
        ? { reservedUnits: raw.reservedUnits, hasPrivate: Boolean(raw.hasPrivate) }
        : { reservedUnits: 0, hasPrivate: false };
    return { slot: p, occ };
  }, [charterPeriods, endDate, slotOccupancy, startDate]);

  const cabinsLeftByDay = useMemo(() => {
    const out = new Map<string, number>();
    if (!isCruiseMultiUnitProduct(product)) return out;
    for (const slot of charterPeriods) {
      const occ = slotOccupancy[String(slot.id)] || { reservedUnits: 0, hasPrivate: false };
      const left = occ.hasPrivate ? 0 : Math.max(0, CHARTER_CRUISE_CABIN_UNITS - Number(occ.reservedUnits || 0));
      let cur = slot.startIso;
      while (cur <= slot.endIso) {
        out.set(cur, left);
        if (cur === slot.endIso) break;
        cur = addOneDayIso(cur);
      }
    }
    return out;
  }, [charterPeriods, product, slotOccupancy]);

  const occBlocksPrivatif = Boolean(
    selectedCharterOccupancy &&
      (selectedCharterOccupancy.occ.hasPrivate || selectedCharterOccupancy.occ.reservedUnits > 0)
  );

  const canChoosePrivatif = !isTransat && !occBlocksPrivatif;

  const cruiseCapacityHint = useMemo(() => {
    if (!selectedCharterOccupancy || !isCruiseMultiUnitProduct(product)) return null;
    const { occ } = selectedCharterOccupancy;
    if (occ.hasPrivate) {
      return isEnglish ? "This period is already under private charter." : "Cette période est déjà en privatif.";
    }
    if (occ.reservedUnits > 0) {
      const left = Math.max(0, CHARTER_CRUISE_CABIN_UNITS - occ.reservedUnits);
      return isEnglish
        ? `${occ.reservedUnits} cabin(s) already booked — ${left} left. Whole-boat private charter is unavailable.`
        : `${occ.reservedUnits} cabine(s) déjà réservée(s) — ${left} restante(s). Le privatif bateau entier n'est pas disponible.`;
    }
    return null;
  }, [isEnglish, product, selectedCharterOccupancy]);

  const maxPassengers = useMemo(() => {
    const base = maxPassengersByProduct(product);
    if (!selectedCharterOccupancy || !isCruiseMultiUnitProduct(product) || selectedCharterOccupancy.occ.hasPrivate) {
      return base;
    }
    const left = Math.max(0, CHARTER_CRUISE_CABIN_UNITS - selectedCharterOccupancy.occ.reservedUnits);
    return Math.max(1, Math.min(base, left * 2));
  }, [product, selectedCharterOccupancy]);

  useEffect(() => {
    setPassengerCount((prev) => Math.max(1, Math.min(maxPassengers, prev)));
  }, [maxPassengers]);

  useEffect(() => {
    if (reservationMode === "cabine" && !canChooseCabine && canChoosePrivatif) {
      setReservationMode("priva");
    } else if (reservationMode === "priva" && !canChoosePrivatif && canChooseCabine) {
      setReservationMode("cabine");
    }
  }, [canChooseCabine, canChoosePrivatif, reservationMode]);

  const pricePanel = useMemo(() => {
    const p = product as SeasonPricingProduct;
    if (!startDate) return { kind: "empty" as const };
    if (selectionMode === "range" && !endDate) {
      const u =
        product === "transat" ? TRANSAT_PER_PERSON_EUR : getSeasonPriceForDate(seasonPricing, p, startDate);
      return { kind: "await_end" as const, unitEur: u };
    }
    const end = endDate || startDate;
    return { kind: "ready" as const, ...estimateMvpIndicativeTotalEur(seasonPricing, p, startDate, end) };
  }, [endDate, product, seasonPricing, selectionMode, startDate]);

  const bookingPanel = useMemo(() => {
    if (pricePanel.kind !== "ready" || !startDate) {
      return {
        canBook: false,
        totalEur: null as number | null,
        info: isEnglish
          ? "Complete your date range first."
          : "Complétez d'abord la plage de dates.",
        href: "#",
      };
    }

    const safePassengers = Math.max(1, Math.min(maxPassengers, Number.isFinite(passengerCount) ? Math.round(passengerCount) : 1));
    const weekBlocks = Math.max(1, pricePanel.weekBlocks || 1);
    const isReady = !highSeasonError;

    let totalEur: number | null = null;
    if (reservationMode === "cabine") {
      totalEur = pricePanel.total != null ? Math.round(pricePanel.total * safePassengers) : null;
    } else if (canChoosePrivatif) {
      const base = DEFAULT_PRIVATE_WEEKLY_PRICE[product as Exclude<CharterProductCode, "transat">] ?? 0;
      totalEur = product === "journee" ? base : base * weekBlocks;
    }

    const reservationType =
      reservationMode === "priva" ? "bateau_entier" : isTransat ? "place" : "cabine";
    const formule = isDayTrip ? "journee" : "semaine";
    const destination = CHARTER_PRODUCT_LABELS[product];
    const selectedSlot =
      startDate && (endDate || startDate)
        ? charterPeriods.find((slot) => slot.startIso === startDate && slot.endIso === (endDate || startDate))
        : null;
    const query = new URLSearchParams({
      produit: product,
      destination,
      formule,
      typeReservation: reservationType,
      nbPersonnes: String(safePassengers),
      dateDebut: startDate,
      dateFin: endDate || startDate,
      montant: String(totalEur ?? 0),
      ...(selectedSlot ? { charterSlotId: String(selectedSlot.id), charterProduct: product } : {}),
    });

    return {
      canBook: Boolean(totalEur != null && isReady && (reservationMode !== "priva" || canChoosePrivatif)),
      totalEur,
      info:
        totalEur == null
          ? isEnglish
            ? "No price configured for this product."
            : "Aucun tarif configuré pour ce produit."
          : reservationMode === "cabine"
            ? isEnglish
              ? `Calculated for ${safePassengers} passenger(s).`
              : `Calculé pour ${safePassengers} passager(s).`
            : isEnglish
              ? "Private charter estimated total."
              : "Total estimé pour privatisation.",
      href: `/reservation?${query.toString()}`,
    };
  }, [
    canChoosePrivatif,
    endDate,
    highSeasonError,
    isDayTrip,
    isEnglish,
    isTransat,
    passengerCount,
    pricePanel,
    product,
    reservationMode,
    startDate,
    charterPeriods,
    maxPassengers,
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-3xl border border-[#d7e3e8] bg-white p-5 shadow-[0_12px_30px_rgba(7,38,50,0.09)]">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {charterPeriods.length === 0 ? (
              <div className="inline-flex w-fit max-w-full rounded-full border border-[#d7e3e8] bg-[#f4f8fa] p-1">
                <button
                  type="button"
                  onClick={() => setSelectionMode("single")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectionMode === "single" ? "text-white" : "text-slate-700"}`}
                  style={selectionMode === "single" ? { backgroundColor: BRAND_DEEP } : {}}
                >
                  {isEnglish ? "Single date" : "Date unique"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectionMode("range")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectionMode === "range" ? "text-white" : "text-slate-700"}`}
                  style={selectionMode === "range" ? { backgroundColor: BRAND_DEEP } : {}}
                >
                  {isEnglish ? "Date range" : "Plage de dates"}
                </button>
              </div>
            ) : (
              <p className="max-w-md text-xs font-semibold text-slate-600">
                {isEnglish
                  ? "One published period at a time: click any day inside the slot you want."
                  : "Une seule période publiée à la fois : cliquez sur un jour à l'intérieur de la période souhaitée."}
              </p>
            )}
            <div className="text-left sm:text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {isEnglish ? "Product" : "Produit"}
              </p>
              <p className="text-xs font-bold" style={{ color: BRAND_DEEP }}>
                {productLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="rounded-full border border-slate-200 p-2 hover:bg-slate-50"
            >
              <ChevronLeft className="h-4 w-4 text-slate-600" />
            </button>
            <div className="min-w-40 text-center text-sm font-semibold capitalize text-slate-800">{monthLabel}</div>
            <button
              type="button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="rounded-full border border-slate-200 p-2 hover:bg-slate-50"
            >
              <ChevronRight className="h-4 w-4 text-slate-600" />
            </button>
          </div>
        </div>

        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {(isEnglish ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]).map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((date) => {
            const iso = toIso(date);
            const isCurrentMonth = date.getMonth() === month.getMonth();
            const inAvail = dayAvailability ? dayAvailability.has(iso) : true;
            const isDisabled = isCurrentMonth && dayAvailability ? !inAvail : false;
            const isStart = !!startDate && iso === startDate;
            const isEnd = !!endDate && iso === endDate;
            const isSelectedRange = inRange(iso);
            const isTodayDate = isSameDay(date, today);
            const hasSoldCabins = soldDays.has(iso);
            const isBlockedByReservation = blockedDays.has(iso);
            const cabinsLeft = cabinsLeftByDay.get(iso);

            return (
              <button
                key={iso}
                type="button"
                onClick={() => handleSelectDate(date)}
                title={
                  isDisabled
                    ? isEnglish
                      ? "Not in published window for this product"
                      : "Hors fenetre publiee pour ce produit"
                    : undefined
                }
                disabled={isDisabled}
                className={`relative aspect-square rounded-xl border text-sm transition ${
                  isCurrentMonth
                    ? isDisabled
                      ? "cursor-not-allowed border-slate-200 text-slate-300"
                      : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                    : "border-slate-100 bg-slate-50 text-slate-400"
                } ${isSelectedRange ? "border-transparent" : ""} ${isDisabled ? "opacity-60" : ""}`}
                style={
                  isBlockedByReservation && isCurrentMonth
                    ? {
                        backgroundColor: "#fff1f2",
                        borderColor: "#fb7185",
                        color: "#9f1239",
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(244,63,94,0.18) 0 6px, rgba(255,255,255,0) 6px 12px)",
                      }
                    : isDisabled
                    ? {
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(148,163,184,0.25) 0 6px, rgba(255,255,255,0) 6px 12px)",
                        backgroundColor: "#f8fafc",
                      }
                    : isStart || isEnd
                    ? { backgroundColor: BRAND_DEEP, color: "white" }
                    : isSelectedRange
                      ? { backgroundColor: `${BRAND_SAND}80`, color: "#1f2937" }
                      : hasSoldCabins && isCurrentMonth
                        ? { backgroundColor: "#fff7ed", borderColor: "#fb923c", color: "#7c2d12" }
                      : isTodayDate
                        ? { borderColor: BRAND_DEEP }
                        : {}
                }
              >
                {date.getDate()}
                {inAvail && isCurrentMonth && !isDisabled && (
                  <span className="pointer-events-none absolute bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full" style={{ backgroundColor: `${BRAND_DEEP}55` }} />
                )}
                {hasSoldCabins && isCurrentMonth && !isDisabled && (
                  <span
                    className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "#ea580c" }}
                    title={isEnglish ? "Week already has booked cabins" : "Semaine avec cabines déjà réservées"}
                  />
                )}
                {isCurrentMonth && !isDisabled && typeof cabinsLeft === "number" && (
                  <span
                    className="pointer-events-none absolute left-1.5 top-1.5 rounded border px-1 text-[9px] font-semibold"
                    style={{
                      borderColor: cabinsLeft > 0 ? "#86efac" : "#fda4af",
                      backgroundColor: cabinsLeft > 0 ? "#f0fdf4" : "#fff1f2",
                      color: cabinsLeft > 0 ? "#14532d" : "#9f1239",
                    }}
                    title={isEnglish ? `${cabinsLeft} cabin(s) left` : `${cabinsLeft} cabine(s) restante(s)`}
                  >
                    {cabinsLeft}/{CHARTER_CRUISE_CABIN_UNITS}
                  </span>
                )}
                {isBlockedByReservation && isCurrentMonth && (
                  <span
                    className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "#e11d48" }}
                    title={isEnglish ? "Day blocked by reservation" : "Jour bloqué par réservation"}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <aside className="rounded-3xl border border-[#d7e3e8] bg-[linear-gradient(180deg,#ffffff,#f4f8fa)] p-5 shadow-[0_12px_30px_rgba(7,38,50,0.08)]">
        <h3 className="text-lg font-bold" style={{ color: BRAND_DEEP }}>
          {panelTitle}
        </h3>
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">{isEnglish ? "Arrival" : "Arrivée"}</p>
            <p className="mt-1 font-semibold text-slate-900">{startDate ?? (isEnglish ? "Not selected" : "Non sélectionnée")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">{isEnglish ? "Departure" : "Départ"}</p>
            <p className="mt-1 font-semibold text-slate-900">{endDate ?? (isEnglish ? "Not selected" : "Non sélectionnée")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">{isEnglish ? "Duration" : "Durée"}</p>
            <p className="mt-1 font-semibold text-slate-900">
              {nights > 0 ? `${nights} ${isEnglish ? "day(s)" : "jour(s)"}` : isEnglish ? "Choose your dates" : "Choisissez vos dates"}
            </p>
          </div>
          {pricePanel.kind !== "empty" && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">{isEnglish ? "Booking options" : "Options de réservation"}</p>
              <div className="mt-2 space-y-3">
                {(canChooseCabine || canChoosePrivatif) && (
                  <div className={`grid gap-2 ${canChooseCabine && canChoosePrivatif ? "grid-cols-2" : "grid-cols-1"}`}>
                    {canChooseCabine && (
                      <button
                        type="button"
                        onClick={() => setReservationMode("cabine")}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold ${reservationMode === "cabine" ? "text-white" : ""}`}
                        style={
                          reservationMode === "cabine"
                            ? { backgroundColor: BRAND_DEEP, borderColor: BRAND_DEEP }
                            : { color: BRAND_DEEP, borderColor: "#d8c1a6" }
                        }
                      >
                        {isTransat ? (isEnglish ? "Seat" : "Place") : isEnglish ? "Cabin" : "Cabine"}
                      </button>
                    )}
                    {canChoosePrivatif && (
                      <button
                        type="button"
                        onClick={() => setReservationMode("priva")}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold ${reservationMode === "priva" ? "text-white" : ""}`}
                        style={
                          reservationMode === "priva"
                            ? { backgroundColor: BRAND_DEEP, borderColor: BRAND_DEEP }
                            : { color: BRAND_DEEP, borderColor: "#d8c1a6" }
                        }
                      >
                        {isEnglish ? "Private" : "Privatif"}
                      </button>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-500">
                    {isEnglish ? "Passengers" : "Nombre de passagers"}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={maxPassengers}
                    value={passengerCount}
                    onChange={(e) =>
                      setPassengerCount(Math.max(1, Math.min(maxPassengers, Number(e.target.value || 1))))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    {isEnglish
                      ? `Maximum ${maxPassengers} passenger(s) for this product.`
                      : `Maximum ${maxPassengers} passager(s) pour ce produit.`}
                  </p>
                </div>

                {pricePanel.kind === "await_end" ? (
                  <p className="text-xs text-slate-500">
                    {isEnglish
                      ? "Select an end date to calculate the booking total."
                      : "Sélectionnez la date de fin pour calculer le total de réservation."}
                  </p>
                ) : (
                  <>
                    <p className="text-2xl font-bold" style={{ color: BRAND_DEEP }}>
                      {bookingPanel.totalEur != null
                        ? `${bookingPanel.totalEur.toLocaleString(isEnglish ? "en-GB" : "fr-FR")} €`
                        : isEnglish
                          ? "Price unavailable"
                          : "Tarif indisponible"}
                    </p>
                    <p className="text-xs text-slate-500">{bookingPanel.info}</p>
                    <a
                      href={bookingPanel.canBook ? bookingPanel.href : "#"}
                      className={`block rounded-xl px-4 py-3 text-center text-sm font-bold text-white ${bookingPanel.canBook ? "" : "pointer-events-none opacity-50"}`}
                      style={{ backgroundColor: BRAND_DEEP }}
                    >
                      {isEnglish ? "Book now" : "Réserver"}
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
          {availabilityHint && (
            <div
              className={`rounded-xl border px-3 py-2 text-xs ${
                rangeCoverage.kind === "full" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {availabilityHint}
            </div>
          )}
          {highSeasonError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900" role="alert">
              {highSeasonError}
            </div>
          )}
          {cruiseCapacityHint && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">{cruiseCapacityHint}</div>
          )}
          <p className="pt-2 text-xs text-slate-600">
            {charterPeriods.length > 0
              ? isEnglish
                ? "One booking = one published period only. Click inside the period you want; you cannot combine several weeks or days."
                : "Une réservation = une seule période publiée. Cliquez dans la période voulue ; impossible de combiner plusieurs semaines ou plusieurs journées."
              : isEnglish
                ? "Step 1: click an available date. The full availability slot is selected automatically (no partial range)."
                : "Étape 1 : cliquez sur un jour disponible. La période complète de la disponibilité est sélectionnée automatiquement (pas de sous-plage)."}
          </p>
        </div>
      </aside>
    </div>
  );
}
