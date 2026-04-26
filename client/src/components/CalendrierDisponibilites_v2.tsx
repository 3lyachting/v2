import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, MapPin, Users, Anchor, Info } from "lucide-react";
import { useLocation } from "wouter";

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
const BRAND_LIGHT = "#E8D5C4";

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

function getStatusBadgeStyle(statut: Statut) {
  switch (statut) {
    case "disponible":
      return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "Disponible" };
    case "option":
      return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "Option" };
    case "reserve":
      return { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", label: "Complet" };
    case "ferme":
      return { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-600", label: "Fermé" };
  }
}

function formatDateRange(startIso: string, endIso: string, isEnglish: boolean = false) {
  const start = parseIsoDay(startIso);
  const end = parseIsoDay(endIso);
  const isSameDay = startIso === endIso;

  if (isSameDay) {
    return start.toLocaleDateString(isEnglish ? "en-GB" : "fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
  }

  const startStr = start.toLocaleDateString(isEnglish ? "en-GB" : "fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const endStr = end.toLocaleDateString(isEnglish ? "en-GB" : "fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return `${startStr} — ${endStr}`;
}

function getDurationDays(startIso: string, endIso: string) {
  const start = parseIsoDay(startIso).getTime();
  const end = parseIsoDay(endIso).getTime();
  return Math.max(1, Math.floor((end - start) / (24 * 3600 * 1000)) + 1);
}

function getProductLabel(product: Produit, isEnglish: boolean = false): string {
  const labels: Record<Produit, { fr: string; en: string }> = {
    all: { fr: "Tous", en: "All" },
    med: { fr: "Méditerranée", en: "Mediterranean" },
    transat: { fr: "Transatlantique", en: "Transatlantic" },
    caraibes: { fr: "Caraïbes", en: "Caribbean" },
    journee: { fr: "Journées", en: "Day trips" },
  };
  return isEnglish ? labels[product].en : labels[product].fr;
}

export default function CalendrierDisponibilites({ isEnglish = false }: { isEnglish?: boolean }) {
  const [, setLocation] = useLocation();
  const [dispos, setDispos] = useState<Disponibilite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Produit>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/disponibilites?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch disponibilites");
        const rows: Disponibilite[] = await res.json();
        const sorted = rows.slice().sort((a, b) => new Date(a.debut).getTime() - new Date(b.debut).getTime());
        setDispos(sorted);
      } catch {
        setDispos([]);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, []);

  const filtered = useMemo(
    () => dispos.filter((d) => (filter === "all" ? true : getProduct(d) === filter)),
    [dispos, filter]
  );

  const bookableDispos = useMemo(() => filtered.filter((d) => isBookable(d)), [filtered]);

  const handleReserve = (dispo: Disponibilite) => {
    const params = new URLSearchParams({
      dateDebut: dispo.debut,
      dateFin: dispo.fin,
      destination: dispo.destination,
    });
    setLocation(`/reservation?${params.toString()}`);
  };

  return (
    <div className="space-y-8">
      {/* Filtres */}
      <div className="flex flex-wrap gap-3 justify-center">
        {(["all", "med", "transat", "caraibes", "journee"] as Produit[]).map((product) => (
          <motion.button
            key={product}
            onClick={() => setFilter(product)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={`px-5 py-2.5 rounded-full font-semibold text-sm transition-all duration-300 border-2 ${
              filter === product
                ? "text-white border-transparent shadow-lg"
                : "border-slate-300 text-slate-700 hover:border-slate-400 bg-white"
            }`}
            style={
              filter === product
                ? { backgroundColor: BRAND_DEEP }
                : {}
            }
          >
            {getProductLabel(product, isEnglish)}
          </motion.button>
        ))}
      </div>

      {/* Contenu principal */}
      {loading ? (
        <div className="py-16 text-center">
          <div className="inline-block">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: BRAND_DEEP }}></div>
          </div>
          <p className="mt-4 text-slate-600">{isEnglish ? "Loading calendar..." : "Chargement du calendrier..."}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Anchor className="w-12 h-12 mx-auto text-slate-400 mb-4" />
          <p className="text-slate-600">{isEnglish ? "No availability found" : "Aucune disponibilité trouvée"}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence>
            {filtered.map((dispo, idx) => {
              const statusStyle = getStatusBadgeStyle(dispo.statut);
              const totalUnits = getTotalUnits(dispo);
              const reservedUnits = getReservedUnits(dispo);
              const durationDays = getDurationDays(dispo.debut, dispo.fin);
              const isExpanded = expandedId === dispo.id;
              const canBook = isBookable(dispo);

              return (
                <motion.div
                  key={dispo.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ delay: idx * 0.05 }}
                  className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow"
                >
                  <motion.button
                    onClick={() => setExpandedId(isExpanded ? null : dispo.id)}
                    className="w-full text-left p-5 sm:p-6 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* En-tête avec destination et dates */}
                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                          <h3 className="text-lg sm:text-xl font-bold text-slate-900 flex-shrink-0">
                            {dispo.destination}
                          </h3>
                          <div className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusStyle.bg} ${statusStyle.border} ${statusStyle.text}`}>
                            {statusStyle.label}
                          </div>
                        </div>

                        {/* Dates et durée */}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-slate-600 mb-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {isEnglish ? "Dates" : "Dates"}
                            </span>
                            <span className="font-medium text-slate-900">
                              {formatDateRange(dispo.debut, dispo.fin, isEnglish)}
                            </span>
                          </div>
                          <div className="hidden sm:block text-slate-300">•</div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {isEnglish ? "Duration" : "Durée"}
                            </span>
                            <span className="font-medium text-slate-900">
                              {durationDays} {isEnglish ? "days" : "jours"}
                            </span>
                          </div>
                        </div>

                        {/* Infos rapides */}
                        <div className="flex flex-wrap gap-3">
                          {dispo.tarifCabine && (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-slate-500">{isEnglish ? "Cabin:" : "Cabine :"}</span>
                              <span className="font-semibold text-slate-900">
                                {dispo.tarifCabine.toLocaleString("fr-FR")} €
                              </span>
                            </div>
                          )}
                          {dispo.tarifJourPriva && (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-slate-500">{isEnglish ? "Private:" : "Privatif :"}</span>
                              <span className="font-semibold text-slate-900">
                                {dispo.tarifJourPriva.toLocaleString("fr-FR")} €
                              </span>
                            </div>
                          )}
                          {dispo.tarif && (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-slate-500">{isEnglish ? "Week:" : "Semaine :"}</span>
                              <span className="font-semibold text-slate-900">
                                {dispo.tarif.toLocaleString("fr-FR")} €
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Chevron d'expansion */}
                      <motion.div
                        animate={{ rotate: isExpanded ? 90 : 0 }}
                        className="flex-shrink-0 pt-1"
                      >
                        <ChevronRight className="w-5 h-5 text-slate-400" />
                      </motion.div>
                    </div>
                  </motion.button>

                  {/* Contenu détaillé */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="border-t border-slate-200 bg-slate-50 px-5 sm:px-6 py-4"
                      >
                        <div className="space-y-4">
                          {/* Description */}
                          {dispo.notePublique && (
                            <div className="flex gap-3">
                              <Info className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
                              <p className="text-sm text-slate-700">{dispo.notePublique}</p>
                            </div>
                          )}

                          {/* Capacité */}
                          {totalUnits > 0 && (
                            <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200">
                              <Users className="w-5 h-5 text-slate-500" />
                              <div className="flex-1">
                                <p className="text-xs font-semibold uppercase text-slate-500">
                                  {isEnglish ? "Cabins" : "Cabines"}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                    <motion.div
                                      initial={{ width: 0 }}
                                      animate={{ width: `${(reservedUnits / totalUnits) * 100}%` }}
                                      transition={{ duration: 0.5, ease: "easeOut" }}
                                      className="h-full"
                                      style={{ backgroundColor: BRAND_DEEP }}
                                    />
                                  </div>
                                  <span className="text-sm font-semibold text-slate-900">
                                    {totalUnits - reservedUnits}/{totalUnits}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Bouton de réservation */}
                          <motion.button
                            onClick={() => handleReserve(dispo)}
                            disabled={!canBook}
                            whileHover={canBook ? { scale: 1.02 } : {}}
                            whileTap={canBook ? { scale: 0.98 } : {}}
                            className={`w-full py-3 px-4 rounded-lg font-semibold text-white transition-all flex items-center justify-center gap-2 ${
                              canBook
                                ? "text-white hover:shadow-lg"
                                : "bg-slate-300 text-slate-500 cursor-not-allowed"
                            }`}
                            style={canBook ? { backgroundColor: BRAND_DEEP } : {}}
                          >
                            {canBook ? (
                              <>
                                {isEnglish ? "Book now" : "Réserver maintenant"}
                                <ChevronRight className="w-4 h-4" />
                              </>
                            ) : (
                              isEnglish ? "Not available" : "Non disponible"
                            )}
                          </motion.button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Message si pas de résultats après filtrage */}
      {!loading && filtered.length === 0 && bookableDispos.length > 0 && (
        <div className="text-center py-8">
          <p className="text-slate-600 text-sm">
            {isEnglish
              ? "No availability in this category. Try another filter."
              : "Aucune disponibilité dans cette catégorie. Essayez un autre filtre."}
          </p>
        </div>
      )}
    </div>
  );
}
