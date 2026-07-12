import { describe, expect, it } from "vitest";
import { buildContractPdf } from "../server/_core/commercialDocs";

const dayReservation = {
  id: 2,
  nomClient: "Smith John",
  prenomClient: "John",
  emailClient: "john@example.com",
  telClient: "0600000001",
  nbPersonnes: 8,
  formule: "journee",
  destination: "Calanques",
  dateDebut: new Date("2026-07-15T10:00:00Z"),
  dateFin: new Date("2026-07-15T16:00:00Z"),
  montantTotal: 180000,
  typeReservation: "bateau_entier",
  montantPaye: 0,
  statutPaiement: "en_attente",
  typePaiement: "acompte",
  requestStatus: "nouvelle",
  workflowStatut: "demande",
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

const weekReservation = {
  id: 3,
  nomClient: "Brown Alice",
  prenomClient: "Alice",
  emailClient: "alice@example.com",
  telClient: "0600000002",
  nbPersonnes: 2,
  formule: "semaine",
  destination: "Corse",
  dateDebut: new Date("2026-08-01"),
  dateFin: new Date("2026-08-08"),
  montantTotal: 450000,
  typeReservation: "cabine",
  montantPaye: 0,
  statutPaiement: "en_attente",
  typePaiement: "acompte",
  requestStatus: "nouvelle",
  workflowStatut: "demande",
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

describe("english charter contracts", () => {
  it("generates an english day charter contract pdf", async () => {
    const bytes = await buildContractPdf(dayReservation, "CT-2026-2", { language: "en" });
    expect(bytes.byteLength).toBeGreaterThan(5000);
  });

  it("generates an english week charter contract pdf", async () => {
    const bytes = await buildContractPdf(weekReservation, "CT-2026-3", { language: "en" });
    expect(bytes.byteLength).toBeGreaterThan(8000);
  });
});
