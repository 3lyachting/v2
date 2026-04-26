import "dotenv/config";
import { getDb } from "../db";
import { syncDisponibilitesFromReservations } from "../_core/bookingRules";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Base de données non disponible.");
  await syncDisponibilitesFromReservations(db);
  console.log("[regenerate-disponibilites] Régénération terminée.");
}

main().catch((error) => {
  console.error("[regenerate-disponibilites] Echec:", error);
  process.exit(1);
});
