import { eq, sql } from "drizzle-orm";
import { reservations } from "../../drizzle/schema";

function isMissingBookingOriginColumnError(error: unknown) {
  const message = String((error as any)?.message || "").toLowerCase();
  return message.includes("bookingorigin") || message.includes("booking_origin");
}

export async function listReservationsSafe(db: any) {
  try {
    return await db.select().from(reservations).orderBy(reservations.createdAt);
  } catch (error) {
    if (!isMissingBookingOriginColumnError(error)) throw error;
    const result = await db.execute(sql`select * from reservations order by "createdAt"`);
    return ((result as any)?.rows || []) as any[];
  }
}

export async function listReservationsByDisponibiliteSafe(db: any, disponibiliteId: number) {
  try {
    return await db.select().from(reservations).where(eq(reservations.disponibiliteId, disponibiliteId));
  } catch (error) {
    if (!isMissingBookingOriginColumnError(error)) throw error;
    const result = await db.execute(sql`select * from reservations where "disponibiliteId" = ${disponibiliteId}`);
    return ((result as any)?.rows || []) as any[];
  }
}

export async function listReservationsByIdSafe(db: any, reservationId: number) {
  try {
    return await db.select().from(reservations).where(eq(reservations.id, reservationId));
  } catch (error) {
    if (!isMissingBookingOriginColumnError(error)) throw error;
    const result = await db.execute(sql`select * from reservations where id = ${reservationId}`);
    return ((result as any)?.rows || []) as any[];
  }
}

export async function listReservationsByEmailSafe(db: any, email: string) {
  try {
    return await db.select().from(reservations).where(eq(reservations.emailClient, email));
  } catch (error) {
    if (!isMissingBookingOriginColumnError(error)) throw error;
    const result = await db.execute(sql`select * from reservations where "emailClient" = ${email}`);
    return ((result as any)?.rows || []) as any[];
  }
}
