import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Anchor,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit2,
  Euro,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Search,
  Ship,
  Trash2,
  Users,
} from "lucide-react";

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
  emailClient?: string;
  telClient?: string | null;
  nbPersonnes?: number;
  disponibiliteId?: number | null;
  formule?: string;
  destination?: string;
  dateDebut: string;
  dateFin: string;
  montantTotal?: number;
  montantPaye?: number;
  typeReservation?: "bateau_entier" | "cabine" | "place" | string;
  nbCabines?: number;
  typePaiement?: "acompte" | "complet" | string;
  statutPaiement?: "en_attente" | "paye" | "echec" | "rembourse" | string;
  workflowStatut?: string;
  requestStatus?: "nouvelle" | "en_cours" | "validee" | "refusee" | "archivee" | string;
  internalComment?: string | null;
  message?: string | null;
  createdAt?: string;
}

type CalendarSelection =
  | { kind: "reservation"; reservation: Reservation }
  | { kind: "disponibilite"; disponibilite: Disponibilite }
  | null;

type StatusTone = "emerald" | "amber" | "rose" | "slate" | "blue" | "orange" | "purple";

const BRAND_DEEP = "#00384A";
const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDay(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toIsoDay(value: string | Date) {
  return parseIsoDay(value).toISOString().slice(0, 10);
}

function addDays(isoDay: string, count: number) {
  const d = parseIsoDay(`${isoDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return toIsoDay(d);
}

function monthStart(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
}

function formatDate(value: string | Date) {
  return parseIsoDay(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatShortDate(value: string | Date) {
  return parseIsoDay(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function formatMoney(cents?: number | null) {
  const value = Number(cents || 0) / 100;
  return value.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function daysBetweenInclusive(start: string, end: string) {
  return Math.max(1, Math.round((parseIsoDay(end).getTime() - parseIsoDay(start).getTime()) / DAY_MS) + 1);
}

function overlapsDay(start: string, end: string, day: string) {
  return start <= day && day <= end;
}

function statusClass(tone: StatusTone) {
  const classes: Record<StatusTone, string> = {
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    rose: "bg-rose-50 text-rose-800 border-rose-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    blue: "bg-blue-50 text-blue-800 border-blue-200",
    orange: "bg-orange-50 text-orange-800 border-orange-200",
    purple: "bg-purple-50 text-purple-800 border-purple-200",
  };
  return classes[tone];
}

function getDispoStatus(dispo: Disponibilite) {
  if (dispo.planningType === "technical_stop") return { label: "Arrêt technique", tone: "orange" as StatusTone };
  if (dispo.planningType === "maintenance") return { label: "Maintenance", tone: "purple" as StatusTone };
  if (dispo.planningType === "blocked") return { label: "Bloqué", tone: "slate" as StatusTone };
  if (dispo.statut === "disponible") return { label: "Disponible", tone: "emerald" as StatusTone };
  if (dispo.statut === "option") return { label: "Option", tone: "amber" as StatusTone };
  if (dispo.statut === "reserve") return { label: "Complet", tone: "rose" as StatusTone };
  return { label: "Fermé", tone: "slate" as StatusTone };
}

function getReservationStatus(reservation: Reservation) {
  if (reservation.requestStatus === "refusee") return { label: "Refusée", tone: "rose" as StatusTone };
  if (reservation.requestStatus === "archivee") return { label: "Archivée", tone: "slate" as StatusTone };
  if (reservation.requestStatus === "validee") return { label: "Validée", tone: "emerald" as StatusTone };
  if (reservation.requestStatus === "en_cours") return { label: "En cours", tone: "blue" as StatusTone };
  if (reservation.workflowStatut === "acompte_confirme" || reservation.workflowStatut === "solde_confirme") return { label: "Confirmée", tone: "emerald" as StatusTone };
  if (reservation.workflowStatut === "devis_emis" || reservation.workflowStatut === "contrat_envoye") return { label: "À suivre", tone: "amber" as StatusTone };
  return { label: "Nouvelle", tone: "amber" as StatusTone };
}

function reservationTypeLabel(type?: string) {
  if (type === "bateau_entier") return "Bateau entier";
  if (type === "cabine") return "Cabine";
  if (type === "place") return "Place";
  return "Non précisé";
}

function getClientName(reservation: Reservation) {
  return [reservation.prenomClient, reservation.nomClient].filter(Boolean).join(" ") || reservation.nomClient;
}

function buildCalendarDays(currentMonth: Date) {
  const start = monthStart(currentMonth);
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  const firstVisible = new Date(start.getTime() - mondayOffset * DAY_MS);
  return Array.from({ length: 42 }, (_, index) => new Date(firstVisible.getTime() + index * DAY_MS));
}

function countActiveReservations(reservations: Reservation[]) {
  return reservations.filter((r) => r.requestStatus !== "refusee" && r.requestStatus !== "archivee").length;
}

export default function AdminCalendarView({
  disponibilites,
  reservations,
  onEdit,
  onDelete,
  loading,
}: {
  disponibilites: Disponibilite[];
  reservations: Reservation[];
  onEdit: (dispo: Disponibilite) => void;
  onDelete: (id: number) => void;
  loading: boolean;
}) {
  const [currentMonth, setCurrentMonth] = useState(monthStart(new Date()));
  const [selectedDate, setSelectedDate] = useState(toIsoDay(new Date()));
  const [selection, setSelection] = useState<CalendarSelection>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "confirmed" | "new" | "blocked">("all");

  const calendarDays = useMemo(() => buildCalendarDays(currentMonth), [currentMonth]);
  const monthLabel = useMemo(
    () => currentMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }),
    [currentMonth]
  );

  const normalizedSearch = search.trim().toLowerCase();

  const filteredReservations = useMemo(() => {
    return reservations.filter((reservation) => {
      const status = getReservationStatus(reservation);
      const matchesSearch =
        !normalizedSearch ||
        [reservation.nomClient, reservation.prenomClient, reservation.emailClient, reservation.telClient, reservation.destination, reservation.formule]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && reservation.requestStatus !== "refusee" && reservation.requestStatus !== "archivee") ||
        (statusFilter === "confirmed" && (reservation.requestStatus === "validee" || status.label === "Confirmée")) ||
        (statusFilter === "new" && status.label === "Nouvelle") ||
        statusFilter === "blocked";
      return matchesSearch && matchesStatus;
    });
  }, [normalizedSearch, reservations, statusFilter]);

  const filteredDisponibilites = useMemo(() => {
    return disponibilites.filter((dispo) => {
      const status = getDispoStatus(dispo);
      const matchesSearch = !normalizedSearch || [dispo.destination, dispo.note, dispo.notePublique].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === "all" || statusFilter === "active" || statusFilter === "confirmed" || statusFilter === "new" || status.tone === "orange" || status.tone === "purple" || status.tone === "slate";
      return matchesSearch && matchesStatus;
    });
  }, [disponibilites, normalizedSearch, statusFilter]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, { dispos: Disponibilite[]; reservations: Reservation[] }>();
    for (const day of calendarDays) {
      map.set(toIsoDay(day), { dispos: [], reservations: [] });
    }
    for (const dispo of filteredDisponibilites) {
      const start = toIsoDay(dispo.debut);
      const end = toIsoDay(dispo.fin);
      for (const day of calendarDays) {
        const key = toIsoDay(day);
        if (overlapsDay(start, end, key)) map.get(key)?.dispos.push(dispo);
      }
    }
    for (const reservation of filteredReservations) {
      const start = toIsoDay(reservation.dateDebut);
      const end = toIsoDay(reservation.dateFin);
      for (const day of calendarDays) {
        const key = toIsoDay(day);
        if (overlapsDay(start, end, key)) map.get(key)?.reservations.push(reservation);
      }
    }
    return map;
  }, [calendarDays, filteredDisponibilites, filteredReservations]);

  const selectedDayEvents = eventsByDate.get(selectedDate) || { dispos: [], reservations: [] };

  const selectedReservation = selection?.kind === "reservation" ? selection.reservation : null;
  const selectedDispo = selection?.kind === "disponibilite" ? selection.disponibilite : null;
  const linkedDispo = selectedReservation?.disponibiliteId
    ? disponibilites.find((dispo) => dispo.id === selectedReservation.disponibiliteId)
    : null;
  const selectedDispoReservations = selectedDispo
    ? reservations.filter((reservation) => reservation.disponibiliteId === selectedDispo.id)
    : [];

  const stats = useMemo(() => {
    const confirmed = reservations.filter((r) => getReservationStatus(r).tone === "emerald").length;
    const pending = reservations.filter((r) => getReservationStatus(r).tone === "amber" || getReservationStatus(r).tone === "blue").length;
    const revenue = reservations.reduce((sum, r) => sum + (r.montantTotal || 0), 0);
    const blocked = disponibilites.filter((d) => d.planningType && d.planningType !== "charter").length;
    return { active: countActiveReservations(reservations), confirmed, pending, revenue, blocked };
  }, [disponibilites, reservations]);

  const openPrevMonth = () => setCurrentMonth((prev) => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() - 1, 1)));
  const openNextMonth = () => setCurrentMonth((prev) => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1)));
  const openToday = () => {
    const today = new Date();
    setCurrentMonth(monthStart(today));
    setSelectedDate(toIsoDay(today));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2" style={{ borderColor: BRAND_DEEP }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: "Réservations actives", value: stats.active, icon: Anchor },
          { label: "Confirmées", value: stats.confirmed, icon: Ship },
          { label: "À traiter", value: stats.pending, icon: Clock },
          { label: "CA demandé", value: formatMoney(stats.revenue), icon: Euro },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">{item.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-950">{item.value}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <item.icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <button onClick={openPrevMonth} className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50" aria-label="Mois précédent">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button onClick={openToday} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Aujourd'hui
                </button>
                <button onClick={openNextMonth} className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50" aria-label="Mois suivant">
                  <ChevronRight className="h-5 w-5" />
                </button>
                <h2 className="ml-2 text-2xl font-bold capitalize text-slate-950">{monthLabel}</h2>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-[240px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Client, destination, email..."
                    className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-900"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-900"
                >
                  <option value="all">Tout afficher</option>
                  <option value="active">Réservations actives</option>
                  <option value="confirmed">Confirmées</option>
                  <option value="new">Nouvelles demandes</option>
                  <option value="blocked">Technique / bloqué</option>
                </select>
              </div>
            </div>
          </div>

          <div className="p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1 border-b border-slate-200 pb-2">
              {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => (
                <div key={day} className="px-2 text-center text-xs font-bold uppercase text-slate-500">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1 pt-2">
              {calendarDays.map((day) => {
                const dateKey = toIsoDay(day);
                const isCurrentMonth = day.getUTCMonth() === currentMonth.getUTCMonth();
                const isToday = dateKey === toIsoDay(new Date());
                const isSelected = dateKey === selectedDate;
                const dayEvents = eventsByDate.get(dateKey) || { dispos: [], reservations: [] };
                const visibleReservations = dayEvents.reservations.slice(0, 2);
                const visibleDispos = dayEvents.dispos.slice(0, 2);
                const hiddenCount = Math.max(0, dayEvents.reservations.length + dayEvents.dispos.length - 4);

                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => setSelectedDate(dateKey)}
                    className={`min-h-[138px] rounded-lg border p-2 text-left transition ${
                      isSelected ? "border-blue-900 bg-blue-50/60 shadow-sm" : isCurrentMonth ? "border-slate-200 bg-white hover:border-slate-300" : "border-slate-100 bg-slate-50 text-slate-400"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${isToday ? "bg-blue-900 text-white" : "text-slate-800"}`}>
                        {day.getUTCDate()}
                      </span>
                      {dayEvents.reservations.length > 0 && (
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">{dayEvents.reservations.length}</span>
                      )}
                    </div>

                    <div className="space-y-1">
                      {visibleReservations.map((reservation) => {
                        const status = getReservationStatus(reservation);
                        return (
                          <div
                            key={`r-${reservation.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDate(dateKey);
                              setSelection({ kind: "reservation", reservation });
                            }}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold leading-tight ${statusClass(status.tone)}`}
                          >
                            <span className="block truncate">{getClientName(reservation)}</span>
                            <span className="block truncate opacity-75">{reservationTypeLabel(reservation.typeReservation)}</span>
                          </div>
                        );
                      })}

                      {visibleDispos.map((dispo) => {
                        const status = getDispoStatus(dispo);
                        return (
                          <div
                            key={`d-${dispo.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDate(dateKey);
                              setSelection({ kind: "disponibilite", disponibilite: dispo });
                            }}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold leading-tight ${statusClass(status.tone)}`}
                          >
                            <span className="block truncate">{dispo.destination}</span>
                            <span className="block truncate opacity-75">{status.label}</span>
                          </div>
                        );
                      })}

                      {hiddenCount > 0 && <div className="px-1 text-[11px] font-semibold text-slate-500">+{hiddenCount} autre(s)</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>

        <aside className="space-y-4">
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Sélection</p>
                <h3 className="mt-1 text-xl font-bold text-slate-950">{formatDate(selectedDate)}</h3>
              </div>
              <Calendar className="h-5 w-5 text-slate-400" />
            </div>

            {selectedReservation && <ReservationDetails reservation={selectedReservation} linkedDispo={linkedDispo} />}
            {selectedDispo && (
              <DisponibiliteDetails
                disponibilite={selectedDispo}
                reservations={selectedDispoReservations}
                onEdit={onEdit}
                onDelete={onDelete}
                onSelectReservation={(reservation) => setSelection({ kind: "reservation", reservation })}
              />
            )}
            {!selection && <DayDetails events={selectedDayEvents} onSelect={setSelection} />}
          </motion.div>
        </aside>
      </div>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: StatusTone }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(tone)}`}>{label}</span>;
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex gap-3 rounded-lg bg-slate-50 p-3">
      <Icon className="mt-0.5 h-4 w-4 flex-none text-slate-500" />
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
        <p className="mt-0.5 break-words text-sm font-semibold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function ReservationDetails({ reservation, linkedDispo }: { reservation: Reservation; linkedDispo?: Disponibilite | null }) {
  const status = getReservationStatus(reservation);
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge label={status.label} tone={status.tone} />
          <Badge label={reservation.statutPaiement === "paye" ? "Payé" : "Paiement en attente"} tone={reservation.statutPaiement === "paye" ? "emerald" : "amber"} />
        </div>
        <h4 className="text-2xl font-bold text-slate-950">{getClientName(reservation)}</h4>
        <p className="mt-1 text-sm font-semibold text-slate-500">Réservation #{reservation.id}</p>
      </div>

      <div className="grid gap-2">
        <DetailRow icon={Mail} label="Email" value={reservation.emailClient} />
        <DetailRow icon={Phone} label="Téléphone" value={reservation.telClient} />
        <DetailRow icon={MapPin} label="Destination" value={reservation.destination} />
        <DetailRow icon={Calendar} label="Période" value={`${formatDate(reservation.dateDebut)} → ${formatDate(reservation.dateFin)} · ${daysBetweenInclusive(toIsoDay(reservation.dateDebut), toIsoDay(reservation.dateFin))} jour(s)`} />
        <DetailRow icon={Users} label="Participants" value={`${reservation.nbPersonnes || 1} personne(s) · ${reservation.nbCabines || 1} unité(s)`} />
        <DetailRow icon={Anchor} label="Type" value={`${reservationTypeLabel(reservation.typeReservation)} · ${reservation.formule || "Formule non précisée"}`} />
        <DetailRow icon={Euro} label="Montant" value={`${formatMoney(reservation.montantTotal)} demandé · ${formatMoney(reservation.montantPaye)} payé`} />
        <DetailRow icon={Clock} label="Workflow" value={reservation.workflowStatut || reservation.requestStatus || "demande"} />
        <DetailRow icon={Ship} label="Créneau lié" value={linkedDispo ? `${linkedDispo.destination} · ${formatShortDate(linkedDispo.debut)} → ${formatShortDate(linkedDispo.fin)}` : "Aucun créneau lié"} />
      </div>

      {reservation.message && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
          <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-blue-800"><MessageSquare className="h-4 w-4" />Message client</p>
          <p className="text-sm text-blue-950">{reservation.message}</p>
        </div>
      )}

      {reservation.internalComment && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
          <p className="mb-1 text-xs font-bold uppercase text-amber-800">Note interne</p>
          <p className="text-sm text-amber-950">{reservation.internalComment}</p>
        </div>
      )}
    </div>
  );
}

