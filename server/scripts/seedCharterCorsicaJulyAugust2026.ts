import "dotenv/config";
import { getDb } from "../db";
import { charterSlots } from "../../drizzle/schema";

/**
 * Créneaux juillet-août 2026 — Méditerranée (Corse), texte public pour le site.
 * Semaine type: embarquement samedi 16h, débarquement samedi 9h (7 nuits samedi → samedi).
 * Chaque plage (debut/fin) couvre le séjour côté jours de calendrier (sans chevauchement)
 * d’un samedi 00:00 au vendredi 23:59, soit la période entre les deux samedi.
 *
 *   pnpm exec tsx server/scripts/seedCharterCorsicaJulyAugust2026.ts
 * (avoir DATABASE_URL pointant sur la base prod ou locale)
 */
const PUBLIC_NOTE =
  "Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d'Ajaccio.";
const NOTE_INTERNAL = "Corsica 2026 (seed) · embarquem. sam. 16h00 / débarquem. sam. 09h00";

function parseYmdUtcStart(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function parseYmdUtcEndOfDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

/** 9 semaines, chaque samedi au samedi suivant (7 nuits) : début samedi calendaire, fin le vendredi suivant inclus. */
const WEEKS_2026: { debut: string; fin: string }[] = [
  { debut: "2026-07-04", fin: "2026-07-10" },
  { debut: "2026-07-11", fin: "2026-07-17" },
  { debut: "2026-07-18", fin: "2026-07-24" },
  { debut: "2026-07-25", fin: "2026-07-31" },
  { debut: "2026-08-01", fin: "2026-08-07" },
  { debut: "2026-08-08", fin: "2026-08-14" },
  { debut: "2026-08-15", fin: "2026-08-21" },
  { debut: "2026-08-22", fin: "2026-08-28" },
  { debut: "2026-08-29", fin: "2026-09-04" },
];

void (async () => {
  const db = await getDb();
  if (!db) {
    console.error("DATABASE_URL manquante ou base indisponible.");
    process.exit(1);
  }
  for (const w of WEEKS_2026) {
    const debut = parseYmdUtcStart(w.debut);
    const fin = parseYmdUtcEndOfDay(w.fin);
    try {
      await db.insert(charterSlots).values({
        product: "med",
        debut,
        fin,
        active: true,
        publicNote: PUBLIC_NOTE,
        note: NOTE_INTERNAL,
      });
      console.log(`+ ${w.debut} -> ${w.fin}`);
    } catch (e: unknown) {
      const any = e as { message?: string; code?: string };
      if (
        String(any?.message || "").includes("charterSlots_uniq") ||
        String(any?.message || "").includes("duplicate key") ||
        any?.code === "23505"
      ) {
        console.log(`= (déjà présent) ${w.debut} -> ${w.fin}`);
      } else {
        throw e;
      }
    }
  }
  console.log("OK — 9 créneaux visés (juil.-août/transition).");
  process.exit(0);
})();
