/*
 * DESIGN: Charte Sabine Sailing
 * Page d'administration — Gestion du calendrier
 * Couleurs: Bleu marine + Teal + Blanc
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Edit2, Trash2, Calendar, LogOut, Anchor, CreditCard, Check, Clock, X, Link2, FileText, Users, Wrench, ChevronLeft, ChevronRight, MapPinned } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ConfigIcal from "@/components/ConfigIcal";
import BackofficeOps from "@/components/BackofficeOps";
import AdminCalendarView from "@/components/AdminCalendarView";
import InventoryManager from "@/components/InventoryManager";
import SeasonPricingManager from "@/components/SeasonPricingManager";
import logoSabine from "/logo-sabine.png";

interface Reservation {
  id: number;
  nomClient: string;
  prenomClient?: string | null;
  emailClient: string;
  telClient: string | null;
  nbPersonnes: number;
  disponibiliteId?: number | null;
  formule: string;
  destination: string;
  dateDebut: string;
  dateFin: string;
  montantTotal: number;
  montantPaye: number;
  typeReservation?: "bateau_entier" | "cabine" | "place";
  nbCabines?: number;
  typePaiement: "acompte" | "complet";
  statutPaiement: "en_attente" | "paye" | "echec" | "rembourse";
  workflowStatut?:
    | "demande"
    | "refusee"
    | "validee_owner"
    | "devis_emis"
    | "devis_accepte"
    | "contrat_envoye"
    | "contrat_signe"
    | "acompte_attente"
    | "acompte_confirme"
    | "facture_emise"
    | "solde_attendu"
    | "solde_confirme";
  requestStatus?: "nouvelle" | "en_cours" | "validee" | "refusee" | "archivee";
  internalComment?: string | null;
  archivedAt?: string | null;
  acompteMontant?: number;
  soldeMontant?: number;
  soldeEcheanceAt?: string | null;
  message: string | null;
  createdAt: string;
}

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
}

interface CabinesReservees {
  id: number;
  disponibiliteId: number;
  nbReservees: number;
  nbTotal: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

type ReservationFormData = Partial<Reservation> & {
  heureDebut?: string;
  heureFin?: string;
};

export default function Admin() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const [tab, setTab] = useState<"disponibilites" | "reservations" | "finances" | "config" | "documents" | "equipage" | "maintenance" | "pricing" | string>("disponibilites");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [disponibilites, setDisponibilites] = useState<Disponibilite[]>([]);
  const [cabinesMap, setCabinesMap] = useState<Record<number, CabinesReservees>>({});
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingCabinesId, setEditingCabinesId] = useState<number | null>(null);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [searchDispo, setSearchDispo] = useState("");
  const [filterStatut, setFilterStatut] = useState<"tous" | "disponible" | "reserve" | "option" | "ferme">("tous");
  const [filterPlanningType, setFilterPlanningType] = useState<"tous" | "charter" | "technical_stop" | "maintenance" | "blocked">("tous");
  const [calendarViewMode, setCalendarViewMode] = useState<"list" | "calendar">("calendar");
  const [calendarMonth, setCalendarMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedCalendarDispo, setSelectedCalendarDispo] = useState<Disponibilite | null>(null);
  const [showCabinesForm, setShowCabinesForm] = useState(false);
  const [showReservationForm, setShowReservationForm] = useState(false);
  const [reservationActionLoadingId, setReservationActionLoadingId] = useState<number | null>(null);
  const [reservationActionMessage, setReservationActionMessage] = useState("");
  const [calendarAudit, setCalendarAudit] = useState<{
    summary?: { reservationsWithoutSlot?: number; duplicateRanges?: number };
    reservationsWithoutSlot?: number[];
    duplicateRanges?: { range: string; ids: number[] }[];
  } | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [reservationDocsMap, setReservationDocsMap] = useState<
    Record<number, { quoteUrl: string | null; contractUrl: string | null }>
  >({});
  const [cabinesFormData, setCabinesFormData] = useState({ nbReservees: 0, nbTotal: 4, notes: "" });
  const [reservationFormData, setReservationFormData] = useState<ReservationFormData>({
    nomClient: "",
    prenomClient: "",
    emailClient: "",
    telClient: "",
    nbPersonnes: 1,
    formule: "",
    destination: "",
    dateDebut: "",
    dateFin: "",
    montantTotal: 0,
    typeReservation: "cabine",
    nbCabines: 1,
    heureDebut: "00:00",
    heureFin: "00:00",
    statutPaiement: "en_attente",
    workflowStatut: "demande",
    requestStatus: "nouvelle",
    internalComment: "",
  });

  const redirectToLogin = () => {
    window.location.href = "/admin/login";
  };
  const getDefaultReservationFormData = (): ReservationFormData => ({
    nomClient: "",
    prenomClient: "",
    emailClient: "",
    telClient: "",
    nbPersonnes: 1,
    formule: "semaine",
    destination: "La Ciotat",
    dateDebut: "",
    dateFin: "",
    montantTotal: 0,
    typeReservation: "bateau_entier",
    nbCabines: 1,
    heureDebut: "09:00",
    heureFin: "17:00",
    statutPaiement: "en_attente",
    workflowStatut: "demande",
    requestStatus: "nouvelle",
    internalComment: "",
  });

  const getRequestStatusLabel = (status?: Reservation["requestStatus"]) => {
    switch (status) {
      case "en_cours":
        return "En cours";
      case "validee":
        return "Validée";
      case "refusee":
        return "Refusée";
      case "archivee":
        return "Archivée";
      case "nouvelle":
      default:
        return "Nouvelle";
    }
  };

  const getRequestStatusColor = (status?: Reservation["requestStatus"]) => {
    switch (status) {
      case "en_cours":
        return "bg-blue-100 text-blue-700";
      case "validee":
        return "bg-emerald-100 text-emerald-700";
      case "refusee":
        return "bg-rose-100 text-rose-700";
      case "archivee":
        return "bg-slate-200 text-slate-700";
      case "nouvelle":
      default:
        return "bg-amber-100 text-amber-700";
    }
  };
  const toDatePart = (value?: string | Date | null) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
  };

  const toTimePart = (value?: string | Date | null) => {
    if (!value) return "00:00";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "00:00";
    return d.toISOString().split("T")[1].slice(0, 5);
  };

  useEffect(() => {
    const verifyAdminSession = async () => {
      try {
        const response = await fetch("/api/admin-auth/me", {
          credentials: "include",
        });
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("application/json")) {
          redirectToLogin();
          return;
        }
        const payload = await response.json().catch(() => null);
        if (payload?.role !== "admin") {
          redirectToLogin();
          return;
        }
        setAuthOk(true);
      } catch {
        redirectToLogin();
      } finally {
        setAuthChecked(true);
      }
    };
    void verifyAdminSession();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [resResa, resDispo, resCabines] = await Promise.all([
        fetch("/api/reservations", { credentials: "include" }),
        fetch("/api/disponibilites", { credentials: "include" }),
        fetch("/api/cabines-reservees", { credentials: "include" }),
      ]);
      if ([resResa, resDispo, resCabines].some((r) => r.status === 401 || r.status === 403)) {
        setAuthOk(false);
        redirectToLogin();
        return;
      }
      const dataResa = await resResa.json();
      const dataDispo = await resDispo.json();
      const dataCabines = await resCabines.json();

      setReservations(dataResa);
      setDisponibilites(dataDispo);
      await Promise.all(
        (Array.isArray(dataResa) ? dataResa : []).map(async (r: Reservation) => {
          await loadReservationDocuments(r.id);
        })
      );

      const cmap: Record<number, CabinesReservees> = {};
      dataCabines.forEach((c: CabinesReservees) => {
        cmap[c.disponibiliteId] = c;
      });
      setCabinesMap(cmap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/admin-auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // no-op: always redirect to login even if request fails
    } finally {
      setAuthOk(false);
      redirectToLogin();
    }
  };

  useEffect(() => {
    if (authOk) fetchData();
  }, [authOk]);

  const handleEdit = (dispo: Disponibilite) => {
    setEditingId(dispo.id);
    setSearchDispo(dispo.destination);
    setShowForm(true);
    // Scroll to form if needed
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer ce créneau ?")) return;
    await fetch(`/api/disponibilites/${id}`, { method: "DELETE" });
    fetchData();
  };

  const readErrorMessage = async (response: Response, fallback: string) => {
    try {
      const payload = await response.json();
      return payload?.error || fallback;
    } catch {
      return fallback;
    }
  };

  const loadReservationDocuments = async (reservationId: number) => {
    try {
      const response = await fetch(`/api/workflow/reservations/${reservationId}/documents`, { credentials: "include" });
      if (!response.ok) return;
      const payload = await response.json();
      const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
      const contracts = Array.isArray(payload?.contracts) ? payload.contracts : [];
      const latestQuote = quotes.slice().sort((a: any, b: any) => (b.id || 0) - (a.id || 0))[0];
      const latestContract = contracts.slice().sort((a: any, b: any) => (b.id || 0) - (a.id || 0))[0];
      setReservationDocsMap((prev) => ({
        ...prev,
        [reservationId]: {
          quoteUrl: latestQuote?.downloadUrl || null,
          contractUrl: latestContract?.downloadUrl || null,
        },
      }));
    } catch (error) {
      console.error(error);
    }
  };

  const performReservationAction = async (reservationId: number, action: () => Promise<Response>, successMessage: string) => {
    if (reservationActionLoadingId !== null) return;
    setReservationActionLoadingId(reservationId);
    setReservationActionMessage("");
    try {
      const response = await action();
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Action impossible"));
      }
      setReservationActionMessage(successMessage);
      await fetchData();
    } catch (error: any) {
      setReservationActionMessage(error?.message || "Erreur lors de l'action");
    } finally {
      setReservationActionLoadingId(null);
    }
  };

  const generateQuoteAndContract = async (reservationId: number) => {
    if (reservationActionLoadingId !== null) return;
    setReservationActionLoadingId(reservationId);
    setReservationActionMessage("");
    try {
      const response = await fetch(`/api/workflow/reservations/${reservationId}/owner-validate`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Génération devis/contrat impossible"));
      }
      const payload = await response.json();
      const quoteUrl = payload?.quoteUrl;
      const contractUrl = payload?.contractUrl;
      if (!quoteUrl || !contractUrl) {
        throw new Error("Le serveur n'a pas renvoyé les deux documents (devis + contrat).");
      }
      window.open(quoteUrl, "_blank", "noopener,noreferrer");
      window.open(contractUrl, "_blank", "noopener,noreferrer");
      setReservationActionMessage("Devis et contrat générés et ouverts.");
      await fetchData();
      await loadReservationDocuments(reservationId);
    } catch (error: any) {
      setReservationActionMessage(error?.message || "Erreur lors de la génération devis/contrat");
    } finally {
      setReservationActionLoadingId(null);
    }
  };

  const getWorkflowBadge = (workflowStatut?: Reservation["workflowStatut"]) => {
    const ws = workflowStatut || "demande";
    if (ws === "solde_confirme") {
      return { label: "Contrat signé + solde versé", className: "bg-emerald-100 text-emerald-700" };
    }
    if (ws === "acompte_confirme") {
      return { label: "Validé (acompte reçu)", className: "bg-emerald-100 text-emerald-700" };
    }
    if (ws === "validee_owner" || ws === "contrat_envoye" || ws === "contrat_signe") {
      return { label: "Devis/contrat générés", className: "bg-blue-100 text-blue-700" };
    }
    return { label: "En attente de devis", className: "bg-amber-100 text-amber-700" };
  };

  const getStatutColor = (s: string) => {
    if (s === "disponible") return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (s === "reserve") return "bg-rose-100 text-rose-700 border-rose-200";
    if (s === "option") return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const getStatutLabel = (s: string) => {
    if (s === "disponible") return "Disponible";
    if (s === "reserve") return "Complet";
    if (s === "option") return "Option";
    return "Fermé";
  };

  const getPlanningTypeColor = (t?: string) => {
    if (t === "technical_stop") return "bg-orange-100 text-orange-700 border-orange-200";
    if (t === "maintenance") return "bg-purple-100 text-purple-700 border-purple-200";
    if (t === "blocked") return "bg-slate-200 text-slate-800 border-slate-300";
    return "bg-blue-100 text-blue-700 border-blue-200";
  };

  const getPlanningTypeLabel = (t?: string) => {
    if (t === "technical_stop") return "Arrêt technique";
    if (t === "maintenance") return "Maintenance";
    if (t === "blocked") return "Bloqué";
    return "Charter";
  };

  const filteredDisponibilites = useMemo(() => {
    return disponibilites.filter((d) => {
      const matchSearch = d.destination.toLowerCase().includes(searchDispo.toLowerCase());
      const matchStatut = filterStatut === "tous" || d.statut === filterStatut;
      const matchType = filterPlanningType === "tous" || d.planningType === filterPlanningType;
      return matchSearch && matchStatut && matchType;
    });
  }, [disponibilites, searchDispo, filterStatut, filterPlanningType]);

  const sortedReservations = useMemo(() => {
    return reservations.slice().sort((a, b) => new Date(b.dateDebut).getTime() - new Date(a.dateDebut).getTime());
  }, [reservations]);

  const openManualReservationForm = () => {
    setEditingReservation(null);
    setReservationFormData(getDefaultReservationFormData());
    setShowReservationForm(true);
  };

  const submitManualReservation = async () => {
    const payload = {
      nomClient: reservationFormData.nomClient,
      prenomClient: reservationFormData.prenomClient || "",
      emailClient: reservationFormData.emailClient,
      telClient: reservationFormData.telClient || "",
      nbPersonnes: Number(reservationFormData.nbPersonnes || 1),
      formule: reservationFormData.formule || "semaine",
      destination: reservationFormData.destination || "La Ciotat",
      dateDebut: `${reservationFormData.dateDebut}T00:00:00.000Z`,
      dateFin: `${reservationFormData.dateFin}T00:00:00.000Z`,
      montantTotal: Number(reservationFormData.montantTotal || 0),
      typeReservation: reservationFormData.typeReservation || "bateau_entier",
      nbCabines: Number(reservationFormData.nbCabines || 1),
      message: reservationFormData.message || "Ajout manuel backoffice",
      disponibiliteId: reservationFormData.disponibiliteId || null,
    };
    if (!payload.nomClient || !payload.emailClient || !reservationFormData.dateDebut || !reservationFormData.dateFin) {
      setReservationActionMessage("Nom, email et dates sont requis.");
      return;
    }
    setReservationActionMessage("");
    const res = await fetch("/api/reservations/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setReservationActionMessage(data?.error || "Erreur lors de l'ajout manuel.");
      return;
    }
    setShowReservationForm(false);
    setReservationFormData(getDefaultReservationFormData());
    await fetchData();
  };

  if (!authChecked) return null;
  if (!authOk) return null;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src={logoSabine} alt="Sabine" className="h-8" />
            <div className="h-6 w-px bg-slate-200" />
            <h1 className="text-lg font-bold text-slate-900">Backoffice</h1>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-rose-600 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-wrap gap-2 mb-8 bg-white p-1 rounded-xl border border-slate-200 shadow-sm w-fit">
          {[
            { id: "disponibilites", label: "Calendrier", icon: Calendar },
            { id: "reservations", label: "Réservations", icon: Anchor },
            { id: "finances", label: "Finances", icon: CreditCard },
            { id: "pricing", label: "Tarifs saison", icon: CreditCard },
            { id: "documents", label: "Documents", icon: FileText },
            { id: "maintenance", label: "Maintenance", icon: Wrench },
            { id: "config", label: "Configuration", icon: Link2 },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t.id ? "bg-blue-900 text-white shadow-md" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "disponibilites" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="bg-white rounded-lg border border-slate-200 p-1 flex shadow-sm">
                  <button
                    onClick={() => setCalendarViewMode("calendar")}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                      calendarViewMode === "calendar" ? "bg-blue-900 text-white" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Vue Calendrier
                  </button>
                  <button
                    onClick={() => setCalendarViewMode("list")}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                      calendarViewMode === "list" ? "bg-blue-900 text-white" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Vue Liste
                  </button>
                </div>
              </div>
              <button
                onClick={() => {
                  setEditingId(null);
                  setShowForm(true);
                }}
                className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
              >
                <Plus className="w-5 h-5" />
                Nouveau créneau
              </button>
            </div>

            {calendarViewMode === "calendar" ? (
              <AdminCalendarView
                disponibilites={disponibilites}
                reservations={reservations}
                onEdit={handleEdit}
                onDelete={handleDelete}
                loading={loading}
              />
            ) : (
              <div className="grid gap-4">
                {filteredDisponibilites.map((dispo) => (
                  <motion.div
                    key={dispo.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-lg shadow border border-slate-200 p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatutColor(dispo.statut)}`}>
                            {getStatutLabel(dispo.statut)}
                          </span>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getPlanningTypeColor(dispo.planningType)}`}>
                            {getPlanningTypeLabel(dispo.planningType)}
                          </span>
                          <span className="text-sm font-medium text-slate-600">{dispo.destination}</span>
                        </div>
                        <p className="text-sm text-slate-600">
                          {new Date(dispo.debut).toLocaleDateString("fr-FR", { timeZone: "UTC" })} → {new Date(dispo.fin).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleEdit(dispo)} className="p-2 text-blue-900 hover:bg-blue-50 rounded-lg">
                          <Edit2 className="w-5 h-5" />
                        </button>
                        <button onClick={() => handleDelete(dispo.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "reservations" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Réservations</h2>
                <p className="text-sm text-slate-600">Gestion des demandes et ajout manuel.</p>
              </div>
              <button
                onClick={openManualReservationForm}
                className="flex items-center gap-2 bg-blue-900 text-white px-4 py-2.5 rounded-xl font-semibold hover:bg-blue-800"
              >
                <Plus className="w-4 h-4" />
                Ajouter une réservation manuelle
              </button>
            </div>
            {!!reservationActionMessage && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {reservationActionMessage}
              </div>
            )}
            <div className="grid gap-3">
              {sortedReservations.map((reservation) => (
                <div key={reservation.id} className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{reservation.nomClient}</p>
                      <p className="text-xs text-slate-600">{reservation.emailClient}</p>
                      <p className="text-xs text-slate-600">
                        {new Date(reservation.dateDebut).toLocaleDateString("fr-FR", { timeZone: "UTC" })} →{" "}
                        {new Date(reservation.dateFin).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getRequestStatusColor(reservation.requestStatus)}`}>
                        {getRequestStatusLabel(reservation.requestStatus)}
                      </span>
                      <div className="mt-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${getWorkflowBadge(reservation.workflowStatut).className}`}>
                          {["acompte_confirme", "solde_confirme"].includes(reservation.workflowStatut || "") ? (
                            <Check className="w-3 h-3" />
                          ) : reservation.workflowStatut === "validee_owner" ||
                            reservation.workflowStatut === "contrat_envoye" ||
                            reservation.workflowStatut === "contrat_signe" ? (
                            <FileText className="w-3 h-3" />
                          ) : (
                            <Clock className="w-3 h-3" />
                          )}
                          {getWorkflowBadge(reservation.workflowStatut).label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-2">
                        {(reservation.montantTotal / 100).toLocaleString("fr-FR")} €
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => generateQuoteAndContract(reservation.id)}
                      disabled={reservationActionLoadingId === reservation.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-60"
                      title="Générer devis + contrat"
                    >
                      Devis + contrat
                    </button>
                    <button
                      onClick={() =>
                        performReservationAction(
                          reservation.id,
                          () =>
                            fetch(`/api/workflow/reservations/${reservation.id}/send-contract`, {
                              method: "POST",
                              credentials: "include",
                            }),
                          "Contrat envoyé au client."
                        )
                      }
                      disabled={reservationActionLoadingId === reservation.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      title="Envoyer le contrat au client"
                    >
                      Envoyer contrat
                    </button>
                    <button
                      onClick={() =>
                        performReservationAction(
                          reservation.id,
                          () =>
                            fetch(`/api/workflow/reservations/${reservation.id}/acompte-received`, {
                              method: "POST",
                              credentials: "include",
                            }),
                          "Acompte confirmé."
                        )
                      }
                      disabled={reservationActionLoadingId === reservation.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60"
                      title="Confirmer acompte reçu"
                    >
                      Acompte reçu
                    </button>
                    <button
                      onClick={() =>
                        performReservationAction(
                          reservation.id,
                          () =>
                            fetch(`/api/workflow/reservations/${reservation.id}/contract-signed`, {
                              method: "POST",
                              credentials: "include",
                            }),
                          "Contrat marqué comme signé."
                        )
                      }
                      disabled={reservationActionLoadingId === reservation.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60"
                      title="Valider contrat signé"
                    >
                      Contrat signé
                    </button>
                    <button
                      onClick={() =>
                        performReservationAction(
                          reservation.id,
                          () =>
                            fetch(`/api/workflow/reservations/${reservation.id}/solde-received`, {
                              method: "POST",
                              credentials: "include",
                            }),
                          "Solde confirmé."
                        )
                      }
                      disabled={reservationActionLoadingId === reservation.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-60"
                      title="Confirmer solde reçu"
                    >
                      Solde reçu
                    </button>
                  </div>
                </div>
              ))}
              {!sortedReservations.length && (
                <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-600">
                  Aucune réservation enregistrée.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "config" && <ConfigIcal />}
        {tab === "maintenance" && <BackofficeOps mode="maintenance" />}
        {tab === "pricing" && <SeasonPricingManager />}
        {tab === "documents" && <InventoryManager />}

        {showReservationForm && (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center px-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">Nouvelle réservation manuelle</h3>
                <button onClick={() => setShowReservationForm(false)} className="p-2 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <input value={reservationFormData.nomClient || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, nomClient: e.target.value }))} placeholder="Nom client *" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input value={reservationFormData.emailClient || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, emailClient: e.target.value }))} placeholder="Email *" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input type="date" value={reservationFormData.dateDebut || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, dateDebut: e.target.value }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input type="date" value={reservationFormData.dateFin || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, dateFin: e.target.value }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input value={reservationFormData.destination || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, destination: e.target.value }))} placeholder="Destination" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <select value={reservationFormData.typeReservation || "bateau_entier"} onChange={(e) => setReservationFormData((s) => ({ ...s, typeReservation: e.target.value as any }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  <option value="bateau_entier">Privatif</option>
                  <option value="cabine">Cabine</option>
                </select>
                <input type="number" min={1} max={8} value={reservationFormData.nbPersonnes || 1} onChange={(e) => setReservationFormData((s) => ({ ...s, nbPersonnes: Number(e.target.value || 1) }))} placeholder="Nb personnes" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input type="number" min={1} max={4} value={reservationFormData.nbCabines || 1} onChange={(e) => setReservationFormData((s) => ({ ...s, nbCabines: Number(e.target.value || 1) }))} placeholder="Nb cabines" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input type="number" min={0} value={reservationFormData.montantTotal || 0} onChange={(e) => setReservationFormData((s) => ({ ...s, montantTotal: Number(e.target.value || 0) }))} placeholder="Montant total (centimes)" className="px-3 py-2 border border-slate-300 rounded-lg text-sm md:col-span-2" />
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button onClick={() => setShowReservationForm(false)} className="px-4 py-2 rounded-lg border border-slate-300">Annuler</button>
                <button onClick={submitManualReservation} className="px-4 py-2 rounded-lg bg-blue-900 text-white font-semibold">Créer la réservation</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
