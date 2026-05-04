import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { documents } from "../../drizzle/schema";
import { storageGetSignedUrl, storagePut } from "../storage";
import { requireAdmin } from "../_core/authz";

const router = Router();

type AdminDocCategory = "boat" | "crew" | "passenger";

router.get("/boat", requireAdmin, async (_req, res) => {
  return listByCategory("boat", res);
});

router.get("/crew", requireAdmin, async (_req, res) => {
  return listByCategory("crew", res);
});

router.get("/passenger", requireAdmin, async (_req, res) => {
  return listByCategory("passenger", res);
});

async function listByCategory(category: AdminDocCategory, res: Response) {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });
    const rows = await db.select().from(documents).where(eq(documents.category, category));
    return res.json(rows);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || `Erreur listing documents ${category}` });
  }
}

router.post("/boat/upload", requireAdmin, async (req, res) => {
  return uploadCategory(req, res, "boat");
});

router.post("/crew/upload", requireAdmin, async (req, res) => {
  return uploadCategory(req, res, "crew");
});

router.post("/passenger/upload", requireAdmin, async (req, res) => {
  return uploadCategory(req, res, "passenger");
});

async function uploadCategory(req: Request, res: Response, category: AdminDocCategory) {
  try {
    const { docType, originalName, mimeType, base64Data, expiresAt } = req.body as {
      docType?: string;
      originalName?: string;
      mimeType?: string;
      base64Data?: string;
      expiresAt?: string;
    };
    if (!docType || !originalName || !mimeType || !base64Data) {
      return res.status(400).json({ error: "Données manquantes" });
    }
    const buffer = Buffer.from(base64Data, "base64");
    if (!buffer.byteLength) {
      return res.status(400).json({ error: "Fichier vide ou base64 invalide" });
    }
    const uploaded = await storagePut(`${category}/documents/${Date.now()}-${originalName}`, buffer, mimeType);

    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });
    const inserted = await db
      .insert(documents)
      .values({
        category,
        docType,
        originalName,
        mimeType,
        sizeBytes: buffer.byteLength,
        storageKey: uploaded.key,
        isSensitive: true,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        uploadedByType: "admin",
        uploadedById: null,
      })
      .returning({ id: documents.id });
    return res.json({ success: true, id: inserted[0]?.id, url: uploaded.url });
  } catch (error: any) {
    const message = error?.message || `Erreur upload document ${category}`;
    if (String(message).includes("Storage config missing")) {
      return res.status(500).json({
        error:
          "Configuration stockage manquante. Renseignez BUILT_IN_FORGE_API_URL et BUILT_IN_FORGE_API_KEY dans .env, puis redémarrez le serveur.",
      });
    }
    return res.status(500).json({ error: message });
  }
}

router.get("/boat/:id/preview-url", requireAdmin, async (req, res) => {
  return previewByCategory(req, res, "boat");
});

router.get("/crew/:id/preview-url", requireAdmin, async (req, res) => {
  return previewByCategory(req, res, "crew");
});

router.get("/passenger/:id/preview-url", requireAdmin, async (req, res) => {
  return previewByCategory(req, res, "passenger");
});

async function previewByCategory(req: Request, res: Response, category: AdminDocCategory) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "ID invalide" });
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });
    const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    const doc = rows[0];
    if (!doc || doc.category !== category) {
      return res.status(404).json({ error: "Document introuvable" });
    }
    const previewUrl = await storageGetSignedUrl(doc.storageKey);
    return res.json({ success: true, previewUrl });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur ouverture aperçu document" });
  }
}

export default router;
