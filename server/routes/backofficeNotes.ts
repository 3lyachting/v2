import { Router } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { config } from "../../drizzle/schema";
import { requireAdmin } from "../_core/authz";

const router = Router();
const NOTES_KEY = "backoffice_shared_notes";

router.get("/", requireAdmin, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });
    const [row] = await db.select().from(config).where(eq(config.cle, NOTES_KEY)).limit(1);
    return res.json({ notes: row?.valeur || "" });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur chargement notes" });
  }
});

router.put("/", requireAdmin, async (req, res) => {
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
