export const BOOKING_ORIGINS = [
  "direct",
  "clicknboat",
  "skippair",
  "samboat",
  "boataround",
  "baptiste",
  "intersail",
  "globesailor",
] as const;

export type BookingOrigin = (typeof BOOKING_ORIGINS)[number];

export const BOOKING_ORIGIN_OPTIONS: Array<{ value: BookingOrigin; label: string }> = [
  { value: "direct", label: "Direct" },
  { value: "clicknboat", label: "Click&Boat" },
  { value: "skippair", label: "Skippair" },
  { value: "samboat", label: "SamBoat" },
  { value: "boataround", label: "BoatAround" },
  { value: "baptiste", label: "Baptiste" },
  { value: "intersail", label: "Intersail" },
  { value: "globesailor", label: "GlobeSailor" },
];

export function bookingOriginLabel(value: string | null | undefined): string {
  return BOOKING_ORIGIN_OPTIONS.find((option) => option.value === value)?.label || "Direct";
}

export function normalizeBookingOrigin(value: unknown): BookingOrigin {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[\s-]+/g, "");
  if (normalized === "clickboat" || normalized === "clickandboat") return "clicknboat";
  if (normalized === "boataround") return "boataround";
  if (normalized === "globesailor") return "globesailor";
  if ((BOOKING_ORIGINS as readonly string[]).includes(normalized)) return normalized as BookingOrigin;
  return "direct";
}

export function inferBookingOriginFromRequest(payload: {
  bookingOrigin?: unknown;
  emailClient?: unknown;
  message?: unknown;
}): BookingOrigin {
  const explicit = normalizeBookingOrigin(payload.bookingOrigin);
  if (explicit !== "direct") return explicit;
  const haystack = `${String(payload.emailClient || "")} ${String(payload.message || "")}`.toLowerCase();
  if (haystack.includes("clicknboat") || haystack.includes("click&boat") || haystack.includes("click and boat")) {
    return "clicknboat";
  }
  if (haystack.includes("skippair")) return "skippair";
  if (haystack.includes("samboat")) return "samboat";
  if (haystack.includes("boataround") || haystack.includes("boat around")) return "boataround";
  if (haystack.includes("intersail")) return "intersail";
  if (haystack.includes("globesailor") || haystack.includes("globe sailor")) return "globesailor";
  if (haystack.includes("baptiste")) return "baptiste";
  return "direct";
}
