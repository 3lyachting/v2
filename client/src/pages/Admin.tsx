/*
 * DESIGN: Charte Sabine Sailing
 * Page d'administration — Gestion du calendrier
 * Couleurs: Bleu marine + Teal + Blanc
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Edit2, Trash2, Calendar, LogOut, CreditCard, Check, Clock, X, Link2, FileText, Wrench } from "lucide-react";
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
  bookingOrigin?: BookingOrigin;
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

type BookingOrigin = "direct" | "clicknboat" | "skippair" | "samboat";
type OriginStats = { count: number; revenueCents: number; source: "local" | "clicknboat_api" };

type DisponibiliteFormData = {
  planningType: "charter" | "technical_stop" | "maintenance" | "blocked";
  debut: string;
  fin: string;
  statut: "disponible" | "reserve" | "option" | "ferme";
  destination: string;
  tarif: number;
  tarifCabine: number;
  tarifJourPersonne: number;
  tarifJourPriva: number;
  note: string;
  notePublique: string;
};

export default function Admin() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const [tab, setTab] = useState<"disponibilites" | "finances" | "config" | "documents" | "equipage" | "maintenance" | "pricing" | string>("disponibilites");
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
  const [originSummary, setOriginSummary] = useState<Record<BookingOrigin, OriginStats>>({
    direct: { count: 0, revenueCents: 0, source: "local" },
    clicknboat: { count: 0, revenueCents: 0, source: "local" },
    skippair: { count: 0, revenueCents: 0, source: "local" },
    samboat: { count: 0, revenueCents: 0, source: "local" },
  });
  const [originIntegrationInfo, setOriginIntegrationInfo] = useState<{
    enabled: boolean;
    usingLiveData: boolean;
    warning: string | null;
  }>({
    enabled: false,
    usingLiveData: false,
    warning: null,
  });
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
    bookingOrigin: "direct",
    nbCabines: 1,
    heureDebut: "00:00",
    heureFin: "00:00",
    statutPaiement: "en_attente",
    workflowStatut: "demande",
    requestStatus: "nouvelle",
    internalComment: "",
  });
  const [dispoFormData, setDispoFormData] = useState<DisponibiliteFormData>({
    planningType: "charter",
    debut: "",
    fin: "",
    statut: "disponible",
    destination: "La Ciotat",
    tarif: 0,
    tarifCabine: 0,
    tarifJourPersonne: 0,
    tarifJourPriva: 950,
    note: "",
    notePublique: "",
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
    bookingOrigin: "direct",
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
  const getTodayLocalIso = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const isAprilMayIso = (iso?: string | null) => Boolean(iso && (iso.slice(5, 7) === "04" || iso.slice(5, 7) === "05"));

  const toTimePart = (value?: string | Date | null) => {
    if (!value) return "00:00";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "00:00";
    return d.toISOString().split("T")[1].slice(0, 5);
  };
  const ORIGINS: BookingOrigin[] = ["direct", "clicknboat", "skippair", "samboat"];
  const EMPTY_ORIGIN_SUMMARY: Record<BookingOrigin, OriginStats> = {
    direct: { count: 0, revenueCents: 0, source: "local" },
    clicknboat: { count: 0, revenueCents: 0, source: "local" },
    skippair: { count: 0, revenueCents: 0, source: "local" },
    samboat: { count: 0, revenueCents: 0, source: "local" },
  };
  const normalizeOriginSummary = (raw: unknown): Record<BookingOrigin, OriginStats> => {
    if (!raw || typeof raw !== "object") return { ...EMPTY_ORIGIN_SUMMARY };
    const normalized: Record<BookingOrigin, OriginStats> = { ...EMPTY_ORIGIN_SUMMARY };
    ORIGINS.forEach((origin) => {
      const value = (raw as Record<string, unknown>)[origin];
      if (!value || typeof value !== "object") return;
      const source = (value as { source?: unknown }).source === "clicknboat_api" ? "clicknboat_api" : "local";
      normalized[origin] = {
        count: Number((value as { count?: unknown }).count || 0),
        revenueCents: Number((value as { revenueCents?: unknown }).revenueCents || 0),
        source,
      };
    });
    return normalized;
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

      const reservationsSafe = Array.isArray(dataResa) ? dataResa : [];
      const disponibilitesSafe = Array.isArray(dataDispo) ? dataDispo : [];
      const cabinesSafe = Array.isArray(dataCabines) ? dataCabines : [];

      setReservations(reservationsSafe);
      setDisponibilites(disponibilitesSafe);
      await Promise.all(
        reservationsSafe.map(async (r: Reservation) => {
          await loadReservationDocuments(r.id);
        })
      );

      const cmap: Record<number, CabinesReservees> = {};
      cabinesSafe.forEach((c: CabinesReservees) => {
        cmap[c.disponibiliteId] = c;
      });
      setCabinesMap(cmap);

      try {
        const originResponse = await fetch("/api/reservations/origins-summary", { credentials: "include" });
        if (originResponse.ok) {
          const payload = await originResponse.json();
          setOriginSummary(normalizeOriginSummary(payload?.origins));
          if (payload?.clicknboatIntegration) setOriginIntegrationInfo(payload.clicknboatIntegration);
        }
      } catch {
        // Do not block admin UI if third-party stats are unavailable.
      }
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
    setDispoFormData({
      planningType: dispo.planningType || "charter",
      debut: toDatePart(dispo.debut),
      fin: toDatePart(dispo.fin),
      statut: dispo.statut,
      destination: dispo.destination,
      tarif: Number(dispo.tarif || 0),
      tarifCabine: Number(dispo.tarifCabine || 0),
      tarifJourPersonne: Number(dispo.tarifJourPersonne || 0),
      tarifJourPriva: Number(dispo.tarifJourPriva || 0),
      note: dispo.note || "",
      notePublique: dispo.notePublique || "",
    });
    setShowForm(true);
    // Scroll to form if needed
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer ce créneau ?")) return false;
    try {
      const res = await fetch(`/api/disponibilites/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        setReservationActionMessage("Impossible de supprimer ce créneau.");
        return false;
      }
      await fetchData();
      setReservationActionMessage("Créneau supprimé.");
      return true;
    } catch {
      setReservationActionMessage("Erreur réseau lors de la suppression.");
      return false;
    }
  };

  const resetDispoForm = () => {
    setEditingId(null);
    setDispoFormData({
      planningType: "charter",
      debut: "",
      fin: "",
      statut: "disponible",
      destination: "La Ciotat",
      tarif: 0,
      tarifCabine: 0,
      tarifJourPersonne: 0,
      tarifJourPriva: 950,
      note: "",
      notePublique: "",
    });
  };

  const submitDisponibilite = async () => {
    if (!dispoFormData.debut || !dispoFormData.fin || !dispoFormData.destination) {
      setReservationActionMessage("Date début, date fin et destination sont requis.");
      return;
    }
    if (new Date(dispoFormData.fin).getTime() < new Date(dispoFormData.debut).getTime()) {
      setReservationActionMessage("La date de fin doit être égale ou postérieure à la date de début.");
      return;
    }
    const payload = {
      planningType: dispoFormData.planningType,
      debut: `${dispoFormData.debut}T00:00:00.000Z`,
      fin: `${dispoFormData.fin}T00:00:00.000Z`,
      statut: dispoFormData.statut,
      destination: dispoFormData.destination,
      tarif: dispoFormData.tarif || null,
      tarifCabine: dispoFormData.tarifCabine || null,
      tarifJourPersonne: dispoFormData.tarifJourPersonne || null,
      tarifJourPriva: dispoFormData.tarifJourPriva || null,
      note: dispoFormData.note || null,
      notePublique: dispoFormData.notePublique || null,
    };
    const url = editingId ? `/api/disponibilites/${editingId}` : "/api/disponibilites";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setReservationActionMessage(data?.error || "Impossible d'enregistrer le créneau.");
      return;
    }
    setShowForm(false);
    setReservationActionMessage("");
    resetDispoForm();
    await fetchData();
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

  const financeStats = useMemo(() => {
    const safeReservations = Array.isArray(reservations) ? reservations : [];
    const totalCents = safeReservations.reduce((sum, r) => sum + Number(r.montantTotal || 0), 0);
    const validated = safeReservations.filter(
      (r) =>
        r.requestStatus === "validee" ||
        ["validee_owner", "contrat_envoye", "contrat_signe", "acompte_confirme", "solde_confirme"].includes(String(r.workflowStatut || "")),
    );
    const pending = safeReservations.filter((r) => r.requestStatus !== "validee" && r.requestStatus !== "refusee" && r.requestStatus !== "archivee");
    const paidCents = safeReservations
      .filter((r) => r.statutPaiement === "paye" || r.workflowStatut === "solde_confirme")
      .reduce((sum, r) => sum + Number(r.montantTotal || 0), 0);

    const byMonthMap = new Map<string, number>();
    safeReservations.forEach((r) => {
      const d = new Date(r.dateDebut);
      if (Number.isNaN(d.getTime())) return;
      const key = d.toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });
      byMonthMap.set(key, (byMonthMap.get(key) || 0) + Number(r.montantTotal || 0));
    });

    const monthly = Array.from(byMonthMap.entries()).map(([month, cents]) => ({
      month,
      total: Math.round(cents / 100),
    }));

    const localOrigins: Record<BookingOrigin, { count: number; revenueCents: number }> = {
      direct: { count: 0, revenueCents: 0 },
      clicknboat: { count: 0, revenueCents: 0 },
      skippair: { count: 0, revenueCents: 0 },
      samboat: { count: 0, revenueCents: 0 },
    };
    reservations.forEach((r) => {
      const origin = (r.bookingOrigin || "direct") as BookingOrigin;
      if (!localOrigins[origin]) return;
      localOrigins[origin].count += 1;
      localOrigins[origin].revenueCents += Number(r.montantTotal || 0);
    });

    const originBreakdown: Record<BookingOrigin, OriginStats> = {
      direct: { ...localOrigins.direct, source: "local" },
      clicknboat: { ...localOrigins.clicknboat, source: "local" },
      skippair: { ...localOrigins.skippair, source: "local" },
      samboat: { ...localOrigins.samboat, source: "local" },
    };
    ORIGINS.forEach((origin) => {
      if (originSummary[origin]) {
        originBreakdown[origin] = originSummary[origin];
      }
    });

    return {
      totalCents,
      totalEuros: Math.round(totalCents / 100),
      paidEuros: Math.round(paidCents / 100),
      validatedCount: validated.length,
      pendingCount: pending.length,
      monthly,
      originBreakdown,
    };
  }, [reservations, originSummary]);

  const openManualReservationForm = () => {
    setEditingReservation(null);
    setReservationFormData(getDefaultReservationFormData());
    setShowReservationForm(true);
  };

  const openEditReservationForm = (reservation: Reservation) => {
    setEditingReservation(reservation);
    setReservationFormData({
      ...reservation,
      dateDebut: toDatePart(reservation.dateDebut),
      dateFin: toDatePart(reservation.dateFin),
      nbPersonnes: Number(reservation.nbPersonnes || 1),
      nbCabines: Number(reservation.nbCabines || 1),
      montantTotal: Number(reservation.montantTotal || 0),
      typeReservation: reservation.typeReservation || "bateau_entier",
      destination: reservation.destination || "La Ciotat",
      formule: reservation.formule || "semaine",
    });
    setShowReservationForm(true);
  };

  const submitManualReservation = async () => {
    const todayIso = getTodayLocalIso();
    const startIso = reservationFormData.dateDebut || "";
    const endIso = reservationFormData.dateFin || "";
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
      bookingOrigin: reservationFormData.bookingOrigin || "direct",
      nbCabines: Number(reservationFormData.nbCabines || 1),
      message: reservationFormData.message || "Ajout manuel backoffice",
      disponibiliteId: reservationFormData.disponibiliteId || null,
    };
    if (!payload.nomClient || !payload.emailClient || !reservationFormData.dateDebut || !reservationFormData.dateFin) {
      setReservationActionMessage("Nom, email et dates sont requis.");
      return;
    }
    if (startIso < todayIso || endIso < todayIso) {
      setReservationActionMessage("Les dates passées ne sont pas réservables.");
      return;
    }
    if ((isAprilMayIso(startIso) || isAprilMayIso(endIso)) && payload.typeReservation === "cabine") {
      setReservationActionMessage("En avril/mai, seule la privatisation est autorisée.");
      return;
    }
    setReservationActionMessage("");
    const endpoint = editingReservation ? `/api/reservations/${editingReservation.id}` : "/api/reservations/request";
    const method = editingReservation ? "PUT" : "POST";
    const res = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setReservationActionMessage(data?.error || (editingReservation ? "Erreur lors de la modification." : "Erreur lors de l'ajout manuel."));
      return;
    }
    setShowReservationForm(false);
    setEditingReservation(null);
    setReservationFormData(getDefaultReservationFormData());
    await fetchData();
  };
  useEffect(() => {
    const startIso = reservationFormData.dateDebut || "";
    const endIso = reservationFormData.dateFin || "";
    if ((isAprilMayIso(startIso) || isAprilMayIso(endIso)) && reservationFormData.typeReservation === "cabine") {
      setReservationFormData((s) => ({ ...s, typeReservation: "bateau_entier" }));
    }
  }, [reservationFormData.dateDebut, reservationFormData.dateFin, reservationFormData.typeReservation]);

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
              <div className="flex items-center gap-2">
                <button
                  onClick={openManualReservationForm}
                  className="flex items-center gap-2 bg-blue-900 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-blue-800 transition-all shadow-lg shadow-blue-100"
                >
                  <Plus className="w-5 h-5" />
                  Nouvelle résa
                </button>
                <button
                  onClick={() => {
                    resetDispoForm();
                    setShowForm(true);
                  }}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                >
                  <Plus className="w-5 h-5" />
                  Nouveau créneau
                </button>
              </div>
            </div>

            {calendarViewMode === "calendar" ? (
              <AdminCalendarView
                disponibilites={disponibilites}
                reservations={reservations}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onCreateSlot={() => {
                  resetDispoForm();
                  setShowForm(true);
                  setReservationActionMessage("");
                }}
                onEditReservation={(reservationId) => {
                  const target = reservations.find((r) => r.id === reservationId);
                  if (target) openEditReservationForm(target);
                }}
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

        {tab === "finances" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Finances</h2>
              <p className="text-sm text-slate-600">Vue globale des montants de réservation.</p>
            </div>

            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <p className="text-xs uppercase font-semibold text-slate-500">Total réservations</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{financeStats.totalEuros.toLocaleString("fr-FR")} €</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <p className="text-xs uppercase font-semibold text-slate-500">Total encaissé</p>
                <p className="mt-2 text-2xl font-bold text-emerald-700">{financeStats.paidEuros.toLocaleString("fr-FR")} €</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <p className="text-xs uppercase font-semibold text-slate-500">Réservations validées</p>
                <p className="mt-2 text-2xl font-bold text-blue-900">{financeStats.validatedCount}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <p className="text-xs uppercase font-semibold text-slate-500">Demandes en cours</p>
                <p className="mt-2 text-2xl font-bold text-amber-700">{financeStats.pendingCount}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 mb-3">Chiffre d'affaires par mois (€)</h3>
              {financeStats.monthly.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={financeStats.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value: any) => `${Number(value).toLocaleString("fr-FR")} €`} />
                      <Legend />
                      <Bar dataKey="total" name="Total (€)" fill="#0f3b53" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-slate-600">Aucune donnée financière disponible.</p>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-bold text-slate-800">Origine des réservations</h3>
                {originIntegrationInfo.usingLiveData && (
                  <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded-full">
                    Click&Boat API active
                  </span>
                )}
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                {[
                  { key: "direct", label: "Direct" },
                  { key: "clicknboat", label: "Clicknboat" },
                  { key: "skippair", label: "Skippair" },
                  { key: "samboat", label: "Samboat" },
                ].map((item) => {
                  const stat = financeStats.originBreakdown[item.key as BookingOrigin];
                  return (
                    <div key={item.key} className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                      <p className="text-xs uppercase font-semibold text-slate-500">{item.label}</p>
                      <p className="mt-2 text-xl font-bold text-slate-900">{stat.count}</p>
                      <p className="text-sm font-semibold text-slate-700">
                        {(Math.round(stat.revenueCents / 100)).toLocaleString("fr-FR")} €
                      </p>
                    </div>
                  );
                })}
              </div>
              {originIntegrationInfo.warning && (
                <p className="mt-3 text-xs text-amber-700">
                  Click&Boat API indisponible: affichage local conservé ({originIntegrationInfo.warning}).
                </p>
              )}
            </div>
          </div>
        )}

        {tab === "config" && <ConfigIcal />}
        {tab === "maintenance" && <BackofficeOps mode="maintenance" />}
        {tab === "pricing" && <SeasonPricingManager />}
        {tab === "documents" && <InventoryManager />}

        {showForm && (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center px-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">{editingId ? "Modifier le créneau" : "Nouveau créneau"}</h3>
                <button
                  onClick={() => {
                    setShowForm(false);
                    resetDispoForm();
                  }}
                  className="p-2 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="dispo-debut" className="block text-xs font-semibold text-slate-600">
                    Date de début
                  </label>
                  <input
                    id="dispo-debut"
                    type="date"
                    value={dispoFormData.debut}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, debut: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="dispo-fin" className="block text-xs font-semibold text-slate-600">
                    Date de fin
                  </label>
                  <input
                    id="dispo-fin"
                    type="date"
                    value={dispoFormData.fin}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, fin: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="dispo-planning-type" className="block text-xs font-semibold text-slate-600">
                    Type de planning
                  </label>
                  <select
                    id="dispo-planning-type"
                    value={dispoFormData.planningType}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, planningType: e.target.value as any }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="charter">Charter</option>
                    <option value="technical_stop">Arrêt technique</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="blocked">Bloqué</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="dispo-statut" className="block text-xs font-semibold text-slate-600">
                    Statut du créneau
                  </label>
                  <select
                    id="dispo-statut"
                    value={dispoFormData.statut}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, statut: e.target.value as any }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="disponible">Disponible</option>
                    <option value="option">Option</option>
                    <option value="reserve">Complet</option>
                    <option value="ferme">Fermé</option>
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label htmlFor="dispo-destination" className="block text-xs font-semibold text-slate-600">
                    Destination
                  </label>
                  <input
                    id="dispo-destination"
                    value={dispoFormData.destination}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, destination: e.target.value }))}
                    placeholder="Ex: La Ciotat"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="dispo-tarif-priva-semaine" className="block text-xs font-semibold text-slate-600">
                    Tarif privatif semaine (EUR)
                  </label>
                  <input
                    id="dispo-tarif-priva-semaine"
                    type="number"
                    min={0}
                    value={dispoFormData.tarif}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, tarif: Number(e.target.value || 0) }))}
                    placeholder="Ex: 4900"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="dispo-tarif-cabine" className="block text-xs font-semibold text-slate-600">
                    Tarif cabine (EUR)
                  </label>
                  <input
                    id="dispo-tarif-cabine"
                    type="number"
                    min={0}
                    value={dispoFormData.tarifCabine}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, tarifCabine: Number(e.target.value || 0) }))}
                    placeholder="Ex: 790"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="dispo-tarif-priva-jour" className="block text-xs font-semibold text-slate-600">
                    Tarif privatisation journée (EUR)
                  </label>
                  <input
                    id="dispo-tarif-priva-jour"
                    type="number"
                    min={0}
                    value={dispoFormData.tarifJourPriva}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, tarifJourPriva: Number(e.target.value || 0) }))}
                    placeholder="Tarif privatisation journée en EUR"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="dispo-tarif-jour-pers" className="block text-xs font-semibold text-slate-600">
                    Tarif journée par personne (EUR)
                  </label>
                  <input
                    id="dispo-tarif-jour-pers"
                    type="number"
                    min={0}
                    value={dispoFormData.tarifJourPersonne}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, tarifJourPersonne: Number(e.target.value || 0) }))}
                    placeholder="Ex: 130"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label htmlFor="dispo-note-interne" className="block text-xs font-semibold text-slate-600">
                    Note interne (non visible client)
                  </label>
                  <input
                    id="dispo-note-interne"
                    value={dispoFormData.note}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, note: e.target.value }))}
                    placeholder="Ex: Prévoir nettoyage cabine 2 avant embarquement"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label htmlFor="dispo-note-publique" className="block text-xs font-semibold text-slate-600">
                    Note publique (visible client)
                  </label>
                  <input
                    id="dispo-note-publique"
                    value={dispoFormData.notePublique}
                    onChange={(e) => setDispoFormData((s) => ({ ...s, notePublique: e.target.value }))}
                    placeholder="Ex: Itinéraire adaptable selon météo"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowForm(false);
                    resetDispoForm();
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-300"
                >
                  Annuler
                </button>
                <button onClick={submitDisponibilite} className="px-4 py-2 rounded-lg bg-blue-900 text-white font-semibold">
                  {editingId ? "Enregistrer" : "Créer le créneau"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showReservationForm && (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center px-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">
                  {editingReservation ? "Modifier la réservation" : "Nouvelle réservation manuelle"}
                </h3>
                <button onClick={() => setShowReservationForm(false)} className="p-2 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <input value={reservationFormData.nomClient || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, nomClient: e.target.value }))} placeholder="Nom client *" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input value={reservationFormData.emailClient || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, emailClient: e.target.value }))} placeholder="Email *" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input type="date" min={getTodayLocalIso()} value={reservationFormData.dateDebut || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, dateDebut: e.target.value }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input type="date" min={getTodayLocalIso()} value={reservationFormData.dateFin || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, dateFin: e.target.value }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input value={reservationFormData.destination || ""} onChange={(e) => setReservationFormData((s) => ({ ...s, destination: e.target.value }))} placeholder="Destination" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <select value={reservationFormData.typeReservation || "bateau_entier"} onChange={(e) => setReservationFormData((s) => ({ ...s, typeReservation: e.target.value as any }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  <option value="bateau_entier">Privatif</option>
                  {!(isAprilMayIso(reservationFormData.dateDebut) || isAprilMayIso(reservationFormData.dateFin)) && (
                    <option value="cabine">Cabine</option>
                  )}
                </select>
                <select value={reservationFormData.bookingOrigin || "direct"} onChange={(e) => setReservationFormData((s) => ({ ...s, bookingOrigin: e.target.value as BookingOrigin }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  <option value="direct">Direct</option>
                  <option value="clicknboat">Clicknboat</option>
                  <option value="skippair">Skippair</option>
                  <option value="samboat">Samboat</option>
                </select>
                <input type="number" min={1} max={8} value={reservationFormData.nbPersonnes || 1} onChange={(e) => setReservationFormData((s) => ({ ...s, nbPersonnes: Number(e.target.value || 1) }))} placeholder="Nb personnes" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input type="number" min={1} max={4} value={reservationFormData.nbCabines || 1} onChange={(e) => setReservationFormData((s) => ({ ...s, nbCabines: Number(e.target.value || 1) }))} placeholder="Nb cabines" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <input type="number" min={0} value={reservationFormData.montantTotal || 0} onChange={(e) => setReservationFormData((s) => ({ ...s, montantTotal: Number(e.target.value || 0) }))} placeholder="Montant total (centimes)" className="px-3 py-2 border border-slate-300 rounded-lg text-sm md:col-span-2" />
              </div>
              {(isAprilMayIso(reservationFormData.dateDebut) || isAprilMayIso(reservationFormData.dateFin)) && (
                <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Avril/mai: création manuelle autorisée en mode privatif uniquement.
                </p>
              )}
              <div className="mt-5 flex items-center justify-end gap-2">
                <button onClick={() => setShowReservationForm(false)} className="px-4 py-2 rounded-lg border border-slate-300">Annuler</button>
                <button onClick={submitManualReservation} className="px-4 py-2 rounded-lg bg-blue-900 text-white font-semibold">
                  {editingReservation ? "Enregistrer la modification" : "Créer la réservation"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
