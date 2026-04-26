export type SlotType =
  | "day_private"
  | "week_charter"
  | "transat_outbound"
  | "transat_return"
  | "caribbean_week"
  | "other";

type SlotLike = {
  debut: string | Date;
  fin: string | Date;
  destination?: string | null;
  note?: string | null;
};

export const SLOT_NOTE_PREFIX = "[AUTO_SEASON_SLOT]";

function toIsoDay(value: string | Date | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseSlotTypeFromNote(note?: string | null): SlotType | null {
  const raw = String(note || "");
  if (!raw.startsWith(`${SLOT_NOTE_PREFIX}:`)) return null;
  const parsed = raw.slice(`${SLOT_NOTE_PREFIX}:`.length) as SlotType;
  if (["day_private", "week_charter", "transat_outbound", "transat_return", "caribbean_week", "other"].includes(parsed)) {
    return parsed;
  }
  return null;
}

function isInsideWindow(startIso: string, endIso: string, windowStart: string, windowEnd: string) {
  return startIso >= windowStart && endIso <= windowEnd;
}

export function inferSlotType(slot: SlotLike): SlotType {
  const fromNote = parseSlotTypeFromNote(slot.note);
  if (fromNote) return fromNote;
  const startIso = toIsoDay(slot.debut);
  const endIso = toIsoDay(slot.fin);
  if (!startIso || !endIso) return "other";
  const year = Number(startIso.slice(0, 4));
  const destination = String(slot.destination || "").toLowerCase();

  if (isInsideWindow(startIso, endIso, `${year}-11-05`, `${year}-12-05`)) return "transat_outbound";
  if (isInsideWindow(startIso, endIso, `${year}-04-05`, `${year}-05-15`)) return destination.includes("transat") ? "transat_return" : "day_private";
  if (isInsideWindow(startIso, endIso, `${year}-04-01`, `${year}-05-31`) && startIso === endIso) return "day_private";
  if (isInsideWindow(startIso, endIso, `${year}-06-01`, `${year}-08-31`)) return "week_charter";
  if (destination.includes("cara")) return "caribbean_week";
  return "other";
}

export function isTransatType(type: SlotType) {
  return type === "transat_outbound" || type === "transat_return";
}

export function slotTypePriority(type: SlotType, month: number) {
  if (month >= 6 && month <= 8) {
    if (type === "week_charter") return 0;
    if (type === "day_private") return 2;
    if (isTransatType(type)) return 3;
    return 4;
  }
  if (month === 4 || month === 5) {
    if (isTransatType(type)) return 0;
    if (type === "day_private") return 1;
    return 3;
  }
  if (type === "other") return 5;
  return 2;
}
