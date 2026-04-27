import type { BookingMode, BookingRangeSelection, BookingRequest, BookingStatus, BookingWeek } from "./bookingTypes";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const euroFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export const STATUS_LABELS_FR: Record<BookingStatus, string> = {
  available: "Disponible",
  option: "Option",
  partial: "Cabines restantes",
  reserved: "Complet",
  private: "Privatisé",
  blocked: "Bloqué",
};

export function formatDateRangeFr(startDate: string, endDate: string): string {
  return `${dateFormatter.format(new Date(startDate))} → ${dateFormatter.format(new Date(endDate))}`;
}

export function formatEuro(value: number): string {
  return euroFormatter.format(value);
}

export function isSaturday(dateIso: string): boolean {
  return new Date(`${dateIso}T00:00:00.000Z`).getUTCDay() === 6;
}

export function isSaturdayToSaturday(week: BookingWeek): boolean {
  return isSaturday(week.startDate) && isSaturday(week.endDate);
}

function monthFromIso(dateIso: string): number {
  return Number(dateIso.slice(5, 7));
}

function isHighSeasonMonth(month: number): boolean {
  return month === 2 || month === 7 || month === 8 || month === 12;
}

function requiresSaturdayToSaturday(week: BookingWeek): boolean {
  const start = new Date(`${week.startDate}T00:00:00.000Z`);
  const end = new Date(`${week.endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const from = start <= end ? start : end;
  const to = end >= start ? end : start;
  const cursor = new Date(from);
  while (cursor <= to) {
    if (isHighSeasonMonth(monthFromIso(cursor.toISOString().slice(0, 10)))) {
      return true;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return false;
}

export function getAvailability(week: BookingWeek) {
  const cabinsRemaining = Math.max(week.totalCabins - week.bookedCabins, 0);
  const peopleRemaining = Math.max(week.totalPeople - week.bookedPeople, 0);
  const privateAllowed = week.bookedCabins === 0 && cabinsRemaining === week.totalCabins && week.status !== "blocked";
  return { cabinsRemaining, peopleRemaining, privateAllowed };
}

export function canBookWeek(week: BookingWeek): boolean {
  return week.status === "available" || week.status === "option" || week.status === "partial";
}

export function validateBookingRules(week: BookingWeek, mode: BookingMode, peopleCount: number): string | null {
  const { cabinsRemaining, peopleRemaining, privateAllowed } = getAvailability(week);

  if (requiresSaturdayToSaturday(week) && !isSaturdayToSaturday(week)) {
    return "Cette période doit respecter les règles de réservation en haute saison.";
  }
  if (!canBookWeek(week)) return "Cette semaine n'accepte plus de réservation.";

  if (mode === "private") {
    if (!privateAllowed) return "La privatisation est indisponible: des cabines sont déjà réservées.";
    return null;
  }

  if (!Number.isInteger(peopleCount) || peopleCount < 1) {
    return "Le nombre de passagers doit être au moins de 1.";
  }
  if (peopleCount > peopleRemaining) return "Nombre de passagers supérieur aux places restantes.";
  if (peopleCount > cabinsRemaining * 2) return "Nombre de passagers supérieur au nombre de cabines doubles disponibles.";
  return null;
}

export function calculateEstimatedTotal(week: BookingWeek, mode: BookingMode, peopleCount: number): number {
  return mode === "private" ? week.pricePrivate : week.pricePerPerson * peopleCount;
}

export function calculateEstimatedRangeTotal(selection: BookingRangeSelection, mode: BookingMode, peopleCount: number): number {
  // Avoid billing the same availability slot once per day when a range spans
  // multiple days of the exact same slot (ex: one week selected on calendar).
  const uniqueSlots = Array.from(
    new Map(
      selection.days.map((day) => [
        `${day.disponibiliteId ?? day.id}-${day.startDate}-${day.endDate}`,
        day,
      ]),
    ).values(),
  );
  const slotSum = uniqueSlots.reduce((acc, slot) => acc + (mode === "private" ? slot.pricePrivate : slot.pricePerPerson * peopleCount), 0);
  return Math.max(0, Math.round(slotSum));
}

export function applyAcceptedRequest(week: BookingWeek, request: BookingRequest): BookingWeek {
  if (request.mode === "private") {
    return {
      ...week,
      status: "private",
      bookedCabins: week.totalCabins,
      bookedPeople: week.totalPeople,
      clientName: request.fullName,
      internalNote: `Privatisation acceptée (${request.peopleCount} passager(s)).`,
    };
  }

  const bookedPeople = Math.min(week.bookedPeople + request.peopleCount, week.totalPeople);
  const cabinUnits = Math.ceil(request.peopleCount / 2);
  const bookedCabins = Math.min(week.bookedCabins + cabinUnits, week.totalCabins);
  const isFull = bookedPeople >= week.totalPeople || bookedCabins >= week.totalCabins;

  return {
    ...week,
    bookedPeople,
    bookedCabins,
    status: isFull ? "reserved" : "partial",
    clientName: request.fullName,
  };
}
