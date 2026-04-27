import { useEffect, useMemo, useState } from "react";
import { CharterBookingPanel } from "./CharterBookingPanel";
import { CharterRequestModal } from "./CharterRequestModal";
import type { BookingRangeSelection, BookingStatus, BookingWeek } from "./bookingTypes";
import { STATUS_LABELS_FR, canBookWeek } from "./bookingUtils";
import "./charter-calendar.css";

type ApiDisponibilite = {
  id: number;
  debut: string;
  fin: string;
  statut: "disponible" | "reserve" | "option" | "ferme";
  destination: string;
  notePublique?: string | null;
  tarif?: number | null;
  tarifCabine?: number | null;
  tarifJourPersonne?: number | null;
  tarifJourPriva?: number | null;
  capaciteTotale?: number | null;
  cabinesReservees?: number | null;
};

type ProductFilter = "all" | "med" | "transat" | "caraibes" | "journee";

const MONTHS_FR = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];
const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DEV_FALLBACK_ENABLED =
  import.meta.env.DEV &&
  String(import.meta.env.VITE_ENABLE_BOOKING_DEV_FALLBACK || "").toLowerCase() === "true";

function monthFromIso(isoDay: string) {
  return Number(isoDay.slice(5, 7));
}

function isHighSeasonIso(isoDay: string) {
  const month = monthFromIso(isoDay);
  return month === 2 || month === 7 || month === 8 || month === 12;
}

function isSaturdayIso(isoDay: string) {
  return new Date(`${isoDay}T00:00:00.000Z`).getUTCDay() === 6;
}

function toIsoDay(dateInput: string) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function mapStatus(statut: ApiDisponibilite["statut"], booked: number, total: number): BookingStatus {
  if (statut === "reserve") return "reserved";
  if (statut === "ferme") return "blocked";
  if (statut === "option") return "option";
  if (booked > 0 && booked < total) return "partial";
  return "available";
}

function statusPriority(status: BookingStatus) {
  // Most constraining states must win when multiple slots overlap a day.
  const priorities: Record<BookingStatus, number> = {
    blocked: 0,
    private: 1,
    reserved: 2,
    option: 3,
    partial: 4,
    available: 5,
  };
  return priorities[status];
}

function toBookingWeek(row: ApiDisponibilite): BookingWeek | null {
  const startDate = toIsoDay(row.debut);
  const endDate = toIsoDay(row.fin);
  if (!startDate || !endDate) return null;
  const totalCabins = Math.max(1, row.capaciteTotale ?? 4);
  const bookedCabins = Math.max(0, row.cabinesReservees ?? 0);
  const totalPeople = totalCabins * 2;
  const bookedPeople = Math.min(totalPeople, bookedCabins * 2);

  return {
    id: `dispo-${row.id}`,
    disponibiliteId: row.id,
    startDate,
    endDate,
    destination: row.destination,
    status: mapStatus(row.statut, bookedCabins, totalCabins),
    pricePrivate: row.tarifJourPriva ?? row.tarif ?? 0,
    pricePerPerson: row.tarifJourPersonne ?? row.tarifCabine ?? row.tarif ?? 0,
    totalCabins,
    totalPeople,
    bookedCabins,
    bookedPeople,
    clientName: undefined,
    internalNote: row.notePublique || undefined,
  };
}

