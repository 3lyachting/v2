import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight, Plus, Edit2, Trash2, AlertCircle, User, CreditCard, Clock3, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { inferSlotType } from "@shared/slotRules";

interface Disponibilite {
  id: number;
  planningType?: "charter" | "technical_stop" | "maintenance" | "blocked";
  debut: string;
  fin: string;
  statut: "disponible" | "reserve" | "option" | "ferme";
  tarif: number | null;
  tarifCabine?: number | null;
  tarifJourPersonne?: number | null;
  tarifJourPriva?: number | null;
  destination: string;
  note: string | null;
  notePublique: string | null;
  createdAt: string;
  updatedAt: string;
  capaciteTotale?: number;
  cabinesReservees?: number;
}

interface Reservation {
  id: number;
  nomClient: string;
  prenomClient?: string | null;
  emailClient?: string | null;
  telClient?: string | null;
  disponibiliteId?: number | null;
  nbPersonnes?: number;
  nbCabines?: number;
  dateDebut: string;
  dateFin: string;
  montantTotal: number;
  montantPaye?: number;
  statutPaiement?: "en_attente" | "paye" | "echec" | "rembourse";
  typePaiement?: "acompte" | "complet";
  bookingOrigin?: "direct" | "clicknboat" | "skippair" | "samboat";
  message?: string | null;
  workflowStatut?: string;
  typeReservation?: string;
  requestStatus?: "nouvelle" | "en_cours" | "validee" | "refusee" | "archivee";
}

const BRAND_DEEP = "#00384A";
const BRAND_SAND = "#DCC8A2";

function getStatutColor(statut: string) {
  switch (statut) {
    case "disponible":
      return "bg-emerald-100 border-emerald-300 text-emerald-900";
    case "option":
      return "bg-amber-100 border-amber-300 text-amber-900";
    case "reserve":
      return "bg-rose-100 border-rose-300 text-rose-900";
    case "ferme":
      return "bg-slate-100 border-slate-300 text-slate-900";
    default:
      return "bg-slate-100 border-slate-300 text-slate-900";
  }
}

function getPlanningTypeColor(type?: string) {
  switch (type) {
    case "technical_stop":
      return "bg-orange-100 border-orange-300 text-orange-900";
    case "maintenance":
      return "bg-purple-100 border-purple-300 text-purple-900";
    case "blocked":
      return "bg-red-100 border-red-300 text-red-900";
    default:
      return "bg-blue-100 border-blue-300 text-blue-900";
  }
}

function getStatutLabel(statut: string) {
  const labels: Record<string, string> = {
    disponible: "Disponible",
    option: "Option",
    reserve: "Complet",
    ferme: "Fermé",
  };
  return labels[statut] || statut;
}

function getPlanningTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    charter: "Croisière",
    technical_stop: "Arrêt technique",
    maintenance: "Maintenance",
    blocked: "Bloqué",
  };
  return labels[type || "charter"] || "Croisière";
}

function getSlotTypeLabel(dispo: Disponibilite) {
  const slotType = inferSlotType(dispo as any);
  const labels: Record<string, string> = {
    day_private: "Journée privative",
    week_charter: "Semaine charter",
    transat_outbound: "Transat aller",
    transat_return: "Transat retour",
    caribbean_week: "Semaine Caraïbes",
    other: "Autre",
  };
  return labels[slotType] || "Autre";
}

function getDayOfMonth(date: string): number {
  return new Date(date).getUTCDate();
}

