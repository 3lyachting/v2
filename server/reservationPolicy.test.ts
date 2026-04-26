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
      dateFin: "2026-04-14T00:00:00.000Z",
      destination: "La Ciotat",
    });
    expect(result).toEqual({ ok: true, policy: "april_may_flexible" });
  });

  it("keeps june in saturday-weekly mode", () => {
    const result = validateReservationPolicy({
      dateDebut: "2026-05-12T00:00:00.000Z",
      dateFin: "2026-05-14T00:00:00.000Z",
      destination: "Corse",
    });
    expect(result).toEqual({ ok: true, policy: "april_may_flexible" });

    const juneRejected = validateReservationPolicy({
      dateDebut: "2026-06-10T00:00:00.000Z",
      dateFin: "2026-06-17T00:00:00.000Z",
      destination: "Corse",
    });
    expect(juneRejected.ok).toBe(false);
    const juneWeekly = validateReservationPolicy({
      dateDebut: "2026-06-13T00:00:00.000Z",
      dateFin: "2026-06-20T00:00:00.000Z",
      destination: "Corse",
    });
    expect(juneWeekly).toEqual({ ok: true, policy: "weekly_saturday" });
  });
});
