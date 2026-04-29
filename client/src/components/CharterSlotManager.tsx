import { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl, handleApiResponse } from "@/lib/apiBase";
import AdminCalendarView from "@/components/AdminCalendarView";
import {
  CHARTER_PRODUCT_LABELS,
  CHARTER_PRODUCTS,
  type CharterProductCode,
} from "@shared/charterProduct";
import {
  aggregateCruiseCabineOccupancy,
  CHARTER_CRUISE_CABIN_UNITS,
  isCruiseMultiUnitProduct,
  isReservationBlockingForCharterCalendar,
  rangesOverlapForStay,
} from "@shared/charterCapacity";

const BRAND_DEEP = "#00384A";
const BRAND_SAND = "#D8C19E";

type SlotRow = {
  id: number;
  product: CharterProductCode;
  debut: string;
  fin: string;
  active: boolean;
  note: string | null;
  publicNote: string | null;
};

type ReservationRow = {
  id: number;
  nomClient: string;
  prenomClient?: string | null;
  emailClient: string;
  telClient: string | null;
  nbPersonnes: number;
  typeReservation: "bateau_entier" | "cabine" | "place";
  dateDebut: string;
  dateFin: string;
  montantTotal: number;
  requestStatus?: string | null;
  bookingOrigin?: string | null;
  disponibiliteId?: number | null;
  statutPaiement?: string | null;
  workflowStatut?: string | null;
  destination?: string | null;
  formule?: string | null;
  message?: string | null;
  internalComment?: string | null;
};

type ReservationEditState = {
  id: number;
  nomClient: string;
  prenomClient: string;
  emailClient: string;
  telClient: string;
  dateDebut: string;
  dateFin: string;
  nbPersonnes: number;
  typeReservation: "bateau_entier" | "cabine" | "place";
  montantTotalEur: number;
  requestStatus: string;
  workflowStatut: string;
  statutPaiement: string;
  destination: string;
  formule: string;
  message: string;
  internalComment: string;
  reservationStatus: ReservationStatus;
};

type ReservationStatus = "nouvelle" | "devis_envoye" | "validee_acompte" | "terminee_solde";

type WorkflowDocumentsResponse = {
  quotes?: Array<{ id: number; downloadUrl: string | null }>;
  contracts?: Array<{ id: number; downloadUrl: string | null }>;
};

type ReservationLinksViewer = {
  reservationId: number;
  quoteUrl: string | null;
  contractUrl: string | null;
  paymentUrl: string | null;
};

type CalendarDispo = {
  id: number;
  planningType?: "charter" | "technical_stop" | "maintenance" | "blocked";
  debut: string;
  fin: string;
  statut: "disponible" | "reserve" | "option" | "ferme";
  tarif: number | null;
  destination: string;
  note: string | null;
  notePublique: string | null;
  createdAt: string;
  updatedAt: string;
  capaciteTotale?: number;
  cabinesReservees?: number;
};

function toInputDateFromApi(iso: string) {
  return iso.slice(0, 10);
}

