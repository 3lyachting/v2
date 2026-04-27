import "dotenv/config";
import { and, eq, gte, lte } from "drizzle-orm";
import { disponibilites, reservations } from "../../drizzle/schema";
import { syncDisponibilitesFromReservations } from "../_core/bookingRules";
import { getDb } from "../db";

type SlotSeed = {
  start: string;
  end: string;
  destination: string;
  statut: "disponible" | "reserve" | "option" | "ferme";
  planningType?: "charter" | "technical_stop" | "maintenance" | "blocked";
  tarifJourPriva?: number;
  tarifJourPersonne?: number;
  tarifCabine?: number;
  tarif?: number;
  capaciteTotale?: number;
  cabinesReservees?: number;
  notePublique?: string;
  note?: string;
};

type ReservationSeed = {
  name: string;
  email: string;
  people: number;
  formule: "journee" | "semaine";
  destination: string;
  start: string;
  end: string;
  totalEuro: number;
  type: "bateau_entier" | "cabine";
  nbCabines: number;
  workflow:
    | "devis_emis"
    | "acompte_confirme"
    | "contrat_signe"
    | "solde_confirme";
  requestStatus: "en_cours" | "validee";
  internalComment?: string;
};

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function upsertSlot(slot: SlotSeed) {
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible");
  const debut = toDate(slot.start);
  const fin = toDate(slot.end);

  const existing = await db
    .select({ id: disponibilites.id })
    .from(disponibilites)
    .where(and(eq(disponibilites.debut, debut), eq(disponibilites.fin, fin), eq(disponibilites.destination, slot.destination)))
    .limit(1);

  if (existing[0]?.id) {
    await db
      .update(disponibilites)
      .set({
        statut: slot.statut,
        planningType: slot.planningType ?? "charter",
        tarifJourPriva: slot.tarifJourPriva ?? null,
        tarifJourPersonne: slot.tarifJourPersonne ?? null,
        tarifCabine: slot.tarifCabine ?? null,
        tarif: slot.tarif ?? null,
        capaciteTotale: slot.capaciteTotale ?? 4,
        cabinesReservees: slot.cabinesReservees ?? 0,
        notePublique: slot.notePublique ?? null,
        note: slot.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(disponibilites.id, existing[0].id));
    return existing[0].id;
  }

  const inserted = await db
    .insert(disponibilites)
    .values({
      debut,
      fin,
      statut: slot.statut,
      planningType: slot.planningType ?? "charter",
      destination: slot.destination,
      tarifJourPriva: slot.tarifJourPriva ?? null,
      tarifJourPersonne: slot.tarifJourPersonne ?? null,
      tarifCabine: slot.tarifCabine ?? null,
      tarif: slot.tarif ?? null,
      capaciteTotale: slot.capaciteTotale ?? 4,
      cabinesReservees: slot.cabinesReservees ?? 0,
      notePublique: slot.notePublique ?? null,
      note: slot.note ?? null,
    })
    .returning({ id: disponibilites.id });
  return inserted[0].id;
}

async function upsertReservation(seed: ReservationSeed, disponibiliteId: number) {
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible");
  const dateDebut = toDate(seed.start);
  const dateFin = toDate(seed.end);

  const existing = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.nomClient, seed.name), eq(reservations.dateDebut, dateDebut), eq(reservations.dateFin, dateFin)))
    .limit(1);

  const payload = {
    nomClient: seed.name,
    prenomClient: null,
    emailClient: seed.email,
    telClient: null,
    nbPersonnes: seed.people,
    formule: seed.formule,
    typeReservation: seed.type,
    nbCabines: seed.nbCabines,
    destination: seed.destination,
    dateDebut,
    dateFin,
    montantTotal: Math.round(seed.totalEuro * 100),
    typePaiement: "acompte" as const,
    montantPaye: seed.workflow === "acompte_confirme" || seed.workflow === "solde_confirme" ? Math.round(seed.totalEuro * 20) : 0,
    statutPaiement: "en_attente" as const,
    workflowStatut: seed.workflow,
    requestStatus: seed.requestStatus,
    internalComment: seed.internalComment ?? null,
    message: null,
    disponibiliteId,
    updatedAt: new Date(),
  };

  if (existing[0]?.id) {
    await db.update(reservations).set(payload).where(eq(reservations.id, existing[0].id));
    return;
  }

  await db.insert(reservations).values(payload);
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible");

  // Clean potentially stale imported entries in the targeted window before re-seeding.
  await db
    .delete(reservations)
    .where(and(gte(reservations.dateDebut, toDate("2026-04-01")), lte(reservations.dateFin, toDate("2026-08-09"))));

  const slots: Array<{ slot: SlotSeed; reservation?: ReservationSeed }> = [
    {
      slot: {
        start: "2026-04-15",
        end: "2026-04-15",
        destination: "La Ciotat",
        statut: "reserve",
        tarifJourPriva: 1106,
        notePublique: "Sortie journée — Nicolas Bocquet (passé)",
      },
      reservation: {
        name: "Nicolas Bocquet",
        email: "nicolas.bocquet@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "La Ciotat",
        start: "2026-04-15",
        end: "2026-04-15",
        totalEuro: 1106,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "solde_confirme",
        requestStatus: "validee",
        internalComment: "Passé",
      },
    },
    {
      slot: {
        start: "2026-04-25",
        end: "2026-04-25",
        destination: "La Ciotat",
        statut: "reserve",
        tarifJourPriva: 870,
        notePublique: "Caroline Osta (passé)",
      },
      reservation: {
        name: "Caroline Osta",
        email: "caroline.osta@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "La Ciotat",
        start: "2026-04-25",
        end: "2026-04-25",
        totalEuro: 870,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "solde_confirme",
        requestStatus: "validee",
        internalComment: "Passé",
      },
    },
    {
      slot: {
        start: "2026-05-05",
        end: "2026-05-05",
        destination: "La Ciotat",
        statut: "reserve",
        tarifJourPriva: 800,
        notePublique: "Juliana Clicknboat",
      },
      reservation: {
        name: "Juliana Clicknboat",
        email: "juliana.clicknboat@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "La Ciotat",
        start: "2026-05-05",
        end: "2026-05-05",
        totalEuro: 800,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "acompte_confirme",
        requestStatus: "validee",
        internalComment: "Acompte versé",
      },
    },
    {
      slot: {
        start: "2026-05-08",
        end: "2026-05-10",
        destination: "Arrêt technique",
        statut: "ferme",
        planningType: "technical_stop",
        notePublique: "Arrêt technique",
      },
    },
    {
      slot: {
        start: "2026-05-13",
        end: "2026-05-13",
        destination: "La Ciotat",
        statut: "reserve",
        tarifJourPriva: 800,
        notePublique: "Léa Clicknboat",
      },
      reservation: {
        name: "Léa Clicknboat",
        email: "lea.clicknboat@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "La Ciotat",
        start: "2026-05-13",
        end: "2026-05-13",
        totalEuro: 800,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "acompte_confirme",
        requestStatus: "validee",
        internalComment: "Confirmé + acompte versé",
      },
    },
    {
      slot: {
        start: "2026-05-21",
        end: "2026-05-21",
        destination: "La Ciotat",
        statut: "option",
        tarifJourPriva: 900,
        notePublique: "Option Zolpan",
      },
      reservation: {
        name: "Zolpan",
        email: "zolpan@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "La Ciotat",
        start: "2026-05-21",
        end: "2026-05-21",
        totalEuro: 900,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "devis_emis",
        requestStatus: "en_cours",
      },
    },
    {
      slot: {
        start: "2026-05-22",
        end: "2026-05-24",
        destination: "Cannes",
        statut: "option",
        tarifJourPriva: 2500,
        notePublique: "Option Romane (départ Cannes)",
      },
      reservation: {
        name: "Romane",
        email: "romane@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "Cannes",
        start: "2026-05-22",
        end: "2026-05-24",
        totalEuro: 2500,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "devis_emis",
        requestStatus: "en_cours",
        internalComment: "22/05 18:00 -> 24/05 18:00",
      },
    },
    {
      slot: {
        start: "2026-05-28",
        end: "2026-05-28",
        destination: "Hyères",
        statut: "reserve",
        tarifJourPriva: 900,
        notePublique: "Zolpan réservé journée départ Hyères",
      },
      reservation: {
        name: "Zolpan",
        email: "zolpan@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "Hyères",
        start: "2026-05-28",
        end: "2026-05-28",
        totalEuro: 900,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "contrat_signe",
        requestStatus: "validee",
      },
    },
    {
      slot: {
        start: "2026-05-29",
        end: "2026-05-31",
        destination: "La Ciotat",
        statut: "reserve",
        tarifJourPriva: 0,
        notePublique: "Victor Leydet EVG",
      },
      reservation: {
        name: "Victor Leydet EVG",
        email: "victor.evggroup@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "La Ciotat",
        start: "2026-05-29",
        end: "2026-05-31",
        totalEuro: 0,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "contrat_signe",
        requestStatus: "validee",
      },
    },
    {
      slot: {
        start: "2026-06-04",
        end: "2026-06-04",
        destination: "La Ciotat",
        statut: "option",
        tarifJourPriva: 900,
        notePublique: "Option Zolpan",
      },
      reservation: {
        name: "Zolpan",
        email: "zolpan@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "La Ciotat",
        start: "2026-06-04",
        end: "2026-06-04",
        totalEuro: 900,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "devis_emis",
        requestStatus: "en_cours",
      },
    },
    {
      slot: {
        start: "2026-06-06",
        end: "2026-06-13",
        destination: "Méditerranée",
        statut: "reserve",
        tarif: 14000,
        notePublique: "Privatisation Marjorie Bonachera",
      },
      reservation: {
        name: "MARJORIE BONACHERA",
        email: "marjorie.bonachera@sabine-sailing.local",
        people: 8,
        formule: "semaine",
        destination: "Méditerranée",
        start: "2026-06-06",
        end: "2026-06-13",
        totalEuro: 14000,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "contrat_signe",
        requestStatus: "validee",
      },
    },
    {
      slot: {
        start: "2026-06-18",
        end: "2026-06-18",
        destination: "La Ciotat",
        statut: "option",
        tarifJourPriva: 900,
        notePublique: "Option Zolpan",
      },
      reservation: {
        name: "Zolpan",
        email: "zolpan@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "La Ciotat",
        start: "2026-06-18",
        end: "2026-06-18",
        totalEuro: 900,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "devis_emis",
        requestStatus: "en_cours",
      },
    },
    {
      slot: {
        start: "2026-06-23",
        end: "2026-06-24",
        destination: "La Ciotat",
        statut: "option",
        tarifJourPriva: 2000,
        notePublique: "Option Micelli",
      },
      reservation: {
        name: "Micelli",
        email: "micelli@sabine-sailing.local",
        people: 8,
        formule: "journee",
        destination: "La Ciotat",
        start: "2026-06-23",
        end: "2026-06-24",
        totalEuro: 2000,
        type: "bateau_entier",
        nbCabines: 4,
        workflow: "devis_emis",
        requestStatus: "en_cours",
      },
    },
    {
      slot: {
        start: "2026-07-25",
        end: "2026-08-01",
        destination: "Bastia Ajaccio",
        statut: "option",
        tarifCabine: 2000,
        cabinesReservees: 3,
        capaciteTotale: 4,
        notePublique: "DEBOOS 2 cabines + CORTOIS 1 cabine (reste 1)",
      },
      reservation: {
        name: "DEBOOS + CORTOIS",
        email: "cabines.bastia-ajaccio@sabine-sailing.local",
        people: 6,
        formule: "semaine",
        destination: "Bastia Ajaccio",
        start: "2026-07-25",
        end: "2026-08-01",
        totalEuro: 6000,
        type: "cabine",
        nbCabines: 3,
        workflow: "devis_emis",
        requestStatus: "en_cours",
      },
    },
    {
      slot: {
        start: "2026-08-01",
        end: "2026-08-08",
        destination: "Ajaccio via Maddalena",
        statut: "reserve",
        tarifCabine: 2000,
        cabinesReservees: 4,
        capaciteTotale: 4,
        notePublique: "REMI BENHAMOU 2 cabines + MAXIMILIEN CLAYTON 2 cabines",
      },
      reservation: {
        name: "REMI BENHAMOU + MAXIMILIEN CLAYTON",
        email: "cabines.ajaccio@sabine-sailing.local",
        people: 8,
        formule: "semaine",
        destination: "Ajaccio via Maddalena",
        start: "2026-08-01",
        end: "2026-08-08",
        totalEuro: 16000,
        type: "cabine",
        nbCabines: 4,
        workflow: "contrat_signe",
        requestStatus: "validee",
      },
    },
  ];

  for (const entry of slots) {
    const slotId = await upsertSlot(entry.slot);
    if (entry.reservation) {
      await upsertReservation(entry.reservation, slotId);
    }
  }

  await syncDisponibilitesFromReservations(db);
  console.log("[import-client-bookings] Import terminé.");
}

main().catch((error) => {
  console.error("[import-client-bookings] Echec:", error);
  process.exit(1);
});

