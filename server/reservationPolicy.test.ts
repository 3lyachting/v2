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

  it("allows flexible stays in may and june", () => {
    const result = validateReservationPolicy({
      dateDebut: "2026-05-12T00:00:00.000Z",
      dateFin: "2026-05-14T00:00:00.000Z",
      destination: "La Ciotat",
    });
    expect(result).toEqual({ ok: true, policy: "may_june_flexible" });
  });

  it("allows outbound transat exception", () => {
    const result = validateReservationPolicy({
      dateDebut: "2026-10-03T00:00:00.000Z",
      dateFin: "2026-10-20T00:00:00.000Z",
      destination: "La Ciotat -> Pointe-à-Pitre via Canaries + Cap-Vert",
    });
    expect(result).toEqual({ ok: true, policy: "transat_outbound" });
  });

  it("blocks current-year return transat but allows previous years", () => {
    const blocked = validateReservationPolicy({
      dateDebut: "2026-04-10T00:00:00.000Z",
      dateFin: "2026-04-20T00:00:00.000Z",
      destination: "Transat retour Pointe-à-Pitre -> La Ciotat",
      now: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(blocked.ok).toBe(false);

    const allowed = validateReservationPolicy({
      dateDebut: "2025-04-10T00:00:00.000Z",
      dateFin: "2025-04-20T00:00:00.000Z",
      destination: "Transat retour Pointe-à-Pitre -> La Ciotat",
      now: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(allowed).toEqual({ ok: true, policy: "transat_return" });
  });
});
