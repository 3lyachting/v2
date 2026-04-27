import "dotenv/config";
import { getDb } from "../db";
import {
  cabinesReservees,
  contracts,
  disponibilites,
  documents,
  esignEvents,
  invoices,
  paymentConfirmations,
  quotes,
  reservationStatusHistory,
  reservations,
} from "../../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) {
    throw new Error("Base de données non disponible (DATABASE_URL manquant ou invalide).");
  }

  await db.transaction(async (tx) => {
    await tx.delete(esignEvents);
    await tx.delete(paymentConfirmations);
    await tx.delete(invoices);
    await tx.delete(contracts);
    await tx.delete(quotes);
    await tx.delete(documents);
    await tx.delete(reservationStatusHistory);
    await tx.delete(reservations);
    await tx.delete(cabinesReservees);
    await tx.delete(disponibilites);
  });

  console.log("[reset-booking-data] Reset terminé.");
}

main().catch((error) => {
  console.error("[reset-booking-data] Echec:", error);
  process.exit(1);
});