function toIsoDay(value?: string | null): string {
  if (!value) return "";
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function toLocalIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isSameDay(date1: string, date2: string): boolean {
  return date1 === date2;
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getFirstDayOfMonth(date: Date): number {
  // Align calendar grid with Monday-first headers (Lun -> Dim).
  return (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7;
}

export default function AdminCalendarView({
  disponibilites,
  reservations,
  onEdit,
  onDelete,
  onCreateSlot,
  onCreateReservation,
  onEditReservation,
  loading,
}: {
  disponibilites: Disponibilite[];
  reservations: Reservation[];
  onEdit: (dispo: Disponibilite) => void;
  onDelete: (id: number) => Promise<boolean>;
  onCreateSlot: () => void;
  onCreateReservation: (dispo: Disponibilite) => void;
  onEditReservation: (reservationId: number) => void;
  loading: boolean;
}) {
  const [calendarFilterMode, setCalendarFilterMode] = useState<"all" | "booking_only">("all");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDispo, setSelectedDispo] = useState<Disponibilite | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [reservationModal, setReservationModal] = useState<Reservation | null>(null);

  const monthLabel = useMemo(() => {
    return currentMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }, [currentMonth]);

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(currentMonth);
    const firstDay = getFirstDayOfMonth(currentMonth);
    const days: (Date | null)[] = [];

    // Jours du mois précédent
    for (let i = firstDay - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      days.push(date);
    }

    // Jours du mois courant
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    // Jours du mois suivant
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push(new Date(year, month + 1, i));
    }

    return days;
  }, [currentMonth]);

  const isReservationOrRequest = (reservation: Reservation) => {
    const request = reservation.requestStatus;
    const workflow = String(reservation.workflowStatut || "");
    const isRequest = request === "nouvelle" || request === "en_cours" || workflow === "demande";
    const isReservation =
      request === "validee" ||
      ["validee_owner", "devis_accepte", "contrat_envoye", "contrat_signe", "acompte_confirme", "solde_confirme"].includes(workflow);
    return isRequest || isReservation;
  };

  const filteredReservations = useMemo(
    () => (calendarFilterMode === "all" ? reservations : reservations.filter(isReservationOrRequest)),
    [reservations, calendarFilterMode],
  );

  const filteredDisponibilites = useMemo(() => {
    if (calendarFilterMode === "all") return disponibilites;
    const reservationLinkedIds = new Set(
      filteredReservations.map((r) => r.disponibiliteId).filter((id): id is number => typeof id === "number"),
    );
    return disponibilites.filter((d) => d.statut === "reserve" || d.statut === "option" || reservationLinkedIds.has(d.id));
  }, [disponibilites, filteredReservations, calendarFilterMode]);

  const disposByDate = useMemo(() => {
    const map = new Map<string, Disponibilite[]>();
    filteredDisponibilites.forEach((d) => {
      const start = toIsoDay(d.debut);
      const end = toIsoDay(d.fin);
      if (!start || !end) return;
      const isSingleDay = start === end;
      let current = new Date(start);
      while (current.toISOString().slice(0, 10) < end || (isSingleDay && current.toISOString().slice(0, 10) === end)) {
        const dateKey = current.toISOString().slice(0, 10);
        if (!map.has(dateKey)) map.set(dateKey, []);
        map.get(dateKey)!.push(d);
        current.setUTCDate(current.getUTCDate() + 1);
      }
    });
    return map;
  }, [filteredDisponibilites]);

  const reservationsByDate = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    filteredReservations.forEach((reservation) => {
      const start = toIsoDay(reservation.dateDebut);
      const end = toIsoDay(reservation.dateFin);
      if (!start || !end) return;
      const isSingleDay = start === end;
      let current = new Date(start);
      while (current.toISOString().slice(0, 10) < end || (isSingleDay && current.toISOString().slice(0, 10) === end)) {
        const key = current.toISOString().slice(0, 10);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(reservation);
        current.setUTCDate(current.getUTCDate() + 1);
      }
    });
    return map;
  }, [filteredReservations]);

  const getDispoForDate = (date: Date) => {
    const dateKey = toLocalIsoDay(date);
    return disposByDate.get(dateKey) || [];
  };

  const statusPriority: Record<Disponibilite["statut"], number> = {
    reserve: 0,
    option: 1,
    ferme: 2,
    disponible: 3,
  };

  const pickPrimaryDispo = (items: Disponibilite[]) =>
    [...items].sort((a, b) => statusPriority[a.statut] - statusPriority[b.statut])[0] || null;

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleSelectDispo = (dispo: Disponibilite, dayKey?: string) => {
    setSelectedDispo(dispo);
    if (dayKey) setSelectedDayKey(dayKey);
    if (dayKey) {
      const linkedReservation = (reservationsByDate.get(dayKey) || []).find((r) => r.disponibiliteId === dispo.id) || null;
      setSelectedReservation(linkedReservation);
    } else {
      setSelectedReservation(null);
    }
  };

  const handleSelectReservation = (reservation: Reservation, dayKey?: string) => {
    const key = dayKey || toIsoDay(reservation.dateDebut);
    if (key) setSelectedDayKey(key);
    setSelectedReservation(reservation);
    setReservationModal(reservation);
    const linkedDispo = reservation.disponibiliteId
      ? filteredDisponibilites.find((dispo) => dispo.id === reservation.disponibiliteId) || null
      : null;
    setSelectedDispo(linkedDispo);
  };

  const selectedDayDispos = useMemo(() => {
    if (!selectedDayKey) return selectedDispo ? [selectedDispo] : [];
    return disposByDate.get(selectedDayKey) || [];
  }, [disposByDate, selectedDayKey, selectedDispo]);

  const selectedDispoReservations = useMemo(() => {
    if (!selectedDayDispos.length) return [];
    const dispoIds = new Set(selectedDayDispos.map((d) => d.id));
    return filteredReservations.filter((r) => r.disponibiliteId && dispoIds.has(r.disponibiliteId));
  }, [selectedDayDispos, filteredReservations]);

  const selectedDayReservations = useMemo(() => {
    if (!selectedDayKey) return [];
    return reservationsByDate.get(selectedDayKey) || [];
  }, [reservationsByDate, selectedDayKey]);

  const getOriginLabel = (origin?: Reservation["bookingOrigin"]) => {
    if (origin === "clicknboat") return "ClicknBoat";
    if (origin === "skippair") return "Skippair";
    if (origin === "samboat") return "Samboat";
    return "Direct";
  };

  const getRequestStatusLabel = (status?: Reservation["requestStatus"]) => {
    if (status === "en_cours") return "En cours";
    if (status === "validee") return "Validée";
    if (status === "refusee") return "Refusée";
    if (status === "archivee") return "Archivée";
    return "Nouvelle";
  };

  const getRequestStatusClass = (status?: Reservation["requestStatus"]) => {
    if (status === "validee") return "bg-emerald-100 text-emerald-800 border-emerald-300";
    if (status === "refusee") return "bg-rose-100 text-rose-800 border-rose-300";
    if (status === "archivee") return "bg-slate-200 text-slate-700 border-slate-300";
    if (status === "en_cours") return "bg-cyan-100 text-cyan-900 border-cyan-300";
    return "bg-amber-100 text-amber-900 border-amber-300";
  };

  const getPaymentStatusLabel = (status?: Reservation["statutPaiement"]) => {
    if (status === "paye") return "Payé";
    if (status === "echec") return "Échec";
    if (status === "rembourse") return "Remboursé";
    return "En attente";
  };

  const getPaymentStatusClass = (status?: Reservation["statutPaiement"]) => {
    if (status === "paye") return "bg-emerald-100 text-emerald-800 border-emerald-300";
    if (status === "echec") return "bg-rose-100 text-rose-800 border-rose-300";
    if (status === "rembourse") return "bg-slate-100 text-slate-800 border-slate-300";
    return "bg-amber-100 text-amber-900 border-amber-300";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: BRAND_DEEP }}></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendrier */}
      <div className="lg:col-span-2 min-w-0">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6"
        >
          {/* En-tête du calendrier */}
          <div className="mb-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  onClick={() => setCalendarFilterMode("all")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    calendarFilterMode === "all" ? "text-white shadow-sm" : "text-slate-600 hover:bg-white"
                  }`}
                  style={calendarFilterMode === "all" ? { backgroundColor: BRAND_DEEP } : undefined}
                >
                  Tout
                </button>
                <button
                  onClick={() => setCalendarFilterMode("booking_only")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    calendarFilterMode === "booking_only" ? "text-white shadow-sm" : "text-slate-600 hover:bg-white"
                  }`}
                  style={calendarFilterMode === "booking_only" ? { backgroundColor: BRAND_DEEP } : undefined}
                >
                  Réservations + demandes
                </button>
              </div>
              <button
                onClick={onCreateSlot}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                Nouvelle période
              </button>
            </div>
            <div className="flex items-center justify-between">
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={handlePrevMonth}
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-slate-700" />
              </motion.button>
              <h2 className="text-xl font-bold text-slate-900 capitalize">{monthLabel}</h2>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleNextMonth}
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <ChevronRight className="w-5 h-5 text-slate-700" />
              </motion.button>
            </div>
          </div>

          {/* Jours de la semaine */}
          <div className="grid grid-cols-7 gap-2 mb-3">
            {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => (
              <div key={day} className="text-center text-xs font-semibold text-slate-500 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Grille du calendrier */}
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} className="aspect-square" />;

              const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
              const dateKey = toLocalIsoDay(day);
              const dispos = getDispoForDate(day);
              const primaryDispo = pickPrimaryDispo(dispos);
              const isToday = isSameDay(dateKey, toLocalIsoDay(new Date()));
              const dayReservations = reservationsByDate.get(dateKey) || [];
              const primaryReservation = dayReservations[0] || null;
              const reservationLabel = primaryReservation
                ? `${primaryReservation.prenomClient ? `${primaryReservation.prenomClient} ` : ""}${primaryReservation.nomClient || ""}`.trim()
                : null;
              const hasSelectedDispo = Boolean(selectedDispo && dispos.some((item) => item.id === selectedDispo.id));
              const hasSelectedReservation = Boolean(selectedReservation && dayReservations.some((item) => item.id === selectedReservation.id));

              return (
                <motion.button
                  key={dateKey}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => primaryDispo && handleSelectDispo(primaryDispo, dateKey)}
                  className={`aspect-square rounded-lg border-2 p-1 transition-all relative group ${
                    isCurrentMonth
                      ? "bg-white border-slate-200 hover:border-slate-300"
                      : "bg-slate-50 border-slate-100 text-slate-400"
                  } ${isToday ? "ring-2 ring-offset-1" : ""} ${hasSelectedDispo || hasSelectedReservation ? "ring-2 ring-offset-1" : ""}`}
                  style={isToday ? ({ ["--tw-ring-color" as any]: BRAND_DEEP } as any) : undefined}
                >
                  <div className="flex flex-col h-full">
                    <span className={`text-xs font-semibold ${isCurrentMonth ? "text-slate-900" : "text-slate-400"}`}>
                      {day.getDate()}
                    </span>
                    {primaryDispo && (
                      <div className="flex-1 flex flex-col gap-0.5 mt-0.5 min-w-0">
                        <div className={`text-[9px] font-semibold px-1 py-0.5 rounded truncate border ${getStatutColor(primaryDispo.statut)}`}>
                          {reservationLabel || primaryDispo.destination.split(" ")[0]}
                        </div>
                        {dispos.length > 1 && <div className="text-[9px] text-slate-500 px-1">{dispos.length} périodes</div>}
                      </div>
                    )}
                    {dayReservations.length > 0 && (
                      <div className="mt-1 rounded-md border px-1 py-0.5 text-[9px] font-semibold truncate" style={{ borderColor: "#B8975F", backgroundColor: "#F9F2E5", color: "#5B3D14" }}>
                        {dayReservations.length} résa{dayReservations.length > 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* Légende */}
          <div className="mt-6 pt-6 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-500 mb-3 uppercase">Légende</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Disponible", color: "bg-emerald-100 border-emerald-300" },
                { label: "Option", color: "bg-amber-100 border-amber-300" },
                { label: "Complet", color: "bg-rose-100 border-rose-300" },
                { label: "Fermé", color: "bg-slate-100 border-slate-300" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded border ${item.color}`}></div>
                  <span className="text-xs text-slate-600">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Panneau de détails */}
      <div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-xl border shadow-sm p-6 h-fit sticky top-6"
          style={{ background: "linear-gradient(180deg,#ffffff 0%,#f6f9fa 55%,#f7f0e5 100%)", borderColor: "#D6E2E7" }}
        >
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: BRAND_DEEP }}>
            <Calendar className="w-5 h-5" style={{ color: BRAND_DEEP }} />
            Détails réservation / période
          </h3>

          {selectedDispo ? (
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedDispo.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="flex gap-2 flex-wrap">
                  <span className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${getStatutColor(selectedDispo.statut)}`}>
                    {getStatutLabel(selectedDispo.statut)}
                  </span>
                  <span className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${getPlanningTypeColor(selectedDispo.planningType)}`}>
                    {getPlanningTypeLabel(selectedDispo.planningType)}
                  </span>
                  <span className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-cyan-50 text-cyan-800 border-cyan-200">
                    {getSlotTypeLabel(selectedDispo)}
                  </span>
                </div>

                {selectedDayReservations.length > 0 && (
                  <div className="pt-3 border-t border-slate-200">
                    <p className="text-xs uppercase font-semibold text-slate-500 mb-2">
                      Réservations du jour ({selectedDayReservations.length})
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {selectedDayReservations.map((reservation) => {
                        const active = selectedReservation?.id === reservation.id;
                        return (
                          <button
                            key={reservation.id}
                            onClick={() => handleSelectReservation(reservation, selectedDayKey || undefined)}
                            className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                              active ? "border-amber-400 bg-amber-50" : "border-slate-200 hover:bg-white"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-semibold text-slate-900 truncate">
                                {reservation.prenomClient ? `${reservation.prenomClient} ` : ""}
                                {reservation.nomClient}
                              </p>
                              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${getRequestStatusClass(reservation.requestStatus)}`}>
                                {getRequestStatusLabel(reservation.requestStatus)}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-600 truncate">
                              {new Date(reservation.dateDebut).toLocaleDateString("fr-FR", { timeZone: "UTC" })} →{" "}
                              {new Date(reservation.dateFin).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedDayDispos.length > 1 && (
                  <div className="pt-3 border-t border-slate-200">
                    <p className="text-xs uppercase font-semibold text-slate-500 mb-2">Périodes du jour ({selectedDayDispos.length})</p>
                    <div className="space-y-2">
                      {selectedDayDispos.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setSelectedDispo(d)}
                          className={`w-full text-left p-2 rounded border transition-colors ${
                            selectedDispo?.id === d.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-800">{d.destination}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatutColor(d.statut)}`}>
                              {getStatutLabel(d.statut)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Infos principales */}
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs uppercase font-semibold text-slate-500">Destination</p>
                    <p className="font-semibold text-slate-900 mt-1">{selectedDispo.destination}</p>
                  </div>

                  <div>
                    <p className="text-xs uppercase font-semibold text-slate-500">Période</p>
                    <p className="font-semibold text-slate-900 mt-1">
                      {new Date(selectedDispo.debut).toLocaleDateString("fr-FR", { timeZone: "UTC" })} →{" "}
                      {new Date(selectedDispo.fin).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
                    </p>
                  </div>

                  {/* Tarifs */}
                  {(selectedDispo.tarif || selectedDispo.tarifCabine || selectedDispo.tarifJourPriva) && (
                    <div className="pt-3 border-t border-slate-200">
                      <p className="text-xs uppercase font-semibold text-slate-500 mb-2">Tarifs</p>
                      <div className="space-y-1">
                        {selectedDispo.tarif && (
                          <p className="text-sm text-slate-700">
                            Semaine: <span className="font-semibold">{selectedDispo.tarif.toLocaleString("fr-FR")} €</span>
                          </p>
                        )}
                        {selectedDispo.tarifCabine && (
                          <p className="text-sm text-slate-700">
                            Cabine: <span className="font-semibold">{selectedDispo.tarifCabine.toLocaleString("fr-FR")} €</span>
                          </p>
                        )}
                        {selectedDispo.tarifJourPriva && (
                          <p className="text-sm text-slate-700">
                            Privatif: <span className="font-semibold">{selectedDispo.tarifJourPriva.toLocaleString("fr-FR")} €</span>
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Capacité */}
                  {selectedDispo.capaciteTotale && (
                    <div className="pt-3 border-t border-slate-200">
                      <p className="text-xs uppercase font-semibold text-slate-500 mb-2">Cabines</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${((selectedDispo.cabinesReservees || 0) / selectedDispo.capaciteTotale) * 100}%`,
                              backgroundColor: BRAND_DEEP,
                            }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-slate-900">
                          {(selectedDispo.capaciteTotale - (selectedDispo.cabinesReservees || 0))}/{selectedDispo.capaciteTotale}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Note publique */}
                  {selectedDispo.notePublique && (
                    <div className="pt-3 border-t border-slate-200 p-3 bg-blue-50 rounded-lg">
                      <p className="text-xs font-semibold text-blue-700 mb-1">📝 Note publique</p>
                      <p className="text-xs text-blue-600">{selectedDispo.notePublique}</p>
                    </div>
                  )}

                  {/* Réservations liées à la période */}
                  {selectedDispoReservations.length > 0 && (
                    <div className="pt-3 border-t border-slate-200">
                      <p className="text-xs uppercase font-semibold text-slate-500 mb-2">
                        Réservations ({selectedDispoReservations.length})
                      </p>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {selectedDispoReservations.map((r) => (
                          <div key={r.id} className="p-2 bg-slate-50 rounded border border-slate-200">
                            <p className="text-xs font-semibold text-slate-900">{r.nomClient}</p>
                            <p className="text-xs text-slate-600 mt-0.5">{r.workflowStatut || "demande"}</p>
                            <button
                              onClick={() => onEditReservation(r.id)}
                              className="mt-2 px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-300 text-slate-700 hover:bg-white"
                            >
                              Modifier la résa
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedReservation && (
                    <div className="pt-3 border-t border-slate-200 space-y-3">
                      <p className="text-xs uppercase font-semibold mb-1" style={{ color: BRAND_DEEP }}>
                        Fiche réservation #{selectedReservation.id}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="rounded-lg border p-2.5 bg-white/80 border-slate-200">
                          <p className="text-[11px] uppercase font-semibold text-slate-500 flex items-center gap-1">
                            <User className="w-3.5 h-3.5" /> Client
                          </p>
                          <p className="text-sm font-semibold text-slate-900 mt-1">
                            {selectedReservation.prenomClient ? `${selectedReservation.prenomClient} ` : ""}
                            {selectedReservation.nomClient}
                          </p>
                          {selectedReservation.emailClient && <p className="text-xs text-slate-600 mt-1">{selectedReservation.emailClient}</p>}
                          {selectedReservation.telClient && <p className="text-xs text-slate-600">{selectedReservation.telClient}</p>}
                        </div>
                        <div className="rounded-lg border p-2.5 bg-white/80 border-slate-200">
                          <p className="text-[11px] uppercase font-semibold text-slate-500 flex items-center gap-1">
                            <Clock3 className="w-3.5 h-3.5" /> Dates / heures
                          </p>
                          <p className="text-sm font-semibold text-slate-900 mt-1">
                            {new Date(selectedReservation.dateDebut).toLocaleDateString("fr-FR", { timeZone: "UTC" })} →{" "}
                            {new Date(selectedReservation.dateFin).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
                          </p>
                          <p className="text-xs text-slate-600 mt-1">{selectedReservation.typeReservation || "Type non renseigné"}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${getRequestStatusClass(selectedReservation.requestStatus)}`}>
                          Demande: {getRequestStatusLabel(selectedReservation.requestStatus)}
                        </span>
                        <span className="px-2.5 py-1 rounded-full border text-xs font-semibold bg-blue-100 text-blue-900 border-blue-300">
                          Workflow: {selectedReservation.workflowStatut || "demande"}
                        </span>
                        <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${getPaymentStatusClass(selectedReservation.statutPaiement)}`}>
                          Paiement: {getPaymentStatusLabel(selectedReservation.statutPaiement)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border p-2.5 border-slate-200 bg-white/80">
                          <p className="text-[11px] uppercase font-semibold text-slate-500">Montant total</p>
                          <p className="text-sm font-bold text-slate-900 mt-1">
                            {(Number(selectedReservation.montantTotal || 0) / 100).toLocaleString("fr-FR")} €
                          </p>
                        </div>
                        <div className="rounded-lg border p-2.5 border-slate-200 bg-white/80">
                          <p className="text-[11px] uppercase font-semibold text-slate-500">Déjà payé</p>
                          <p className="text-sm font-bold text-slate-900 mt-1">
                            {(Number(selectedReservation.montantPaye || 0) / 100).toLocaleString("fr-FR")} €
                          </p>
                        </div>
                        <div className="rounded-lg border p-2.5 border-slate-200 bg-white/80">
                          <p className="text-[11px] uppercase font-semibold text-slate-500">Personnes / cabines</p>
                          <p className="text-sm font-semibold text-slate-900 mt-1">
                            {selectedReservation.nbPersonnes || 0} pers. • {selectedReservation.nbCabines || 0} cab.
                          </p>
                        </div>
                        <div className="rounded-lg border p-2.5 border-slate-200 bg-white/80">
                          <p className="text-[11px] uppercase font-semibold text-slate-500">Origine</p>
                          <p className="text-sm font-semibold text-slate-900 mt-1">{getOriginLabel(selectedReservation.bookingOrigin)}</p>
                        </div>
                      </div>

                      {selectedReservation.message && (
                        <div className="rounded-lg border p-2.5" style={{ borderColor: BRAND_SAND, backgroundColor: "#FFF8EE" }}>
                          <p className="text-[11px] uppercase font-semibold flex items-center gap-1" style={{ color: "#6D552A" }}>
                            <Mail className="w-3.5 h-3.5" /> Message client
                          </p>
                          <p className="text-xs mt-1" style={{ color: "#5B3D14" }}>
                            {selectedReservation.message}
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => onEditReservation(selectedReservation.id)}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white"
                          style={{ backgroundColor: BRAND_DEEP }}
                        >
                          <Edit2 className="w-4 h-4" />
                          Modifier la résa
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="pt-4 border-t border-slate-200 flex gap-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onCreateReservation(selectedDispo)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors text-sm font-semibold"
                  >
                    <Plus className="w-4 h-4" />
                    Nouvelle résa
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onEdit(selectedDispo)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-sm font-semibold"
                  >
                    <Edit2 className="w-4 h-4" />
                    Modifier
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={async () => {
                      const deleted = await onDelete(selectedDispo.id);
                      if (deleted) setSelectedDispo(null);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors text-sm font-semibold"
                  >
                    <Trash2 className="w-4 h-4" />
                    Supprimer
                  </motion.button>
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="text-center py-8">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-600">Sélectionnez une période pour voir les détails</p>
            </div>
          )}
        </motion.div>
      </div>

      <AnimatePresence>
        {reservationModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            onClick={() => setReservationModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fiche réservation</p>
                  <h4 className="text-lg font-bold text-slate-900">
                    #{reservationModal.id} — {reservationModal.prenomClient ? `${reservationModal.prenomClient} ` : ""}
                    {reservationModal.nomClient}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setReservationModal(null)}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-[11px] uppercase text-slate-500">Période</p>
                  <p className="font-semibold text-slate-900">
                    {new Date(reservationModal.dateDebut).toLocaleDateString("fr-FR", { timeZone: "UTC" })} →{" "}
                    {new Date(reservationModal.dateFin).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-[11px] uppercase text-slate-500">Type</p>
                  <p className="font-semibold text-slate-900">{reservationModal.typeReservation || "Non renseigné"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-[11px] uppercase text-slate-500">Montant</p>
                  <p className="font-semibold text-slate-900">
                    {(Number(reservationModal.montantTotal || 0) / 100).toLocaleString("fr-FR")} €
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-[11px] uppercase text-slate-500">Cabines / personnes</p>
                  <p className="font-semibold text-slate-900">
                    {reservationModal.nbCabines || 0} cab. • {reservationModal.nbPersonnes || 0} pers.
                  </p>
                </div>
              </div>
              {reservationModal.emailClient && (
                <p className="mt-3 text-sm text-slate-700">
                  <span className="font-semibold">Email :</span> {reservationModal.emailClient}
                </p>
              )}
              {reservationModal.telClient && (
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-semibold">Téléphone :</span> {reservationModal.telClient}
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    onEditReservation(reservationModal.id);
                    setReservationModal(null);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white"
                  style={{ backgroundColor: BRAND_DEEP }}
                >
                  <Edit2 className="h-4 w-4" />
                  Modifier la résa
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