function DisponibiliteDetails({
  disponibilite,
  reservations,
  onEdit,
  onDelete,
  onSelectReservation,
}: {
  disponibilite: Disponibilite;
  reservations: Reservation[];
  onEdit: (dispo: Disponibilite) => void;
  onDelete: (id: number) => void;
  onSelectReservation: (reservation: Reservation) => void;
}) {
  const status = getDispoStatus(disponibilite);
  const totalUnits = disponibilite.capaciteTotale || 4;
  const reservedUnits = disponibilite.cabinesReservees || 0;
  const remainingUnits = Math.max(0, totalUnits - reservedUnits);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge label={status.label} tone={status.tone} />
        <Badge label={`${remainingUnits}/${totalUnits} libres`} tone={remainingUnits > 0 ? "emerald" : "rose"} />
      </div>

      <div>
        <h4 className="text-2xl font-bold text-slate-950">{disponibilite.destination}</h4>
        <p className="mt-1 text-sm font-semibold text-slate-500">Créneau #{disponibilite.id}</p>
      </div>

      <div className="grid gap-2">
        <DetailRow icon={Calendar} label="Période" value={`${formatDate(disponibilite.debut)} → ${formatDate(disponibilite.fin)}`} />
        <DetailRow icon={Euro} label="Tarifs" value={[disponibilite.tarif ? `Privatif ${disponibilite.tarif.toLocaleString("fr-FR")} €` : "", disponibilite.tarifCabine ? `Cabine ${disponibilite.tarifCabine.toLocaleString("fr-FR")} €` : "", disponibilite.tarifJourPriva ? `Journée ${disponibilite.tarifJourPriva.toLocaleString("fr-FR")} €` : ""].filter(Boolean).join(" · ") || "Non renseigné"} />
        <DetailRow icon={Ship} label="Capacité" value={`${reservedUnits} réservée(s), ${remainingUnits} libre(s), ${totalUnits} total`} />
      </div>

      {disponibilite.notePublique && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-950">{disponibilite.notePublique}</div>
      )}
      {disponibilite.note && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-950">{disponibilite.note}</div>
      )}

      <div className="border-t border-slate-200 pt-4">
        <p className="mb-2 text-xs font-bold uppercase text-slate-500">Réservations liées ({reservations.length})</p>
        <div className="space-y-2">
          {reservations.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Aucune réservation liée à ce créneau.</p>}
          {reservations.map((reservation) => {
            const status = getReservationStatus(reservation);
            return (
              <button key={reservation.id} onClick={() => onSelectReservation(reservation)} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:border-blue-900 hover:bg-blue-50/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-950">{getClientName(reservation)}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">{reservation.nbPersonnes || 1} personne(s) · {formatMoney(reservation.montantTotal)}</p>
                  </div>
                  <Badge label={status.label} tone={status.tone} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2 border-t border-slate-200 pt-4">
        <button onClick={() => onEdit(disponibilite)} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-900 px-3 py-2 text-sm font-bold text-white hover:bg-blue-950">
          <Edit2 className="h-4 w-4" />
          Modifier
        </button>
        <button onClick={() => onDelete(disponibilite.id)} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100">
          <Trash2 className="h-4 w-4" />
          Supprimer
        </button>
      </div>
    </div>
  );
}

function DayDetails({ events, onSelect }: { events: { dispos: Disponibilite[]; reservations: Reservation[] }; onSelect: (selection: CalendarSelection) => void }) {
  const hasEvents = events.dispos.length > 0 || events.reservations.length > 0;
  if (!hasEvents) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
        <AlertCircle className="mx-auto mb-2 h-8 w-8 text-slate-400" />
        <p className="text-sm font-semibold text-slate-600">Aucun créneau ni réservation ce jour-là.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-bold uppercase text-slate-500">Réservations du jour</p>
        <div className="space-y-2">
          {events.reservations.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Aucune réservation.</p>}
          {events.reservations.map((reservation) => {
            const status = getReservationStatus(reservation);
            return (
              <button key={reservation.id} onClick={() => onSelect({ kind: "reservation", reservation })} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:border-blue-900 hover:bg-blue-50/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-950">{getClientName(reservation)}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">{reservationTypeLabel(reservation.typeReservation)} · {formatMoney(reservation.montantTotal)}</p>
                  </div>
                  <Badge label={status.label} tone={status.tone} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase text-slate-500">Créneaux du jour</p>
        <div className="space-y-2">
          {events.dispos.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Aucun créneau.</p>}
          {events.dispos.map((dispo) => {
            const status = getDispoStatus(dispo);
            return (
              <button key={dispo.id} onClick={() => onSelect({ kind: "disponibilite", disponibilite: dispo })} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:border-blue-900 hover:bg-blue-50/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-950">{dispo.destination}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">{formatShortDate(dispo.debut)} → {formatShortDate(dispo.fin)}</p>
                  </div>
                  <Badge label={status.label} tone={status.tone} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
