import { describe, expect, it } from "vitest";
import { isSaturdayToSaturdayRequired, validateSaturdayToSaturdayOrThrow } from "./_core/bookingRules";

describe("Booking calendar rules", () => {
  it("requires saturday->saturday for standard weekly bookings", () => {
    expect(
      validateSaturdayToSaturdayOrThrow({
        dateDebut: "2026-01-05",
        dateFin: "2026-01-12",
        formule: "semaine",
      })
    ).toBeTruthy();
  });

  it("accepts saturday->saturday outside May/June", () => {
    expect(
      validateSaturdayToSaturdayOrThrow({
        dateDebut: "2026-01-03",
        dateFin: "2026-01-10",
        formule: "semaine",
      })
    ).toBeNull();
  });

  it("does not require saturday->saturday in May/June", () => {
    expect(
      validateSaturdayToSaturdayOrThrow({
        dateDebut: "2026-05-07",
        dateFin: "2026-05-14",
        formule: "semaine",
      })
    ).toBeNull();
    expect(
      isSaturdayToSaturdayRequired({
        dateDebut: "2026-06-03",
        dateFin: "2026-06-10",
        formule: "semaine",
      })
    ).toBe(false);
  });

  it("does not require saturday->saturday for dedicated transat aller", () => {
    expect(
      validateSaturdayToSaturdayOrThrow({
        dateDebut: "2026-04-08",
        dateFin: "2026-04-15",
        formule: "semaine",
      })
    ).toBeNull();
  });

  it("does not require saturday->saturday for dedicated transat retour except current year", () => {
    expect(
      isSaturdayToSaturdayRequired({
        dateDebut: "2025-04-08",
        dateFin: "2025-04-15",
        formule: "semaine",
      })
    ).toBe(false);
  });
});