function normalizeForMatch(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchesProductFilter(week: BookingWeek, filter: ProductFilter) {
  if (filter === "all") return true;
  const destination = normalizeForMatch(week.destination);
  const note = normalizeForMatch(week.internalNote);
  const haystack = `${destination} ${note}`;
  if (filter === "transat") return haystack.includes("transat");
  if (filter === "caraibes") return haystack.includes("caraibe") || haystack.includes("antille");
  if (filter === "journee") return haystack.includes("journee") || haystack.includes("ciotat");
  // med
  return haystack.includes("mediterranee") || haystack.includes("corse") || haystack.includes("bastia") || haystack.includes("ajaccio");
}

export default function CharterCalendar() {
  const [weeks, setWeeks] = useState<BookingWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedStartDate, setSelectedStartDate] = useState<string | null>(null);
  const [selectedEndDate, setSelectedEndDate] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });

  const filteredWeeks = useMemo(() => weeks.filter((week) => matchesProductFilter(week, productFilter)), [weeks, productFilter]);

  const weeksByDay = useMemo(() => {
    const map = new Map<string, BookingWeek[]>();
    for (const week of filteredWeeks) {
      const start = new Date(`${week.startDate}T00:00:00.000Z`);
      const end = new Date(`${week.endDate}T00:00:00.000Z`);
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 10);
        map.set(key, [...(map.get(key) || []), week]);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    return map;
  }, [filteredWeeks]);

  const loadWeeksFromApi = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/disponibilites?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("API indisponible");
      const rows: ApiDisponibilite[] = await response.json();
      const mapped = rows
        .map(toBookingWeek)
        .filter((week): week is BookingWeek => Boolean(week))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      // Deduplicate exact same range+destination while preserving the most
      // constraining status so client calendar matches real occupancy.
      const deduped = Array.from(
        mapped
          .reduce((acc, week) => {
            const key = `${week.startDate}|${week.endDate}|${week.destination || ""}`;
            const existing = acc.get(key);
            if (!existing || statusPriority(week.status) < statusPriority(existing.status)) {
              acc.set(key, week);
            }
            return acc;
          }, new Map<string, BookingWeek>())
          .values(),
      ).sort((a, b) => a.startDate.localeCompare(b.startDate));
      setWeeks(deduped);
      if (!selectedStartDate && mapped[0]) {
        setSelectedStartDate(deduped[0].startDate);
      }
    } catch {
      if (DEV_FALLBACK_ENABLED) {
        const fallback = (await import("./bookingMockData")).bookingInitialWeeks;
        setWeeks(fallback);
        if (!selectedStartDate && fallback[0]) {
          setSelectedStartDate(fallback[0].startDate);
        }
        setLoadError("API indisponible: donnees de developpement utilisees (fallback explicite).");
      } else {
        setWeeks([]);
        setLoadError("Impossible de charger les disponibilites. Merci de reessayer.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWeeksFromApi();
  }, []);

  const getDayWeek = (date: Date) => {
    const iso = date.toISOString().slice(0, 10);
    const candidates = weeksByDay.get(iso) || [];
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) => statusPriority(a.status) - statusPriority(b.status))[0];
  };

  const selectedRange = useMemo<BookingRangeSelection | null>(() => {
    if (!selectedStartDate || !selectedEndDate) return null;
    const start = new Date(`${selectedStartDate}T00:00:00.000Z`);
    const end = new Date(`${selectedEndDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const from = start <= end ? start : end;
    const to = end >= start ? end : start;
    const days: BookingWeek[] = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const dayWeek = getDayWeek(cursor);
      if (!dayWeek || !canBookWeek(dayWeek)) return null;
      days.push(dayWeek);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const startIso = from.toISOString().slice(0, 10);
    const endIso = to.toISOString().slice(0, 10);
    const billingDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
    const uniqueDispoIds = Array.from(new Set(days.map((day) => day.disponibiliteId).filter((id): id is number => Boolean(id))));
    return {
      startDate: startIso,
      endDate: endIso,
      billingDays,
      days,
      disponibiliteId: uniqueDispoIds.length === 1 ? uniqueDispoIds[0] : undefined,
      destination: days[0]?.destination || "Croisiere Sabine",
    };
  }, [selectedEndDate, selectedStartDate, weeksByDay]);

  useEffect(() => {
    setSelectedStartDate(null);
    setSelectedEndDate(null);
    const anchorMonthByFilter: Record<ProductFilter, number> = {
      all: new Date().getUTCMonth(),
      med: 6,
      transat: 10,
      caraibes: 11,
      journee: 3,
    };
    const anchorMonth = anchorMonthByFilter[productFilter];
    const now = new Date();
    setMonth(new Date(Date.UTC(now.getUTCFullYear(), anchorMonth, 1)));
  }, [productFilter]);

  const handleRequestSubmit = async (request: {
    weekId: string;
    disponibiliteId?: number;
    mode: "private" | "cabin";
    peopleCount: number;
    fullName: string;
    email: string;
    phone: string;
    message: string;
    estimatedTotal: number;
  }) => {
    setSubmitting(true);
    setSubmitError(null);
    if (!selectedRange) return;
    const amountInCents = Math.max(0, Math.round(request.estimatedTotal * 100));
    const payload = {
      nomClient: request.fullName,
      emailClient: request.email,
      telClient: request.phone || undefined,
      nbPersonnes: request.peopleCount,
      formule: "semaine",
      destination: selectedRange.destination || "Croisiere Sabine",
      dateDebut: selectedRange.startDate,
      dateFin: selectedRange.endDate,
      montantTotal: amountInCents,
      typeReservation: request.mode === "private" ? "bateau_entier" : "cabine",
      nbCabines:
        request.mode === "private"
          ? Math.max(1, selectedRange.days[0]?.totalCabins || 4)
          : Math.max(1, Math.ceil(request.peopleCount / 2)),
      message: request.message || undefined,
      disponibiliteId: selectedRange.disponibiliteId ?? request.disponibiliteId,
    };
    try {
      const response = await fetch("/api/reservations/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Echec lors de l'envoi de la demande");
      }
      await loadWeeksFromApi();
      setMobileOpen(false);
    } catch (error: any) {
      setSubmitError(error?.message || "Echec lors de l'envoi de la demande");
    } finally {
      setSubmitting(false);
    }
  };

  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  const offset = (firstDay.getUTCDay() + 6) % 7;
  const monthDays: Array<Date | null> = [];
  for (let i = 0; i < offset; i++) monthDays.push(null);
  for (let day = 1; day <= lastDay.getUTCDate(); day++) {
    monthDays.push(new Date(Date.UTC(year, monthIndex, day)));
  }

  if (loading) {
    return <section className="charter-calendar"><p className="charter-calendar__loading">Chargement du calendrier...</p></section>;
  }

  if (!weeks.length && loadError) {
    return (
      <section className="charter-calendar">
        <p className="charter-error">{loadError}</p>
        <button type="button" className="charter-btn charter-btn--primary" onClick={() => void loadWeeksFromApi()}>
          Reessayer
        </button>
      </section>
    );
  }

  const getStatusClass = (status: BookingStatus) => `charter-status charter-status--${status}`;

  const handleDaySelect = (date: Date) => {
    const iso = date.toISOString().slice(0, 10);
    const week = getDayWeek(date);
    if (!week || !canBookWeek(week)) return;
    setSelectionError(null);
    if (!selectedStartDate || (selectedStartDate && selectedEndDate)) {
      if (isHighSeasonIso(iso) && !isSaturdayIso(iso)) {
        setSelectionError("En haute saison (juillet, août, décembre, février), le départ doit être un samedi.");
        return;
      }
      setSelectedStartDate(iso);
      setSelectedEndDate(null);
      return;
    }
    if (iso === selectedStartDate) {
      if (isHighSeasonIso(iso)) {
        setSelectionError("En haute saison, la sélection doit être du samedi au samedi.");
        return;
      }
      // 2nd click on same day => single-day range (start = end)
      setSelectedStartDate(iso);
      setSelectedEndDate(iso);
      return;
    }
    const start = selectedStartDate;
    const end = iso < selectedStartDate ? selectedStartDate : iso;
    const startCandidate = iso < selectedStartDate ? iso : selectedStartDate;
    const highSeasonRange = isHighSeasonIso(startCandidate) || isHighSeasonIso(end);
    if (highSeasonRange) {
      const startSaturday = isSaturdayIso(startCandidate);
      const endSaturday = isSaturdayIso(end);
      const spanDays = Math.round(
        (new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${startCandidate}T00:00:00.000Z`).getTime()) / 86400000,
      );
      if (!startSaturday || !endSaturday || spanDays !== 7) {
        setSelectionError("En haute saison (juillet, août, décembre, février), la sélection doit être du samedi au samedi.");
        return;
      }
    }
    if (iso < selectedStartDate) {
      setSelectedStartDate(iso);
      setSelectedEndDate(start);
    } else {
      setSelectedEndDate(iso);
    }
  };

  const selectedMonthLabel = `${MONTHS_FR[monthIndex]} ${year}`;

  return (
    <section className="charter-calendar" aria-label="Calendrier de reservation">
      <header className="charter-calendar__header">
        <span className="editorial-kicker">Calendrier des disponibilites</span>
        <h2>Reservation samedi vers samedi</h2>
        <p>Privatisation du catamaran ou reservation cabine, avec disponibilites en direct.</p>
      </header>

      {loadError && <p className="charter-calendar__warning">{loadError}</p>}
      {selectionError && <p className="charter-calendar__warning">{selectionError}</p>}

      <div className="charter-product-filter" role="tablist" aria-label="Filtrer les offres">
        {[
          { id: "all", label: "Tous" },
          { id: "med", label: "Méditerranée / Corse" },
          { id: "transat", label: "Transat" },
          { id: "caraibes", label: "Caraïbes" },
          { id: "journee", label: "Journées La Ciotat" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`charter-filter-pill ${productFilter === item.id ? "is-active" : ""}`}
            onClick={() => setProductFilter(item.id as ProductFilter)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="charter-layout">
        <div className="charter-monthly-grid">
          <div className="charter-calendar-nav">
            <button type="button" className="charter-btn charter-btn--ghost" onClick={() => setMonth(new Date(Date.UTC(year, monthIndex - 1, 1)))}>
              Mois precedent
            </button>
            <h3>{selectedMonthLabel}</h3>
            <button type="button" className="charter-btn charter-btn--ghost" onClick={() => setMonth(new Date(Date.UTC(year, monthIndex + 1, 1)))}>
              Mois suivant
            </button>
          </div>
          <div className="charter-grid-head">
            {DAY_LABELS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="charter-grid-body">
            {monthDays.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} className="charter-day charter-day--empty" />;
              const week = getDayWeek(day);
              const dayIso = day.toISOString().slice(0, 10);
              const rangeStart = selectedStartDate && selectedEndDate ? (selectedStartDate <= selectedEndDate ? selectedStartDate : selectedEndDate) : selectedStartDate;
              const rangeEnd = selectedStartDate && selectedEndDate ? (selectedStartDate >= selectedEndDate ? selectedStartDate : selectedEndDate) : selectedEndDate;
              const isStart = selectedStartDate === dayIso;
              const isEnd = selectedEndDate === dayIso;
              const inRange = Boolean(rangeStart && rangeEnd && dayIso >= rangeStart && dayIso <= rangeEnd);
              const isSelected = isStart || isEnd || inRange;
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  className={`charter-day ${isSelected ? "is-selected" : ""}`}
                  onClick={() => {
                    handleDaySelect(day);
                  }}
                >
                  <span className="charter-day__number">{day.getUTCDate()}</span>
                  {week ? (
                    <span className={getStatusClass(week.status)}>{STATUS_LABELS_FR[week.status]}</span>
                  ) : (
                    <span className="charter-day__empty">-</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <aside className="charter-sidebar" aria-label="Panneau de demande">
          <CharterBookingPanel selection={selectedRange} onSubmit={handleRequestSubmit} submitting={submitting} submitError={submitError} />
        </aside>
      </div>

      <div className="charter-mobile-cta">
        <button type="button" className="charter-btn charter-btn--primary" onClick={() => setMobileOpen(true)} disabled={!selectedRange}>
          Ouvrir la demande mobile
        </button>
      </div>

      <CharterRequestModal
        open={mobileOpen}
        selection={selectedRange}
        onClose={() => setMobileOpen(false)}
        onSubmit={handleRequestSubmit}
        submitting={submitting}
        submitError={submitError}
      />
    </section>
  );
}
