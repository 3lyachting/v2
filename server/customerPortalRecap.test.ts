import { describe, expect, it } from "vitest";
import { customerAcompteRecapLabel, customerReservationRecap, customerWorkflowStatusLabel, hasAcompteBeenPaid } from "../shared/customerPortalRecap";

describe("customerPortalRecap", () => {
  it("does not mark acompte received when workflow says so but nothing was paid", () => {
    const r = {
      workflowStatut: "acompte_confirme",
      montantPaye: 0,
      statutPaiement: "paye",
      acompteMontant: 50000,
      montantTotal: 250000,
    };
    expect(hasAcompteBeenPaid(r)).toBe(false);
    const recap = customerReservationRecap(r);
    expect(recap.acompteReceived).toBe(false);
    expect(recap.reservationValidated).toBe(false);
    expect(customerWorkflowStatusLabel(r)).toBe("En attente de l'acompte");
  });

  it("marks acompte received when payment matches due amount", () => {
    const r = {
      workflowStatut: "acompte_confirme",
      montantPaye: 50000,
      statutPaiement: "paye",
      acompteMontant: 50000,
      montantTotal: 250000,
    };
    const recap = customerReservationRecap(r);
    expect(recap.acompteReceived).toBe(true);
    expect(recap.reservationValidated).toBe(true);
    expect(recap.soldePending).toBe(true);
    expect(recap.soldePaid).toBe(false);
    expect(customerWorkflowStatusLabel(r)).toBe("Acompte reçu");
  });

  it("does not show solde as paid before acompte is received", () => {
    const r = {
      workflowStatut: "contrat_envoye",
      montantPaye: 0,
      acompteMontant: 11600,
      soldeMontant: 46400,
      montantTotal: 58000,
    };
    const recap = customerReservationRecap(r);
    expect(recap.acompteReceived).toBe(false);
    expect(recap.soldePaid).toBe(false);
    expect(recap.soldePending).toBe(false);
    expect(customerAcompteRecapLabel(r)).toBe("Acompte à régler (116 EUR)");
  });
});
