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
  return new Date(dateIso).getUTCDay() === 6;
}

export function isSaturdayToSaturday(week: BookingWeek): boolean {
  return isSaturday(week.startDate) && isSaturday(week.endDate);
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

  if (!isSaturdayToSaturday(week)) return "Cette semaine n'est pas configurée en format samedi-samedi.";
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
  const dailySum = selection.days.reduce((acc, day) => acc + (mode === "private" ? day.pricePrivate : day.pricePerPerson * peopleCount), 0);
  return Math.max(0, Math.round(dailySum));
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
