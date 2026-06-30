export type CustomerReservationRecapInput = {
  workflowStatut?: string | null;
  montantPaye?: number | null;
  statutPaiement?: string | null;
  montantTotal?: number | null;
  acompteMontant?: number | null;
  soldeMontant?: number | null;
  soldeEcheanceAt?: string | null;
};

export function hasAcompteBeenPaid(r: CustomerReservationRecapInput): boolean {
  const montantPaye = Number(r.montantPaye || 0);
  if (montantPaye <= 0) return false;
  const acompteDue = Number(r.acompteMontant || 0);
  if (acompteDue > 0) return montantPaye >= acompteDue;
  return true;
}

export function hasSoldeBeenPaid(r: CustomerReservationRecapInput): boolean {
  const montantTotal = Number(r.montantTotal || 0);
  const montantPaye = Number(r.montantPaye || 0);
  if (montantTotal <= 0) return false;
  return Number(r.workflowStatut || "") === "solde_confirme" && montantPaye >= montantTotal;
}

export function customerReservationRecap(r: CustomerReservationRecapInput) {
  const ws = r.workflowStatut || "demande";
  const acompteReceived = hasAcompteBeenPaid(r);
  const soldePaid = hasSoldeBeenPaid(r);

  const quoteSigned = ["contrat_signe", "acompte_attente", "acompte_confirme", "solde_confirme"].includes(ws);
  const reservationValidated = acompteReceived;
  const soldePending = acompteReceived && !soldePaid;

  return { quoteSigned, acompteReceived, reservationValidated, soldePending, soldePaid };
}

export function customerAcompteRecapLabel(r: CustomerReservationRecapInput): string {
  const acompteDue = Number(r.acompteMontant || 0);
  const amountSuffix =
    acompteDue > 0 ? ` (${(acompteDue / 100).toLocaleString("fr-FR")} EUR)` : "";
  return hasAcompteBeenPaid(r) ? `Acompte reçu${amountSuffix}` : `Acompte à régler${amountSuffix}`;
}

export function customerSoldeRecapLabel(r: CustomerReservationRecapInput): string {
  const soldeDue = Number(r.soldeMontant || 0);
  const amountSuffix =
    soldeDue > 0 ? ` - ${(soldeDue / 100).toLocaleString("fr-FR")} EUR` : "";
  const recap = customerReservationRecap(r);
  if (recap.soldePaid) return `Solde versé${amountSuffix}`;
  if (recap.soldePending) {
    const dueSuffix = r.soldeEcheanceAt
      ? ` (échéance ${new Date(r.soldeEcheanceAt).toLocaleDateString("fr-FR")})`
      : " (J-45 avant départ)";
    return `Solde attendu${dueSuffix}${amountSuffix}`;
  }
  return "Solde à régler après l'acompte";
}

const WORKFLOW_LABELS: Record<string, string> = {
  demande: "Demande en cours",
  refusee: "Demande refusée",
  validee_owner: "Demande validée",
  devis_emis: "Devis émis",
  devis_accepte: "Devis accepté",
  contrat_envoye: "Devis / contrat envoyé",
  contrat_signe: "Contrat signé",
  acompte_attente: "En attente de l'acompte",
  acompte_confirme: "Acompte reçu",
  facture_emise: "Facture émise",
  solde_attendu: "Solde en attente",
  solde_confirme: "Solde réglé",
};

export function customerWorkflowStatusLabel(r: CustomerReservationRecapInput): string {
  const ws = r.workflowStatut || "demande";
  if ((ws === "acompte_confirme" || ws === "acompte_attente") && !hasAcompteBeenPaid(r)) {
    return "En attente de l'acompte";
  }
  if (ws === "acompte_confirme" && hasAcompteBeenPaid(r)) {
    return "Acompte reçu";
  }
  if (ws === "solde_confirme" && !hasSoldeBeenPaid(r)) {
    return "Solde en attente";
  }
  return WORKFLOW_LABELS[ws] || "Demande en cours";
}
