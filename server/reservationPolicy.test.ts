import { describe, expect, it } from "vitest";
import { validateReservationPolicy } from "@shared/reservationPolicy";

describe("reservation policy", () => {
  it("enforces saturday-to-saturday outside exceptions", () => {
    const accepted = validateReservationPolicy({
      dateDebut: "2026-07-04T00:00:00.000Z",
      dateFin: "2026-07-11T00:00:00.000Z",
      destination: "Corse",
    });
    expect(accepted.ok).toBe(true);

    const rejected = validateReservationPolicy({
      dateDebut: "2026-07-06T00:00:00.000Z",
      dateFin: "2026-07-11T00:00:00.000Z",
      destination: "Corse",
    });
    expect(rejected.ok).toBe(false);
  });

  it("allows flexible stays in april and may", () => {
    const result = validateReservationPolicy({
      dateDebut: "2026-04-12T00:00:00.000Z",
      dateFin: "2026-04-12T00:00:00.000Z",
      destination: "La Ciotat",
      typeReservation: "bateau_entier",
    });
    expect(result).toEqual({ ok: true, policy: "april_may_private_daytrip" });
  });

  it("rejects april cabin mode and wrong destination", () => {
    const cabinRejected = validateReservationPolicy({
      dateDebut: "2026-05-12T00:00:00.000Z",
      dateFin: "2026-05-12T00:00:00.000Z",
      destination: "La Ciotat",
      typeReservation: "cabine",
      nbCabines: 1,
    });
    expect(cabinRejected.ok).toBe(false);
    const destinationRejected = validateReservationPolicy({
      dateDebut: "2026-04-16T00:00:00.000Z",
      dateFin: "2026-04-16T00:00:00.000Z",
      destination: "Ajaccio",
      typeReservation: "bateau_entier",
    });
    expect(destinationRejected.ok).toBe(false);
  });

  it("keeps june in saturday-weekly mode", () => {
    const juneRejected = validateReservationPolicy({
      dateDebut: "2026-06-10T00:00:00.000Z",
      dateFin: "2026-06-17T00:00:00.000Z",
      destination: "Corse",
      typeReservation: "cabine",
      nbCabines: 2,
    });
    expect(juneRejected.ok).toBe(false);
    const juneWeekly = validateReservationPolicy({
      dateDebut: "2026-06-13T00:00:00.000Z",
      dateFin: "2026-06-20T00:00:00.000Z",
      destination: "Corse",
      typeReservation: "cabine",
      nbCabines: 2,
    });
    expect(juneWeekly).toEqual({ ok: true, policy: "summer_weekly_private_or_cabine" });
  });

  it("enforces saturday-to-saturday in december and february", () => {
    const decemberRejected = validateReservationPolicy({
      dateDebut: "2026-12-10T00:00:00.000Z",
      dateFin: "2026-12-17T00:00:00.000Z",
      destination: "Antilles",
      typeReservation: "cabine",
      nbCabines: 2,
    });
    expect(decemberRejected.ok).toBe(false);

    const februaryRejected = validateReservationPolicy({
      dateDebut: "2026-02-07T00:00:00.000Z",
      dateFin: "2026-02-10T00:00:00.000Z",
      destination: "Antilles",
      typeReservation: "cabine",
      nbCabines: 2,
    });
    expect(februaryRejected.ok).toBe(false);

    const februaryAccepted = validateReservationPolicy({
      dateDebut: "2026-02-07T00:00:00.000Z",
      dateFin: "2026-02-14T00:00:00.000Z",
      destination: "Antilles",
      typeReservation: "cabine",
      nbCabines: 2,
    });
    expect(februaryAccepted.ok).toBe(true);
  });

  it("accepts only transat windows", () => {
    const transatWindow = validateReservationPolicy({
      dateDebut: "2026-11-10T00:00:00.000Z",
      dateFin: "2026-11-17T00:00:00.000Z",
      destination: "Transat aller La Ciotat -> Pointe-à-Pitre",
      typeReservation: "bateau_entier",
    });
    expect(transatWindow).toEqual({ ok: true, policy: "transat_window" });
    const julyTransat = validateReservationPolicy({
      dateDebut: "2026-07-11T00:00:00.000Z",
      dateFin: "2026-07-18T00:00:00.000Z",
      destination: "Transat aller La Ciotat -> Pointe-à-Pitre",
      typeReservation: "cabine",
      nbCabines: 2,
    });
    expect(julyTransat.ok).toBe(false);
  });

  it("allows transat formula even without transat in destination label", () => {
    const transatByFormule = validateReservationPolicy({
      dateDebut: "2026-11-10T00:00:00.000Z",
      dateFin: "2026-11-17T00:00:00.000Z",
      destination: "Méditerranée",
      formule: "transatlantique",
      typeReservation: "place",
    });
    expect(transatByFormule).toEqual({ ok: true, policy: "transat_window" });
  });
});
