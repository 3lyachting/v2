import { useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
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
  const events = useMemo(
    () =>
      filtered.map((d) => {
        const endExclusive = parseIsoDay(toIsoDay(d.fin));
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
        return {
          id: String(d.id),
          start: toIsoDay(d.debut),
          end: endExclusive.toISOString().slice(0, 10),
          allDay: true,
          title: d.destination,
          extendedProps: { dispo: d },
          className: getBadgeClass(d),
          backgroundColor:
            d.planningType && d.planningType !== "charter"
              ? "#94a3b8"
              : d.statut === "reserve" || d.statut === "ferme"
                ? "#ef4444"
                : d.statut === "option"
                  ? "#fb923c"
                  : "#10b981",
          borderColor:
            d.planningType && d.planningType !== "charter"
              ? "#64748b"
              : d.statut === "reserve" || d.statut === "ferme"
                ? "#dc2626"
                : d.statut === "option"
                  ? "#f97316"
                  : "#059669",
        };
      }),
    [filtered]
  );

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
          <div className="rounded-2xl border bg-white p-3 sm:p-5 lg:p-6" style={{ borderColor: "#dac2a7" }}>
            <FullCalendar
              plugins={[dayGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              height="auto"
              contentHeight="auto"
              locale="fr"
              firstDay={1}
              events={events}
              eventDisplay="block"
              dayMaxEventRows={4}
              eventClick={(info) => {
                const d = info.event.extendedProps.dispo as Disponibilite | undefined;
                if (d) setSelected(d);
              }}
              dateClick={(info) => {
                const clicked = filtered.find((d) => {
                  const day = info.dateStr;
                  const start = toIsoDay(d.debut);
                  const end = toIsoDay(d.fin);
                  return day >= start && day <= end;
                });
                if (clicked) setSelected(clicked);
              }}
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "",
              }}
              buttonText={{
                today: isEnglish ? "Today" : "Aujourd'hui",
              }}
            />
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
