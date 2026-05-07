import { Router } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { config } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";

const router = Router();
const NOTES_KEY = "backoffice_shared_notes";

async function requireBackofficeNotesAccess(req: any, res: any, next: any) {
  try {
    const user = await sdk.authenticateRequest(req);
    const role = String((user as any).role || "");
    if (role === "admin" || role === "viewer") return next();
    return res.status(403).json({ error: "Accès backoffice requis" });
  } catch {
    return res.status(401).json({ error: "Authentification requise" });
  }
}

router.get("/", requireBackofficeNotesAccess, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });
    const [row] = await db.select().from(config).where(eq(config.cle, NOTES_KEY)).limit(1);
    return res.json({ notes: row?.valeur || "" });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur chargement notes" });
  }
});

router.put("/", requireBackofficeNotesAccess, async (req, res) => {
  try {
    const raw = req.body?.notes;
    const notes = typeof raw === "string" ? raw : "";
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });
    const [existing] = await db.select().from(config).where(eq(config.cle, NOTES_KEY)).limit(1);
    if (existing) {
      await db.update(config).set({ valeur: notes }).where(eq(config.cle, NOTES_KEY));
    } else {
      await db.insert(config).values({
        cle: NOTES_KEY,
        valeur: notes,
        description: "Bloc-notes partagé du backoffice",
      });
    }
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur sauvegarde notes" });
  }
});

export default router;
