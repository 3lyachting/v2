import { describe, expect, it } from "vitest";
import { buildContractPdf, buildQuotePdf, isTransatReservation } from "../server/_core/commercialDocs";

const transatReservation = {
  id: 1,
  nomClient: "Dupont Jean",
  prenomClient: "Jean",
  emailClient: "jean@example.com",
  telClient: "0600000000",
  nbPersonnes: 1,
  nbCabines: 1,
  formule: "traversee",
  destination: "Transat aller La Ciotat -> Pointe-a-Pitre",
  dateDebut: new Date("2026-11-10"),
  dateFin: new Date("2026-12-05"),
  montantTotal: 300000,
  typeReservation: "place",
  montantPaye: 0,
  statutPaiement: "en_attente",
  typePaiement: "acompte",
  requestStatus: "nouvelle",
  workflowStatut: "demande",
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

describe("transat berth contract", () => {
  it("detects transat reservations", () => {
    expect(isTransatReservation(transatReservation)).toBe(true);
  });

  it("generates a multi-page transat contract pdf", async () => {
    const bytes = await buildContractPdf(transatReservation, "CT-2026-1");
    expect(bytes.byteLength).toBeGreaterThan(5000);
  });

  it("generates a transat quote pdf", async () => {
    const bytes = await buildQuotePdf(transatReservation, "DV-2026-1");
    expect(bytes.byteLength).toBeGreaterThan(5000);
  });
});
