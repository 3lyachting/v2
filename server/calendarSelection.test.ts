import { describe, expect, it } from "vitest";
import { chooseBestDisponibiliteForDay, getProductFromDisponibilite } from "@shared/calendarSelection";

describe("calendarSelection helpers", () => {
  it("prefers non-transat day slot in april", () => {
    const day = "2026-04-18";
    const rows = [
      {
        debut: "2026-04-05T00:00:00.000Z",
        fin: "2026-04-30T00:00:00.000Z",
        statut: "option" as const,
        destination: "Transat aller La Ciotat -> Pointe-à-Pitre",
        planningType: "charter" as const,
      },
      {
        debut: "2026-04-18T00:00:00.000Z",
        fin: "2026-04-18T00:00:00.000Z",
        statut: "disponible" as const,
        destination: "La Ciotat - Cassis (plage de l'Arène) - retour",
        planningType: "charter" as const,
      },
    ];

    const selected = chooseBestDisponibiliteForDay(rows, day);
    expect(selected?.debut).toBe("2026-04-18T00:00:00.000Z");
    expect(getProductFromDisponibilite(selected!)).toBe("journee");
  });

  it("keeps weekly slot over long overlap outside april-may", () => {
    const day = "2026-06-20";
    const rows = [
      {
        debut: "2026-04-05T00:00:00.000Z",
        fin: "2026-12-15T00:00:00.000Z",
        statut: "disponible" as const,
        destination: "Transat aller La Ciotat -> Pointe-à-Pitre",
        planningType: "charter" as const,
      },
      {
        debut: "2026-06-20T00:00:00.000Z",
        fin: "2026-06-27T00:00:00.000Z",
        statut: "disponible" as const,
        destination: "Corse & Sardaigne — départ Ajaccio",
        planningType: "charter" as const,
      },
    ];

    const selected = chooseBestDisponibiliteForDay(rows, day);
    expect(selected?.debut).toBe("2026-06-20T00:00:00.000Z");
    expect(selected?.fin).toBe("2026-06-27T00:00:00.000Z");
  });
});
