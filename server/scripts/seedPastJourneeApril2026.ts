import "dotenv/config";
import { charterSlots } from "../../drizzle/schema";
import { getDb } from "../db";

function parseYmdUtcStart(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function parseYmdUtcEndOfDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

const DAYS = ["2026-04-15", "2026-04-25"] as const;
const PUBLIC_NOTE = "Journee La Ciotat - archive stats";
const NOTE = "Periode passee ajoutee pour statistiques";

void (async () => {
  const db = await getDb();
  if (!db) {
    console.error("DATABASE_URL manquante ou base indisponible.");
    process.exit(1);
  }

  for (const day of DAYS) {
    const debut = parseYmdUtcStart(day);
    const fin = parseYmdUtcEndOfDay(day);
    try {
      await db.insert(charterSlots).values({
        product: "journee",
        debut,
        fin,
        active: true,
        publicNote: PUBLIC_NOTE,
        note: NOTE,
      });
      console.log(`+ Journee La Ciotat creee: ${day}`);
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string };
      if (
        String(err?.message || "").includes("charterSlots_uniq_range_product_idx") ||
        String(err?.message || "").includes("duplicate key") ||
        err?.code === "23505"
      ) {
        console.log(`= Deja present: ${day}`);
      } else {
        throw e;
      }
    }
  }

  console.log("OK - Periodes passees Journee La Ciotat traitees.");
  process.exit(0);
})();
