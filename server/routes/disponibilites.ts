import { Router } from "express";
import { getDb } from "../db";
import { disponibilites } from "../../drizzle/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAdmin } from "../_core/authz";
import { runBookingConsistencyAudit, syncDisponibilitesFromReservations } from "../_core/bookingRules";

const router = Router();
let lastSyncAt = 0;
let syncPromise: Promise<void> | null = null;

async function syncWithThrottle(db: any) {
  const now = Date.now();
  if (now - lastSyncAt < 30000) return;
  if (syncPromise) {
    await syncPromise;
    return;
  }
  syncPromise = (async () => {
    await syncDisponibilitesFromReservations(db);
    lastSyncAt = Date.now();
  })();
  try {
    await syncPromise;
  } finally {
    syncPromise = null;
  }
}

// GET toutes les disponibilités
router.get("/", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }
    await syncWithThrottle(db);
    const all = await db.select().from(disponibilites).orderBy(disponibilites.debut);
    res.json(all);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la récupération des disponibilités" });
  }
});

// GET disponibilités pour une période donnée
router.get("/range", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }
    await syncWithThrottle(db);
    const { debut, fin } = req.query;
    if (!debut || !fin) {
      return res.status(400).json({ error: "Paramètres debut et fin requis" });
    }
    
    const debutDate = new Date(debut as string);
    const finDate = new Date(fin as string);
    
    const result = await db
      .select()
      .from(disponibilites)
      .where(
        and(
          gte(disponibilites.debut, debutDate),
          lte(disponibilites.fin, finDate)
        )
      )
      .orderBy(disponibilites.debut);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la récupération des disponibilités" });
  }
});

router.get("/audit", requireAdmin, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });
    await syncWithThrottle(db);
    const audit = await runBookingConsistencyAudit(db);
    return res.json(audit);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur audit calendrier" });
  }
});

// POST créer une nouvelle disponibilité
router.post("/", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }
    
    const {
      planningType,
      debut,
      fin,
      statut,
      tarif,
      tarifCabine,
      tarifJourPersonne,
      tarifJourPriva,
      destination,
      note,
      notePublique,
    } = req.body;
    
    if (!debut || !fin || !statut || !destination) {
      return res.status(400).json({ error: "Champs requis manquants" });
    }
    
    const result = await db.insert(disponibilites).values({
      planningType: planningType || "charter",
      debut: new Date(debut),
      fin: new Date(fin),
      statut,
      tarif: tarif ? parseInt(tarif) : null,
      tarifCabine: tarifCabine ? parseInt(tarifCabine) : null,
      tarifJourPersonne: tarifJourPersonne ? parseInt(tarifJourPersonne) : null,
      tarifJourPriva: tarifJourPriva ? parseInt(tarifJourPriva) : null,
      destination,
      note: note || null,
      notePublique: notePublique || null,
    });
    
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la création de la disponibilité" });
  }
});

// PUT mettre à jour une disponibilité
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }
    
    const { id } = req.params;
    const {
      planningType,
      debut,
      fin,
      statut,
      tarif,
      tarifCabine,
      tarifJourPersonne,
      tarifJourPriva,
      destination,
      note,
      notePublique,
    } = req.body;
    
    await db
      .update(disponibilites)
      .set({
        planningType: planningType || undefined,
        debut: debut ? new Date(debut) : undefined,
        fin: fin ? new Date(fin) : undefined,
        statut: statut || undefined,
        tarif: tarif ? parseInt(tarif) : undefined,
        tarifCabine: tarifCabine ? parseInt(tarifCabine) : undefined,
        tarifJourPersonne: tarifJourPersonne ? parseInt(tarifJourPersonne) : undefined,
        tarifJourPriva: tarifJourPriva ? parseInt(tarifJourPriva) : undefined,
        destination: destination || undefined,
        note: note || undefined,
        notePublique: notePublique || undefined,
        updatedAt: new Date(),
      })
      .where(eq(disponibilites.id, parseInt(id)));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la mise à jour de la disponibilité" });
  }
});

// DELETE supprimer une disponibilité
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }
    
    const { id } = req.params;
    
    await db.delete(disponibilites).where(eq(disponibilites.id, parseInt(id)));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la suppression de la disponibilité" });
  }
});

export default router;