function toFrDate(isoLike: string) {
  const iso = String(isoLike || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return isoLike || "";
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.toLocaleDateString("fr-FR");
}

function toIsoDay(value?: string | null) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function getReservationStatus(r: Pick<ReservationRow, "requestStatus" | "workflowStatut">): ReservationStatus {
  const req = String(r.requestStatus || "");
  const wf = String(r.workflowStatut || "");
  if (wf === "solde_confirme") return "terminee_solde";
  if (wf === "acompte_confirme") return "validee_acompte";
  if (["validee_owner", "devis_accepte", "contrat_envoye", "contrat_signe"].includes(wf) || req === "validee") {
    return "devis_envoye";
  }
  return "nouvelle";
}

function toReservationStatusLabel(status: ReservationStatus) {
  if (status === "terminee_solde") return "Terminée (solde versé)";
  if (status === "validee_acompte") return "Validée (acompte reçu)";
  if (status === "devis_envoye") return "Devis envoyé";
  return "Nouvelle";
}

function reservationStatusLabelFromRow(r: Pick<ReservationRow, "requestStatus" | "workflowStatut">) {
  const status = getReservationStatus(r);
  if (status === "terminee_solde") return "Terminée (solde versé)";
  if (status === "validee_acompte") return "Validée (acompte reçu)";
  if (status === "devis_envoye") return "Devis envoyé";
  return "Nouvelle";
}

function mapReservationStatusToPayload(status: ReservationStatus, currentPaymentStatus: string) {
  if (status === "terminee_solde") {
    return { requestStatus: "validee", workflowStatut: "solde_confirme", statutPaiement: "paye" };
  }
  if (status === "validee_acompte") {
    return {
      requestStatus: "validee",
      workflowStatut: "acompte_confirme",
      statutPaiement: currentPaymentStatus === "en_attente" ? "paye" : currentPaymentStatus,
    };
  }
  if (status === "devis_envoye") {
    return { requestStatus: "validee", workflowStatut: "contrat_envoye", statutPaiement: currentPaymentStatus };
  }
  return { requestStatus: "nouvelle", workflowStatut: "demande", statutPaiement: currentPaymentStatus };
}

function isConfirmedReservationForCalendar(reservation: ReservationRow): boolean {
  const workflow = String(reservation.workflowStatut || "");
  const paymentStatus = String(reservation.statutPaiement || "");
  if (paymentStatus === "paye") return true;
  return workflow === "acompte_confirme" || workflow === "solde_confirme" || workflow === "contrat_signe";
}

export default function CharterSlotManager() {
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingReservation, setSavingReservation] = useState(false);
  const [creatingPaymentForId, setCreatingPaymentForId] = useState<number | null>(null);
  const [sendingProposalForId, setSendingProposalForId] = useState<number | null>(null);
  const [deletingReservationId, setDeletingReservationId] = useState<number | null>(null);
  const [consultingForId, setConsultingForId] = useState<number | null>(null);
  const [linksViewer, setLinksViewer] = useState<ReservationLinksViewer | null>(null);
  const [editingReservation, setEditingReservation] = useState<ReservationEditState | null>(null);
  const [savingReservationEdit, setSavingReservationEdit] = useState(false);
  const [reservationSearch, setReservationSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "en_attente" | "paye" | "echec" | "rembourse">("all");
  const [workflowFilter, setWorkflowFilter] = useState<"all" | ReservationStatus>("all");
  const [calendarMode, setCalendarMode] = useState<"list" | "calendar">("calendar");
  const [bulkMonth, setBulkMonth] = useState("");
  const [bulkProduct, setBulkProduct] = useState<CharterProductCode>("journee");
  const [generatingMonth, setGeneratingMonth] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const slotEditorRef = useRef<HTMLDivElement | null>(null);
  const [manualReservation, setManualReservation] = useState<{
    slotId: string;
    nomClient: string;
    emailClient: string;
    telClient: string;
    nbPersonnes: number;
    typeReservation: "bateau_entier" | "cabine" | "place";
    montantTotalEur: number;
    message: string;
  }>({
    slotId: "",
    nomClient: "",
    emailClient: "",
    telClient: "",
    nbPersonnes: 2,
    typeReservation: "cabine",
    montantTotalEur: 0,
    message: "Réservation prise par téléphone/email",
  });
  const [form, setForm] = useState<{
    product: CharterProductCode;
    debut: string;
    fin: string;
    active: boolean;
    note: string;
    publicNote: string;
  }>({
    product: "med",
    debut: "",
    fin: "",
    active: true,
    note: "",
    publicNote: "",
  });

  const load = async () => {
    try {
      setLoading(true);
      setMessage("");
      const from = "2020-01-01";
      const to = "2035-12-31";
      const [slotsRes, reservationsRes] = await Promise.all([
        fetch(
          `${apiUrl("/api/charter-slots")}?includeInactive=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { credentials: "include" }
        ),
        fetch(apiUrl("/api/reservations"), { credentials: "include" }),
      ]);
      const slotsData = await handleApiResponse<SlotRow[]>(slotsRes);
      const reservationsData = await handleApiResponse<ReservationRow[]>(reservationsRes);
      setRows(slotsData.sort((a, b) => a.debut.localeCompare(b.debut) || a.product.localeCompare(b.product)));
      setReservations(reservationsData.slice().sort((a, b) => String(b.dateDebut).localeCompare(String(a.dateDebut))));
    } catch (e: any) {
      setMessage(e?.message || "Erreur chargement.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startCreate = () => {
    setEditingId(null);
    setForm({ product: "med", debut: "", fin: "", active: true, note: "", publicNote: "" });
  };

  const startEdit = (r: SlotRow) => {
    setEditingId(r.id);
    setForm({
      product: r.product,
      debut: toInputDateFromApi(r.debut),
      fin: toInputDateFromApi(r.fin),
      active: r.active,
      note: r.note || "",
      publicNote: r.publicNote || "",
    });
  };

  const focusSlotEditor = () => {
    setCalendarMode("list");
    requestAnimationFrame(() => {
      slotEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const submit = async () => {
    try {
      setSaving(true);
      setMessage("");
      if (!form.debut || !form.fin) {
        setMessage("Renseignez le debut et la fin.");
        return;
      }
      const body = {
        product: form.product,
        debut: form.debut,
        fin: form.fin,
        active: form.active,
        note: form.note.trim() || null,
        publicNote: form.publicNote.trim() || null,
      };
      const res = await fetch(
        editingId ? apiUrl(`/api/charter-slots/${editingId}`) : apiUrl("/api/charter-slots"),
        {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
        }
      );
      await handleApiResponse(res);
      setMessage("Periode enregistree.");
      setEditingId(null);
      setForm((f) => ({ ...f, debut: "", fin: "", note: "", publicNote: "" }));
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Supprimer cette periode ?")) return;
    try {
      const res = await fetch(apiUrl(`/api/charter-slots/${id}`), { method: "DELETE", credentials: "include" });
      await handleApiResponse(res);
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur suppression.");
    }
  };

  const generateMonthDailySlots = async () => {
    try {
      if (!/^\d{4}-\d{2}$/.test(bulkMonth)) {
        setMessage("Choisissez un mois valide (AAAA-MM).");
        return;
      }
      setGeneratingMonth(true);
      setMessage("");
      const [year, month] = bulkMonth.split("-").map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      let created = 0;
      let skipped = 0;

      for (let day = 1; day <= daysInMonth; day += 1) {
        const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const res = await fetch(apiUrl("/api/charter-slots"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            product: bulkProduct,
            debut: iso,
            fin: iso,
            active: true,
            note: `Génération mensuelle ${bulkMonth}`,
            publicNote: null,
          }),
        });
        if (res.ok) {
          created += 1;
          continue;
        }
        const payload = await res.json().catch(() => ({}));
        const text = String(payload?.error || payload?.message || "");
        if (res.status === 409 || text.toLowerCase().includes("existe") || text.toLowerCase().includes("duplicate")) {
          skipped += 1;
          continue;
        }
        throw new Error(text || `Erreur création pour ${iso}`);
      }

      setMessage(`Génération terminée (${bulkMonth}) : ${created} créé(s), ${skipped} déjà existant(s).`);
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur génération mensuelle.");
    } finally {
      setGeneratingMonth(false);
    }
  };

  const createManualReservation = async () => {
    try {
      setSavingReservation(true);
      setMessage("");
      if (!manualReservation.slotId) {
        setMessage("Choisissez une période.");
        return;
      }
      if (!manualReservation.nomClient.trim() || !manualReservation.emailClient.trim()) {
        setMessage("Nom et email client requis.");
        return;
      }
      const selected = rows.find((r) => r.id === parseInt(manualReservation.slotId, 10));
      if (!selected) {
        setMessage("Période introuvable.");
        return;
      }
      const payload = {
        nomClient: manualReservation.nomClient.trim(),
        emailClient: manualReservation.emailClient.trim(),
        telClient: manualReservation.telClient.trim() || null,
        nbPersonnes: Math.max(1, manualReservation.nbPersonnes || 1),
        typeReservation: manualReservation.typeReservation,
        nbCabines:
          manualReservation.typeReservation === "cabine"
            ? Math.max(1, Math.ceil((manualReservation.nbPersonnes || 1) / 2))
            : manualReservation.typeReservation === "place"
              ? Math.max(1, manualReservation.nbPersonnes || 1)
              : 4,
        dateDebut: selected.debut,
        dateFin: selected.fin,
        disponibiliteId: null,
        destination: CHARTER_PRODUCT_LABELS[selected.product],
        formule: selected.product === "journee" ? "journee_privee" : "semaine",
        montantTotal: Math.max(100, Math.round((manualReservation.montantTotalEur || 0) * 100)),
        message: manualReservation.message || "Réservation backoffice",
        bookingOrigin: "direct",
        simpleRequest: true,
      };
      const res = await fetch(apiUrl("/api/reservations/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      await handleApiResponse(res);
      setMessage("Réservation manuelle enregistrée.");
      setManualReservation((m) => ({
        ...m,
        nomClient: "",
        emailClient: "",
        telClient: "",
        nbPersonnes: 2,
        montantTotalEur: 0,
      }));
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur création réservation.");
    } finally {
      setSavingReservation(false);
    }
  };

  const createMolliePaymentLink = async (reservationId: number) => {
    try {
      setCreatingPaymentForId(reservationId);
      setMessage("");
      const res = await fetch(apiUrl("/api/mollie/create-payment-link"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reservationId }),
      });
      const data = await handleApiResponse<{ checkoutUrl: string | null }>(res);
      if (data?.checkoutUrl) {
        window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
        setMessage("Lien de paiement Mollie généré et ouvert.");
      } else {
        setMessage("Lien généré, mais URL checkout absente.");
      }
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur création lien de paiement.");
    } finally {
      setCreatingPaymentForId(null);
    }
  };

  const sendProposalPack = async (reservationId: number) => {
    try {
      setSendingProposalForId(reservationId);
      setMessage("");

      const ownerValidateRes = await fetch(apiUrl(`/api/workflow/reservations/${reservationId}/owner-validate`), {
        method: "POST",
        credentials: "include",
      });
      await handleApiResponse(ownerValidateRes);

      const sendContractRes = await fetch(apiUrl(`/api/workflow/reservations/${reservationId}/send-contract`), {
        method: "POST",
        credentials: "include",
      });
      const sendContractData = await handleApiResponse<{ esign?: { signUrl?: string | null } }>(sendContractRes);

      const paymentRes = await fetch(apiUrl("/api/mollie/create-payment-link"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reservationId }),
      });
      const paymentData = await handleApiResponse<{ checkoutUrl: string | null }>(paymentRes);

      const sendProposalEmailRes = await fetch(apiUrl(`/api/workflow/reservations/${reservationId}/send-proposal-email`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          paymentUrl: paymentData?.checkoutUrl || null,
          contractSignUrl: sendContractData?.esign?.signUrl || null,
        }),
      });
      await handleApiResponse(sendProposalEmailRes);

      setMessage("Proposition envoyée au client par email (devis + contrat + lien de paiement).");
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur lors de l'envoi de la proposition.");
    } finally {
      setSendingProposalForId(null);
    }
  };

  const openReservationEdit = (r: ReservationRow) => {
    setEditingReservation({
      id: r.id,
      nomClient: r.nomClient || "",
      prenomClient: r.prenomClient || "",
      emailClient: r.emailClient || "",
      telClient: r.telClient || "",
      dateDebut: toInputDateFromApi(String(r.dateDebut)),
      dateFin: toInputDateFromApi(String(r.dateFin)),
      nbPersonnes: Math.max(1, Number(r.nbPersonnes || 1)),
      typeReservation: r.typeReservation || "cabine",
      montantTotalEur: Math.max(0, Number(r.montantTotal || 0) / 100),
      requestStatus: r.requestStatus || "nouvelle",
      workflowStatut: r.workflowStatut || "demande",
      statutPaiement: r.statutPaiement || "en_attente",
      destination: r.destination || "",
      formule: r.formule || "semaine",
      message: r.message || "",
      internalComment: r.internalComment || "",
      reservationStatus: getReservationStatus(r),
    });
  };

  const saveReservationEdit = async () => {
    if (!editingReservation) return;
    try {
      setSavingReservationEdit(true);
      setMessage("");
      const mapped = mapReservationStatusToPayload(editingReservation.reservationStatus, editingReservation.statutPaiement);
      const payload = {
        nomClient: editingReservation.nomClient.trim(),
        prenomClient: editingReservation.prenomClient.trim() || null,
        emailClient: editingReservation.emailClient.trim(),
        telClient: editingReservation.telClient.trim() || null,
        dateDebut: `${editingReservation.dateDebut}T00:00:00.000Z`,
        dateFin: `${editingReservation.dateFin}T00:00:00.000Z`,
        nbPersonnes: Math.max(1, Number(editingReservation.nbPersonnes || 1)),
        typeReservation: editingReservation.typeReservation,
        montantTotal: Math.max(100, Math.round((editingReservation.montantTotalEur || 0) * 100)),
        requestStatus: mapped.requestStatus,
        workflowStatut: mapped.workflowStatut,
        statutPaiement: mapped.statutPaiement,
        destination: editingReservation.destination,
        formule: editingReservation.formule,
        message: editingReservation.message,
        internalComment: editingReservation.internalComment,
      };
      const res = await fetch(apiUrl(`/api/reservations/${editingReservation.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      await handleApiResponse(res);
      setEditingReservation(null);
      setMessage("Réservation mise à jour.");
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur mise à jour réservation.");
    } finally {
      setSavingReservationEdit(false);
    }
  };

  const openReservationLinks = async (reservationId: number) => {
    try {
      setConsultingForId(reservationId);
      setMessage("");

      const docsRes = await fetch(apiUrl(`/api/workflow/reservations/${reservationId}/documents`), {
        credentials: "include",
      });
      const docs = await handleApiResponse<WorkflowDocumentsResponse>(docsRes);
      const sortedQuotes = (docs.quotes || []).slice().sort((a, b) => b.id - a.id);
      const sortedContracts = (docs.contracts || []).slice().sort((a, b) => b.id - a.id);
      const quoteUrl = sortedQuotes[0]?.downloadUrl || null;
      const contractUrl = sortedContracts[0]?.downloadUrl || null;

      let paymentUrl: string | null = null;
      const paymentRes = await fetch(apiUrl(`/api/mollie/payment-link/${reservationId}`), {
        credentials: "include",
      });
      if (paymentRes.ok) {
        const paymentData = await handleApiResponse<{ checkoutUrl: string | null }>(paymentRes);
        paymentUrl = paymentData?.checkoutUrl || null;
      }

      setLinksViewer({ reservationId, quoteUrl, contractUrl, paymentUrl });
      if (!quoteUrl && !contractUrl && !paymentUrl) {
        setMessage("Aucun devis/contrat/lien paiement disponible pour cette réservation.");
      }
    } catch (e: any) {
      setMessage(e?.message || "Erreur consultation documents.");
    } finally {
      setConsultingForId(null);
    }
  };

  const removeReservation = async (reservationId: number) => {
    if (!confirm("Supprimer cette réservation ? Cette action est irréversible.")) return;
    try {
      setDeletingReservationId(reservationId);
      setMessage("");
      const res = await fetch(apiUrl(`/api/reservations/${reservationId}`), {
        method: "DELETE",
        credentials: "include",
      });
      await handleApiResponse(res);
      setMessage("Réservation supprimée.");
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur suppression réservation.");
    } finally {
      setDeletingReservationId(null);
    }
  };

  const paymentCounts = useMemo(() => {
    return reservations.reduce(
      (acc, r) => {
        const key = (r.statutPaiement || "en_attente") as "en_attente" | "paye" | "echec" | "rembourse";
        if (key in acc) acc[key] += 1;
        return acc;
      },
      { en_attente: 0, paye: 0, echec: 0, rembourse: 0 }
    );
  }, [reservations]);

  const filteredReservations = useMemo(() => {
    const q = reservationSearch.trim().toLowerCase();
    return reservations.filter((r) => {
      const payment = (r.statutPaiement || "en_attente") as "en_attente" | "paye" | "echec" | "rembourse";
      const status = getReservationStatus(r);
      const matchesPayment = paymentFilter === "all" || payment === paymentFilter;
      const matchesWorkflow = workflowFilter === "all" || status === workflowFilter;
      const matchesSearch =
        !q ||
        String(r.nomClient || "").toLowerCase().includes(q) ||
        String(r.prenomClient || "").toLowerCase().includes(q) ||
        String(r.emailClient || "").toLowerCase().includes(q) ||
        String(r.telClient || "").toLowerCase().includes(q);
      return matchesPayment && matchesWorkflow && matchesSearch;
    });
  }, [reservations, reservationSearch, paymentFilter, workflowFilter]);

  const paymentBadgeClass = (status: string | null | undefined) => {
    const value = status || "en_attente";
    if (value === "paye") return "bg-emerald-100 text-emerald-700";
    if (value === "echec") return "bg-rose-100 text-rose-700";
    if (value === "rembourse") return "bg-slate-200 text-slate-700";
    return "bg-amber-100 text-amber-700";
  };

  const paymentLabel = (status: string | null | undefined) => {
    const value = status || "en_attente";
    if (value === "paye") return "Payée";
    if (value === "echec") return "Échec";
    if (value === "rembourse") return "Remboursée";
    return "En attente";
  };

  const workflowLabel = (reservation: ReservationRow) => {
    return reservationStatusLabelFromRow(reservation);
  };

  const dossierBadge = (reservation: ReservationRow) => {
    const value = getReservationStatus(reservation);
    if (value === "devis_envoye") return { label: "Devis envoyé", className: "bg-sky-100 text-sky-700" };
    if (value === "validee_acompte") return { label: "Validée (acompte reçu)", className: "bg-emerald-100 text-emerald-700" };
    if (value === "terminee_solde") return { label: "Terminée (solde versé)", className: "bg-indigo-100 text-indigo-700" };
    return { label: "Nouvelle", className: "bg-amber-100 text-amber-700" };
  };

  const reservationTypeLabel = (type: ReservationRow["typeReservation"]) => {
    if (type === "bateau_entier") return "Privatif";
    if (type === "place") return "Place";
    return "Cabine";
  };

  const calendarDisponibilites = useMemo<CalendarDispo[]>(
    () =>
      rows.map((slot) => {
        const slotStart = toIsoDay(slot.debut);
        const slotEnd = toIsoDay(slot.fin);
        const overlapping = reservations.filter((reservation) => {
          const resStart = toIsoDay(reservation.dateDebut);
          const resEnd = toIsoDay(reservation.dateFin);
          if (!slotStart || !slotEnd || !resStart || !resEnd) return false;
          if (!isReservationBlockingForCharterCalendar(reservation as any)) return false;
          return rangesOverlapForStay(resStart, resEnd, slotStart, slotEnd);
        });

        let reservedUnits = 0;
        if (isCruiseMultiUnitProduct(slot.product)) {
          const occ = aggregateCruiseCabineOccupancy(overlapping as any);
          reservedUnits = occ.hasPrivate ? CHARTER_CRUISE_CABIN_UNITS : Math.min(CHARTER_CRUISE_CABIN_UNITS, occ.reservedUnits);
        } else {
          reservedUnits = overlapping.length > 0 ? CHARTER_CRUISE_CABIN_UNITS : 0;
        }
        const hasOverlap = overlapping.length > 0;
        const hasConfirmed = overlapping.some((reservation) => isConfirmedReservationForCalendar(reservation));
        const computedStatut: CalendarDispo["statut"] = !slot.active
          ? "ferme"
          : hasOverlap && !hasConfirmed
            ? "option"
            : reservedUnits >= CHARTER_CRUISE_CABIN_UNITS
              ? "reserve"
              : "disponible";

        return {
          id: slot.id,
          planningType: "charter",
          debut: slot.debut,
          fin: slot.fin,
          statut: computedStatut,
          tarif: null,
          destination: CHARTER_PRODUCT_LABELS[slot.product],
          note: slot.note,
          notePublique: slot.publicNote,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          capaciteTotale: CHARTER_CRUISE_CABIN_UNITS,
          cabinesReservees: reservedUnits,
        } satisfies CalendarDispo;
      }),
    [rows, reservations]
  );

  const calendarReservations = useMemo(
    () =>
      reservations.map((r) => ({
        ...r,
        bookingOrigin: (r.bookingOrigin as "direct" | "clicknboat" | "skippair" | "samboat" | undefined) || "direct",
        requestStatus: (r.requestStatus as "nouvelle" | "en_cours" | "validee" | "refusee" | "archivee" | undefined) || "nouvelle",
        statutPaiement: (r.statutPaiement as "en_attente" | "paye" | "echec" | "rembourse" | undefined) || "en_attente",
      })),
    [reservations]
  );

  const createReservationFromCalendar = (dispo: CalendarDispo) => {
    setManualReservation((m) => ({ ...m, slotId: String(dispo.id) }));
    setCalendarMode("list");
    setMessage("Période préremplie pour créer une réservation manuelle.");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" style={{ borderColor: "#d7e3e8" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold" style={{ color: BRAND_DEEP }}>
            Calendrier Backoffice
          </h2>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setCalendarMode("calendar")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${calendarMode === "calendar" ? "text-white" : "text-slate-700"}`}
              style={calendarMode === "calendar" ? { backgroundColor: BRAND_DEEP } : {}}
            >
              Vue calendrier
            </button>
            <button
              type="button"
              onClick={() => setCalendarMode("list")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${calendarMode === "list" ? "text-white" : "text-slate-700"}`}
              style={calendarMode === "list" ? { backgroundColor: BRAND_DEEP } : {}}
            >
              Vue listes
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Clique sur une période pour la modifier, supprimer, ou créer une réservation directement.
        </p>
      </div>

      {calendarMode === "calendar" && (
        <AdminCalendarView
          disponibilites={calendarDisponibilites}
          reservations={calendarReservations as any}
          onEdit={(d) => {
            const row = rows.find((r) => r.id === d.id);
            if (row) {
              startEdit(row);
              focusSlotEditor();
            }
          }}
          onDelete={async (id) => {
            try {
              await remove(id);
              return true;
            } catch {
              return false;
            }
          }}
          onCreateSlot={startCreate}
          onCreateReservation={createReservationFromCalendar}
          onEditReservation={async (reservationId) => {
            const res = await fetch(apiUrl(`/api/reservations/${reservationId}`), { credentials: "include" });
            const reservation = await handleApiResponse<ReservationRow>(res);
            openReservationEdit(reservation);
          }}
          loading={loading}
        />
      )}

      {calendarMode === "list" && (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderColor: "#d7e3e8" }}>
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Outil rapide</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              type="month"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={bulkMonth}
              onChange={(e) => setBulkMonth(e.target.value)}
            />
            <select
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={bulkProduct}
              onChange={(e) => setBulkProduct(e.target.value as CharterProductCode)}
            >
              {CHARTER_PRODUCTS.map((p) => (
                <option key={p} value={p}>
                  {CHARTER_PRODUCT_LABELS[p]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={generateMonthDailySlots}
              disabled={generatingMonth}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND_DEEP }}
            >
              {generatingMonth ? "Génération..." : "Générer 1 mois"}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Crée automatiquement une période par jour sur le mois choisi.</p>
        </div>

        <h2 className="text-2xl font-bold" style={{ color: BRAND_DEEP }}>
          Réservations
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Créez une réservation manuelle (téléphone / email) puis suivez les dernières demandes.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-800">Dernières réservations</h3>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-700">
                  En attente: {paymentCounts.en_attente}
                </span>
                <span className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-700">
                  Payées: {paymentCounts.paye}
                </span>
                <span className="rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-700">
                  Échecs: {paymentCounts.echec}
                </span>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <input
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Recherche client (nom, email, téléphone)"
                value={reservationSearch}
                onChange={(e) => setReservationSearch(e.target.value)}
              />
              <select
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value as typeof paymentFilter)}
              >
                <option value="all">Paiement: tous</option>
                <option value="en_attente">Paiement: en attente</option>
                <option value="paye">Paiement: payées</option>
                <option value="echec">Paiement: échecs</option>
                <option value="rembourse">Paiement: remboursées</option>
              </select>
              <select
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={workflowFilter}
                onChange={(e) => setWorkflowFilter(e.target.value as typeof workflowFilter)}
              >
                <option value="all">Statut: tous</option>
                <option value="nouvelle">Statut: nouvelle</option>
                <option value="devis_envoye">Statut: devis envoyé</option>
                <option value="validee_acompte">Statut: validée (acompte reçu)</option>
                <option value="terminee_solde">Statut: terminée (solde versé)</option>
              </select>
            </div>

            <div className="mt-2 text-xs text-slate-500">
              {filteredReservations.length} réservation(s) affichée(s) sur {reservations.length}
            </div>

            {reservations.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Aucune réservation.</p>
            ) : filteredReservations.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Aucun résultat pour ces filtres.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-2">Client</th>
                      <th className="py-2 pr-2">Période</th>
                      <th className="py-2 pr-2">Type</th>
                      <th className="py-2 pr-2">Statut</th>
                      <th className="py-2 pr-2">Total</th>
                      <th className="py-2 pr-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReservations.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100">
                        <td className="py-2 pr-2">
                          <div className="font-medium text-slate-800">
                            👤 {r.prenomClient ? `${r.prenomClient} ${r.nomClient}` : r.nomClient}
                          </div>
                          <div className="text-xs text-slate-500">{r.emailClient}</div>
                        </td>
                        <td className="py-2 pr-2 text-slate-700">
                          {toFrDate(String(r.dateDebut))} <span className="text-slate-400">→</span> {toFrDate(String(r.dateFin))}
                        </td>
                        <td className="py-2 pr-2 text-slate-700">
                          <div>{reservationTypeLabel(r.typeReservation)}</div>
                          <div className="text-xs text-slate-500">{r.nbPersonnes} pers.</div>
                        </td>
                        <td className="py-2 pr-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${dossierBadge(r).className}`}>
                            {dossierBadge(r).label}
                          </span>
                          <div className="mt-1">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${paymentBadgeClass(r.statutPaiement)}`}>
                              Paiement: {paymentLabel(r.statutPaiement)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">⚙ {workflowLabel(r)}</div>
                        </td>
                        <td className="py-2 pr-2 font-semibold text-slate-800">
                          {(Number(r.montantTotal || 0) / 100).toLocaleString("fr-FR")} €
                        </td>
                        <td className="py-2 pr-2 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => sendProposalPack(r.id)}
                            disabled={sendingProposalForId === r.id}
                            className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            title="Génère/envoie devis + contrat, puis crée le lien de paiement"
                          >
                            {sendingProposalForId === r.id ? "Envoi..." : "Envoyer la proposition"}
                          </button>
                          <button
                            type="button"
                            onClick={() => openReservationEdit(r)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Éditer
                          </button>
                          <button
                            type="button"
                            onClick={() => createMolliePaymentLink(r.id)}
                            disabled={creatingPaymentForId === r.id}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {creatingPaymentForId === r.id ? "Création..." : "Lien paiement"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeReservation(r.id)}
                            disabled={deletingReservationId === r.id}
                            className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                          >
                            {deletingReservationId === r.id ? "Suppression..." : "Supprimer"}
                          </button>
                          <button
                            type="button"
                            onClick={() => openReservationLinks(r.id)}
                            disabled={consultingForId === r.id}
                            className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                          >
                            {consultingForId === r.id ? "Chargement..." : "Consulter"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-800">Nouvelle réservation manuelle</h3>
            <div className="mt-3 grid gap-2 text-sm">
              <select
                className="rounded-lg border border-slate-200 px-3 py-2"
                value={manualReservation.slotId}
                onChange={(e) => setManualReservation((m) => ({ ...m, slotId: e.target.value }))}
              >
                <option value="">Sélectionner une période</option>
                {rows
                  .filter((r) => r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {CHARTER_PRODUCT_LABELS[r.product]} · {toFrDate(r.debut)} → {toFrDate(r.fin)}
                    </option>
                  ))}
              </select>
              <input
                className="rounded-lg border border-slate-200 px-3 py-2"
                placeholder="Nom client"
                value={manualReservation.nomClient}
                onChange={(e) => setManualReservation((m) => ({ ...m, nomClient: e.target.value }))}
              />
              <input
                className="rounded-lg border border-slate-200 px-3 py-2"
                placeholder="Email client"
                type="email"
                value={manualReservation.emailClient}
                onChange={(e) => setManualReservation((m) => ({ ...m, emailClient: e.target.value }))}
              />
              <input
                className="rounded-lg border border-slate-200 px-3 py-2"
                placeholder="Téléphone"
                value={manualReservation.telClient}
                onChange={(e) => setManualReservation((m) => ({ ...m, telClient: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2"
                  type="number"
                  min={1}
                  placeholder="Nb passagers"
                  value={manualReservation.nbPersonnes}
                  onChange={(e) =>
                    setManualReservation((m) => ({ ...m, nbPersonnes: Math.max(1, parseInt(e.target.value || "1", 10)) }))
                  }
                />
                <select
                  className="rounded-lg border border-slate-200 px-3 py-2"
                  value={manualReservation.typeReservation}
                  onChange={(e) =>
                    setManualReservation((m) => ({
                      ...m,
                      typeReservation: e.target.value as "bateau_entier" | "cabine" | "place",
                    }))
                  }
                >
                  <option value="bateau_entier">Privatif</option>
                  <option value="cabine">Cabine</option>
                  <option value="place">Place</option>
                </select>
              </div>
              <input
                className="rounded-lg border border-slate-200 px-3 py-2"
                type="number"
                min={0}
                placeholder="Montant total (€)"
                value={manualReservation.montantTotalEur}
                onChange={(e) =>
                  setManualReservation((m) => ({ ...m, montantTotalEur: Math.max(0, Number(e.target.value || 0)) }))
                }
              />
              <textarea
                className="rounded-lg border border-slate-200 px-3 py-2"
                rows={2}
                placeholder="Commentaire"
                value={manualReservation.message}
                onChange={(e) => setManualReservation((m) => ({ ...m, message: e.target.value }))}
              />
              <button
                type="button"
                onClick={createManualReservation}
                disabled={savingReservation}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: BRAND_DEEP }}
              >
                {savingReservation ? "Enregistrement..." : "Créer la réservation"}
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {linksViewer && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Documents & paiement #{linksViewer.reservationId}</h3>
              <button className="text-sm text-slate-500 hover:underline" onClick={() => setLinksViewer(null)}>
                Fermer
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <a
                className={`block rounded-lg border px-3 py-2 ${linksViewer.quoteUrl ? "border-slate-200 text-slate-800 hover:bg-slate-50" : "border-slate-100 text-slate-400"}`}
                href={linksViewer.quoteUrl || undefined}
                target="_blank"
                rel="noreferrer"
              >
                📄 Devis {linksViewer.quoteUrl ? "" : "(indisponible)"}
              </a>
              <a
                className={`block rounded-lg border px-3 py-2 ${linksViewer.contractUrl ? "border-slate-200 text-slate-800 hover:bg-slate-50" : "border-slate-100 text-slate-400"}`}
                href={linksViewer.contractUrl || undefined}
                target="_blank"
                rel="noreferrer"
              >
                📝 Contrat {linksViewer.contractUrl ? "" : "(indisponible)"}
              </a>
              <a
                className={`block rounded-lg border px-3 py-2 ${linksViewer.paymentUrl ? "border-slate-200 text-slate-800 hover:bg-slate-50" : "border-slate-100 text-slate-400"}`}
                href={linksViewer.paymentUrl || undefined}
                target="_blank"
                rel="noreferrer"
              >
                💳 Lien de paiement {linksViewer.paymentUrl ? "" : "(indisponible)"}
              </a>
            </div>
          </div>
        </div>
      )}

      {editingReservation && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Éditer réservation #{editingReservation.id}</h3>
              <button className="text-sm text-slate-500 hover:underline" onClick={() => setEditingReservation(null)}>
                Fermer
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.nomClient} onChange={(e) => setEditingReservation((s) => s && ({ ...s, nomClient: e.target.value }))} placeholder="Nom" />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.prenomClient} onChange={(e) => setEditingReservation((s) => s && ({ ...s, prenomClient: e.target.value }))} placeholder="Prénom" />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.emailClient} onChange={(e) => setEditingReservation((s) => s && ({ ...s, emailClient: e.target.value }))} placeholder="Email" />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.telClient} onChange={(e) => setEditingReservation((s) => s && ({ ...s, telClient: e.target.value }))} placeholder="Téléphone" />
              <input type="date" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.dateDebut} onChange={(e) => setEditingReservation((s) => s && ({ ...s, dateDebut: e.target.value }))} />
              <input type="date" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.dateFin} onChange={(e) => setEditingReservation((s) => s && ({ ...s, dateFin: e.target.value }))} />
              <input type="number" min={1} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.nbPersonnes} onChange={(e) => setEditingReservation((s) => s && ({ ...s, nbPersonnes: Math.max(1, Number(e.target.value || 1)) }))} />
              <input type="number" min={0} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.montantTotalEur} onChange={(e) => setEditingReservation((s) => s && ({ ...s, montantTotalEur: Math.max(0, Number(e.target.value || 0)) }))} placeholder="Montant total €" />
              <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.typeReservation} onChange={(e) => setEditingReservation((s) => s && ({ ...s, typeReservation: e.target.value as "bateau_entier" | "cabine" | "place" }))}>
                <option value="bateau_entier">bateau_entier</option>
                <option value="cabine">cabine</option>
                <option value="place">place</option>
              </select>
              <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.statutPaiement} onChange={(e) => setEditingReservation((s) => s && ({ ...s, statutPaiement: e.target.value }))}>
                <option value="en_attente">en_attente</option>
                <option value="paye">paye</option>
                <option value="echec">echec</option>
                <option value="rembourse">rembourse</option>
              </select>
              <select
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={editingReservation.reservationStatus}
                onChange={(e) =>
                  setEditingReservation((s) => (s ? { ...s, reservationStatus: e.target.value as ReservationStatus } : s))
                }
              >
                <option value="nouvelle">nouvelle</option>
                <option value="devis_envoye">devis envoyé</option>
                <option value="validee_acompte">validée (acompte reçu)</option>
                <option value="terminee_solde">terminée (solde versé)</option>
              </select>
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.destination} onChange={(e) => setEditingReservation((s) => s && ({ ...s, destination: e.target.value }))} placeholder="Destination" />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.formule} onChange={(e) => setEditingReservation((s) => s && ({ ...s, formule: e.target.value }))} placeholder="Formule" />
              <textarea className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2" rows={2} value={editingReservation.message} onChange={(e) => setEditingReservation((s) => s && ({ ...s, message: e.target.value }))} placeholder="Message client" />
              <textarea className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2" rows={2} value={editingReservation.internalComment} onChange={(e) => setEditingReservation((s) => s && ({ ...s, internalComment: e.target.value }))} placeholder="Commentaire interne" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700" onClick={() => setEditingReservation(null)}>
                Annuler
              </button>
              <button
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: BRAND_DEEP }}
                disabled={savingReservationEdit}
                onClick={saveReservationEdit}
              >
                {savingReservationEdit ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-3xl font-bold" style={{ color: BRAND_DEEP }}>
          Périodes & produits
        </h2>
        <p className="mt-1 text-slate-600">
          Une periode = plage de dates (debut a fin) pour l&apos;un des quatre produits. Le site n&apos;affiche que les periodes
          <span className="font-semibold"> actifs</span>.
        </p>
      </div>

      {message && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div ref={slotEditorRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderColor: "#d7e3e8" }}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold" style={{ color: BRAND_DEEP }}>
              {editingId ? "Modifier la periode" : "Nouvelle periode"}
            </h3>
            <button type="button" onClick={startCreate} className="text-sm font-semibold text-slate-600 hover:underline">
              Vider
            </button>
          </div>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Produit</span>
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.product}
                onChange={(e) => setForm((f) => ({ ...f, product: e.target.value as CharterProductCode }))}
              >
                {CHARTER_PRODUCTS.map((p) => (
                  <option key={p} value={p}>
                    {CHARTER_PRODUCT_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Debut</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                  value={form.debut}
                  onChange={(e) => setForm((f) => ({ ...f, debut: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Fin</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                  value={form.fin}
                  onChange={(e) => setForm((f) => ({ ...f, fin: e.target.value }))}
                />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <span>Actif sur le site</span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Note interne (optionnel)</span>
              <textarea
                rows={2}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Texte public (optionnel)</span>
              <textarea
                rows={2}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.publicNote}
                onChange={(e) => setForm((f) => ({ ...f, publicNote: e.target.value }))}
                placeholder="court message a afficher cote client (plus tard)"
              />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND_DEEP, boxShadow: "0 10px 20px rgba(0,56,74,0.2)" }}
            >
              {saving ? "Enregistrement..." : editingId ? "Mettre a jour" : "Ajouter la periode"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderColor: "#d7e3e8" }}>
          <h3 className="text-lg font-bold" style={{ color: BRAND_DEEP }}>
            Liste
          </h3>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Chargement...</p>
          ) : rows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Aucune periode. Creez la premiere a gauche.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-2">Produit</th>
                    <th className="py-2 pr-2">Dates</th>
                    <th className="py-2 pr-2">Actif</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="py-2 pr-2 font-medium" style={{ color: BRAND_DEEP }}>
                        {CHARTER_PRODUCT_LABELS[r.product]}
                      </td>
                      <td className="py-2 pr-2 text-slate-700">
                        {toFrDate(r.debut)} <span className="text-slate-400">→</span> {toFrDate(r.fin)}
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{
                            color: r.active ? BRAND_DEEP : "#64748b",
                            backgroundColor: r.active ? `${BRAND_SAND}50` : "#f1f5f9",
                          }}
                        >
                          {r.active ? "oui" : "non"}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="mr-2 text-xs font-semibold text-slate-600 hover:underline"
                        >
                          Editer
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r.id)}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
