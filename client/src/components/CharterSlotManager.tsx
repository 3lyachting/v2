import { useEffect, useMemo, useState } from "react";
import { apiUrl, handleApiResponse } from "@/lib/apiBase";
import {
  CHARTER_PRODUCT_LABELS,
  CHARTER_PRODUCTS,
  type CharterProductCode,
} from "@shared/charterProduct";

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

export default function CharterSlotManager() {
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingReservation, setSavingReservation] = useState(false);
  const [creatingPaymentForId, setCreatingPaymentForId] = useState<number | null>(null);
  const [sendingProposalForId, setSendingProposalForId] = useState<number | null>(null);
  const [editingReservation, setEditingReservation] = useState<ReservationEditState | null>(null);
  const [savingReservationEdit, setSavingReservationEdit] = useState(false);
  const [reservationSearch, setReservationSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "en_attente" | "paye" | "echec" | "rembourse">("all");
  const [workflowFilter, setWorkflowFilter] = useState<"all" | "demande" | "validee_owner" | "contrat_envoye" | "contrat_signe" | "acompte_confirme" | "solde_confirme">("all");
  const [editingId, setEditingId] = useState<number | null>(null);
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
      const [slotsRes, reservationsRes] = await Promise.all([
        fetch(`${apiUrl("/api/charter-slots")}?includeInactive=1`, { credentials: "include" }),
        fetch(apiUrl("/api/reservations"), { credentials: "include" }),
      ]);
      const slotsData = await handleApiResponse<SlotRow[]>(slotsRes);
      const reservationsData = await handleApiResponse<ReservationRow[]>(reservationsRes);
      setRows(slotsData.sort((a, b) => a.debut.localeCompare(b.debut) || a.product.localeCompare(b.product)));
      setReservations(
        reservationsData
          .slice()
          .sort((a, b) => String(b.dateDebut).localeCompare(String(a.dateDebut)))
          .slice(0, 20)
      );
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
      await handleApiResponse(sendContractRes);

      const paymentRes = await fetch(apiUrl("/api/mollie/create-payment-link"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reservationId }),
      });
      const paymentData = await handleApiResponse<{ checkoutUrl: string | null }>(paymentRes);
      if (paymentData?.checkoutUrl) {
        window.open(paymentData.checkoutUrl, "_blank", "noopener,noreferrer");
      }

      setMessage("Proposition envoyée : devis + contrat générés/envoyés, lien de paiement créé.");
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
    });
  };

  const saveReservationEdit = async () => {
    if (!editingReservation) return;
    try {
      setSavingReservationEdit(true);
      setMessage("");
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
        requestStatus: editingReservation.requestStatus,
        workflowStatut: editingReservation.workflowStatut,
        statutPaiement: editingReservation.statutPaiement,
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
      const workflow = (r.workflowStatut || "demande") as
        | "demande"
        | "validee_owner"
        | "contrat_envoye"
        | "contrat_signe"
        | "acompte_confirme"
        | "solde_confirme";
      const matchesPayment = paymentFilter === "all" || payment === paymentFilter;
      const matchesWorkflow = workflowFilter === "all" || workflow === workflowFilter;
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

  const workflowLabel = (status: string | null | undefined) => {
    const value = status || "demande";
    if (value === "validee_owner") return "Validée owner";
    if (value === "contrat_envoye") return "Contrat envoyé";
    if (value === "contrat_signe") return "Contrat signé";
    if (value === "acompte_confirme") return "Acompte confirmé";
    if (value === "solde_confirme") return "Solde confirmé";
    return "Demande";
  };

  const reservationTypeLabel = (type: ReservationRow["typeReservation"]) => {
    if (type === "bateau_entier") return "Privatif";
    if (type === "place") return "Place";
    return "Cabine";
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderColor: "#d7e3e8" }}>
        <h2 className="text-2xl font-bold" style={{ color: BRAND_DEEP }}>
          Réservations
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Créez une réservation manuelle (téléphone / email) puis suivez les dernières demandes.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
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
                      {CHARTER_PRODUCT_LABELS[r.product]} · {toInputDateFromApi(r.debut)} → {toInputDateFromApi(r.fin)}
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

          <div className="rounded-xl border border-slate-200 bg-white p-4">
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
                <option value="all">Workflow: tous</option>
                <option value="demande">Workflow: demande</option>
                <option value="validee_owner">Workflow: validée owner</option>
                <option value="contrat_envoye">Workflow: contrat envoyé</option>
                <option value="contrat_signe">Workflow: contrat signé</option>
                <option value="acompte_confirme">Workflow: acompte confirmé</option>
                <option value="solde_confirme">Workflow: solde confirmé</option>
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
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-2">Client</th>
                      <th className="py-2 pr-2">Période</th>
                      <th className="py-2 pr-2">Type</th>
                      <th className="py-2 pr-2">Paiement</th>
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
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${paymentBadgeClass(r.statutPaiement)}`}>
                            {paymentLabel(r.statutPaiement)}
                          </span>
                          <div className="mt-1 text-xs text-slate-500">⚙ {workflowLabel(r.workflowStatut)}</div>
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
              <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.requestStatus} onChange={(e) => setEditingReservation((s) => s && ({ ...s, requestStatus: e.target.value }))}>
                <option value="nouvelle">nouvelle</option>
                <option value="en_cours">en_cours</option>
                <option value="validee">validee</option>
                <option value="refusee">refusee</option>
                <option value="archivee">archivee</option>
              </select>
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editingReservation.workflowStatut} onChange={(e) => setEditingReservation((s) => s && ({ ...s, workflowStatut: e.target.value }))} placeholder="workflowStatut" />
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
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderColor: "#d7e3e8" }}>
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
