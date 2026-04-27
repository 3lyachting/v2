export type BookingStatus = "available" | "option" | "partial" | "reserved" | "private" | "blocked";

export type BookingMode = "private" | "cabin";

export type BookingRequestStatus = "pending" | "accepted" | "rejected";

export interface BookingWeek {
  id: string;
  disponibiliteId?: number;
  startDate: string;
  endDate: string;
  status: BookingStatus;
  pricePrivate: number;
  pricePerPerson: number;
  totalCabins: number;
  totalPeople: number;
  bookedCabins: number;
  bookedPeople: number;
  clientName?: string;
  internalNote?: string;
}

export interface BookingRequest {
  id: string;
  weekId: string;
  disponibiliteId?: number;
  mode: BookingMode;
  peopleCount: number;
  fullName: string;
  email: string;
  phone: string;
  message: string;
  estimatedTotal: number;
  createdAt: string;
  status: BookingRequestStatus;
}
