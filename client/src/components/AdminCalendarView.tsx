import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight, Plus, Edit2, Trash2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

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
  disponibiliteId?: number | null;
  dateDebut: string;
  dateFin: string;
  montantTotal: number;
  workflowStatut?: string;
  typeReservation?: string;
}

const BRAND_DEEP = "#00384A";

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

function getDayOfMonth(date: string): number {
  return new Date(date).getUTCDate();
}

function isSameDay(date1: string, date2: string): boolean {
  return new Date(date1).toISOString().slice(0, 10) === new Date(date2).toISOString().slice(0, 10);
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getFirstDayOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
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
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDispo, setSelectedDispo] = useState<Disponibilite | null>(null);
  const [showDetails, setShowDetails] = useState(false);

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

  const disposByDate = useMemo(() => {
    const map = new Map<string, Disponibilite[]>();
    disponibilites.forEach((d) => {
      const start = new Date(d.debut).toISOString().slice(0, 10);
      const end = new Date(d.fin).toISOString().slice(0, 10);
      let current = new Date(start);
      while (current.toISOString().slice(0, 10) <= end) {
        const dateKey = current.toISOString().slice(0, 10);
        if (!map.has(dateKey)) map.set(dateKey, []);
        map.get(dateKey)!.push(d);
        current.setUTCDate(current.getUTCDate() + 1);
      }
    });
    return map;
  }, [disponibilites]);

  const getDispoForDate = (date: Date) => {
    const dateKey = date.toISOString().slice(0, 10);
    return disposByDate.get(dateKey) || [];
  };

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleSelectDispo = (dispo: Disponibilite) => {
    setSelectedDispo(dispo);
    setShowDetails(true);
  };

  const selectedDispoReservations = useMemo(() => {
    if (!selectedDispo) return [];
    return reservations.filter((r) => r.disponibiliteId === selectedDispo.id);
  }, [selectedDispo, reservations]);

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
      <div className="lg:col-span-2">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6"
        >
          {/* En-tête du calendrier */}
          <div className="flex items-center justify-between mb-6">
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
              const dateKey = day.toISOString().slice(0, 10);
              const dispos = getDispoForDate(day);
              const isToday = isSameDay(dateKey, new Date().toISOString().slice(0, 10));

              return (
                <motion.button
                  key={dateKey}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => dispos.length > 0 && handleSelectDispo(dispos[0])}
                  className={`aspect-square rounded-lg border-2 p-1 transition-all relative group ${
                    isCurrentMonth
                      ? "bg-white border-slate-200 hover:border-slate-300"
                      : "bg-slate-50 border-slate-100 text-slate-400"
                  } ${isToday ? "ring-2 ring-offset-1" : ""}`}
                  style={isToday ? { ringColor: BRAND_DEEP } : {}}
                >
                  <div className="flex flex-col h-full">
                    <span className={`text-xs font-semibold ${isCurrentMonth ? "text-slate-900" : "text-slate-400"}`}>
                      {day.getDate()}
                    </span>
                    {dispos.length > 0 && (
                      <div className="flex-1 flex flex-col gap-0.5 mt-0.5 min-w-0">
                        {dispos.slice(0, 2).map((d) => (
                          <div
                            key={d.id}
                            className={`text-[9px] font-semibold px-1 py-0.5 rounded truncate border ${getStatutColor(d.statut)}`}
                          >
                            {d.destination.split(" ")[0]}
                          </div>
                        ))}
                        {dispos.length > 2 && (
                          <div className="text-[9px] text-slate-500 px-1">+{dispos.length - 2}</div>
                        )}
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
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 h-fit sticky top-6"
        >
          <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Détails du créneau
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
                {/* Statuts */}
                <div className="flex gap-2 flex-wrap">
                  <span className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${getStatutColor(selectedDispo.statut)}`}>
                    {getStatutLabel(selectedDispo.statut)}
                  </span>
                  <span className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${getPlanningTypeColor(selectedDispo.planningType)}`}>
                    {getPlanningTypeLabel(selectedDispo.planningType)}
                  </span>
                </div>

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

                  {/* Réservations */}
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
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="pt-4 border-t border-slate-200 flex gap-2">
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
                    onClick={() => {
                      onDelete(selectedDispo.id);
                      setSelectedDispo(null);
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
              <p className="text-sm text-slate-600">Sélectionnez un créneau pour voir les détails</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
