import { describe, expect, it } from "vitest";
import { inferSlotType } from "@shared/slotRules";
import { chooseBestDisponibiliteForDay } from "@shared/calendarSelection";

describe("slot rules deterministic selection", () => {
  it("classifies transat windows only", () => {
    expect(
      inferSlotType({
        debut: "2026-11-10T00:00:00.000Z",
        fin: "2026-11-25T00:00:00.000Z",
        destination: "Transat aller La Ciotat -> Pointe-à-Pitre",
      })
    ).toBe("transat_outbound");
    expect(
      inferSlotType({
        debut: "2026-07-12T00:00:00.000Z",
        fin: "2026-07-19T00:00:00.000Z",
        destination: "Transat aller La Ciotat -> Pointe-à-Pitre",
      })
    ).toBe("week_charter");
  });

  it("keeps august weekly slot over wrong transat overlap", () => {
    const rows = [
      {
        debut: "2026-08-08T00:00:00.000Z",
        fin: "2026-08-15T00:00:00.000Z",
        destination: "Corse & Sardaigne — départ Ajaccio",
        statut: "disponible" as const,
      },
      {
        debut: "2026-04-05T00:00:00.000Z",
        fin: "2026-12-05T00:00:00.000Z",
        destination: "Transat aller La Ciotat -> Pointe-à-Pitre",
        statut: "disponible" as const,
      },
    ];
    const selected = chooseBestDisponibiliteForDay(rows, "2026-08-10");
    expect(selected?.destination).toContain("Corse");
  });
});
