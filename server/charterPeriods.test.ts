import { describe, expect, it } from "vitest";
import { findCharterPeriodForRange } from "../shared/charterPeriods";

describe("findCharterPeriodForRange", () => {
  const periods = [
    { id: 1, startIso: "2026-11-05", endIso: "2026-12-05", publicNote: "Depart La Ciotat" },
    { id: 2, startIso: "2026-07-10", endIso: "2026-07-17", publicNote: "Semaine Corse" },
  ];

  it("matches exact range", () => {
    expect(findCharterPeriodForRange(periods, "2026-07-10", "2026-07-17")?.id).toBe(2);
  });

  it("matches transat period when a day inside the window is selected", () => {
    expect(findCharterPeriodForRange(periods, "2026-11-20", "2026-11-20")?.publicNote).toBe("Depart La Ciotat");
  });
});
