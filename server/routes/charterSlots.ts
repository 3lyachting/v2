import { Router } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../db";
import { charterSlots, reservations } from "../../drizzle/schema";
import { requireAdmin } from "../_core/authz";
import { sdk } from "../_core/sdk";
import { CHARTER_PRODUCTS, isCharterProductCode, type CharterProductCode } from "@shared/charterProduct";

const router = Router();

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function parseYmdUtcStart(iso: string) {
  if (!YMD.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function parseYmdUtcEndOfDay(iso: string) {
  if (!YMD.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

function defaultRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 365);
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

function mapDbError(error: any, fallback: string) {
  const message = String(error?.message || "");
  if (message.includes("relation") && message.includes("does not exist")) {
    return "Table charterSlots absente. Appliquez la migration (pnpm db:push ou drizzle migrer) puis redemarrez.";
  }
  if (message.includes("charterSlots_uniq_range_product_idx") || message.includes("duplicate key")) {
    return "Une periode identique existe deja pour ce produit (memes dates).";
  }
  return error?.message || fallback;
}

function expandYmdRange(startIso: string, endIso: string): string[] {
  if (!YMD.test(startIso) || !YMD.test(endIso) || startIso > endIso) return [];
  const out: string[] = [];
  let cur = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function isAdminRequest(req: import("express").Request) {
  const bypass =
    process.env.NODE_ENV === "development" && process.env.ADMIN_AUTH_BYPASS === "true";
  if (bypass) {
    return true;
  }
  try {
    const user = await sdk.authenticateRequest(req);
    return user.role === "admin";
  } catch {
    return false;
  }
}

// Public + admin: liste (admin peut inclure inactifs)
router.get("/", async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || "") === "1";
    if (includeInactive) {
      const admin = await isAdminRequest(req);
      if (!admin) {
        return res.status(403).json({ error: "Droits insuffisants" });
      }
    }

    const { from, to } = defaultRange();
    const qFrom = typeof req.query.from === "string" ? parseYmdUtcStart(req.query.from) : null;
    const qTo = typeof req.query.to === "string" ? parseYmdUtcEndOfDay(req.query.to) : null;
    if (typeof req.query.from === "string" && !qFrom) {
      return res.status(400).json({ error: "Parametre 'from' invalide (attendu YYYY-MM-DD)." });
    }
    if (typeof req.query.to === "string" && !qTo) {
      return res.status(400).json({ error: "Parametre 'to' invalide (attendu YYYY-MM-DD)." });
    }

    const fromBound = qFrom || from;
    const toBound = qTo || to;
    if (toBound < fromBound) {
      return res.status(400).json({ error: "La plage 'to' doit etre apres 'from'." });
    }

    const productFilter = typeof req.query.product === "string" ? req.query.product : null;
    if (productFilter && !isCharterProductCode(productFilter)) {
      return res.status(400).json({ error: "Produit inconnu" });
    }

    const db = await getDb();
    if (!db) {
      return res.json([]);
    }

    const overlap = and(lte(charterSlots.debut, toBound), gte(charterSlots.fin, fromBound));
    const whereParts = [overlap];
    if (productFilter && isCharterProductCode(productFilter)) {
      whereParts.push(eq(charterSlots.product, productFilter));
    }
    if (!includeInactive) {
      whereParts.push(eq(charterSlots.active, true));
    }
    const where = and(...whereParts);

    const rows = await db.select().from(charterSlots).where(where);
    return res.json(rows);
  } catch (error: any) {
    return res.status(500).json({ error: mapDbError(error, "Erreur chargement periodes") });
  }
});

// Public: jours à bloquer côté calendrier client pour éviter les doubles réservations
router.get("/blocked-days", async (req, res) => {
  try {
    const { from, to } = defaultRange();
    const qFrom = typeof req.query.from === "string" ? parseYmdUtcStart(req.query.from) : null;
    const qTo = typeof req.query.to === "string" ? parseYmdUtcEndOfDay(req.query.to) : null;
    if (typeof req.query.from === "string" && !qFrom) {
      return res.status(400).json({ error: "Parametre 'from' invalide (attendu YYYY-MM-DD)." });
    }
    if (typeof req.query.to === "string" && !qTo) {
      return res.status(400).json({ error: "Parametre 'to' invalide (attendu YYYY-MM-DD)." });
    }
    const productFilter = typeof req.query.product === "string" ? req.query.product : null;
    if (!productFilter || !isCharterProductCode(productFilter)) {
      return res.status(400).json({ error: "Produit requis" });
    }
    const fromBound = qFrom || from;
    const toBound = qTo || to;
    if (toBound < fromBound) {
      return res.status(400).json({ error: "La plage 'to' doit etre apres 'from'." });
    }

    const db = await getDb();
    if (!db) return res.json({ days: [] });

    const slots = await db
      .select({ debut: charterSlots.debut, fin: charterSlots.fin })
      .from(charterSlots)
      .where(
        and(
          eq(charterSlots.product, productFilter),
          eq(charterSlots.active, true),
          lte(charterSlots.debut, toBound),
          gte(charterSlots.fin, fromBound)
        )
      );

    if (!slots.length) return res.json({ days: [] });

    const overlap = and(lte(reservations.dateDebut, toBound), gte(reservations.dateFin, fromBound));
    const rows = await db
      .select({
        dateDebut: reservations.dateDebut,
        dateFin: reservations.dateFin,
        requestStatus: reservations.requestStatus,
        workflowStatut: reservations.workflowStatut,
      })
      .from(reservations)
      .where(overlap);

    const blocked = new Set<string>();
    for (const r of rows) {
      const req = String(r.requestStatus || "");
      const wf = String(r.workflowStatut || "");
      const isBlockingByRequest = req !== "refusee" && req !== "archivee";
      const isBlockingByWorkflow = [
        "validee_owner",
        "devis_accepte",
        "contrat_envoye",
        "contrat_signe",
        "acompte_confirme",
        "solde_confirme",
      ].includes(wf);
      const isBlocking = isBlockingByRequest || isBlockingByWorkflow;
      if (!isBlocking) continue;
      const resStartIso = String(r.dateDebut).slice(0, 10);
      const resEndIso = String(r.dateFin).slice(0, 10);
      if (!YMD.test(resStartIso) || !YMD.test(resEndIso) || resStartIso > resEndIso) continue;
      for (const slot of slots) {
        const slotStartIso = String(slot.debut).slice(0, 10);
        const slotEndIso = String(slot.fin).slice(0, 10);
        if (!YMD.test(slotStartIso) || !YMD.test(slotEndIso) || slotStartIso > slotEndIso) continue;
        const overlapStart = resStartIso > slotStartIso ? resStartIso : slotStartIso;
        const overlapEnd = resEndIso < slotEndIso ? resEndIso : slotEndIso;
        if (overlapStart > overlapEnd) continue;
        for (const day of expandYmdRange(overlapStart, overlapEnd)) blocked.add(day);
      }
    }

    return res.json({ days: Array.from(blocked).sort() });
  } catch (error: any) {
    return res.status(500).json({ error: mapDbError(error, "Erreur chargement jours bloques") });
  }
});

function parseProduct(body: any): CharterProductCode | null {
  const p = body?.product;
  return isCharterProductCode(p) ? p : null;
}

router.post("/", requireAdmin, async (req, res) => {
  try {
    const { debut, fin, note, publicNote, active } = req.body || {};
    const product = parseProduct(req.body);
    if (!product) {
      return res.status(400).json({ error: `Produit requis: ${CHARTER_PRODUCTS.join(" | ")}` });
    }
    if (typeof debut !== "string" || typeof fin !== "string") {
      return res.status(400).json({ error: "debut et fin requis (YYYY-MM-DD)" });
    }
    const d0 = parseYmdUtcStart(debut);
    const d1 = parseYmdUtcEndOfDay(fin);
    if (!d0 || !d1) {
      return res.status(400).json({ error: "Format de date invalide" });
    }
    if (d1 < d0) {
      return res.status(400).json({ error: "La date de fin doit etre apres le debut" });
    }

    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de donnees non disponible" });

    const inserted = await db
      .insert(charterSlots)
      .values({
        product,
        debut: d0,
        fin: d1,
        active: typeof active === "boolean" ? active : true,
        note: typeof note === "string" && note.trim() ? note.trim() : null,
        publicNote: typeof publicNote === "string" && publicNote.trim() ? publicNote.trim() : null,
      })
      .returning();

    return res.json({ success: true, row: inserted[0] });
  } catch (error: any) {
    return res.status(500).json({ error: mapDbError(error, "Erreur creation periode") });
  }
});

router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Id invalide" });
    const { debut, fin, note, publicNote, active } = req.body || {};
    const product = parseProduct(req.body);
    if (!product) {
      return res.status(400).json({ error: `Produit requis: ${CHARTER_PRODUCTS.join(" | ")}` });
    }
    if (typeof debut !== "string" || typeof fin !== "string") {
      return res.status(400).json({ error: "debut et fin requis (YYYY-MM-DD)" });
    }
    const d0 = parseYmdUtcStart(debut);
    const d1 = parseYmdUtcEndOfDay(fin);
    if (!d0 || !d1) {
      return res.status(400).json({ error: "Format de date invalide" });
    }
    if (d1 < d0) {
      return res.status(400).json({ error: "La date de fin doit etre apres le debut" });
    }

    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de donnees non disponible" });

    await db
      .update(charterSlots)
      .set({
        product,
        debut: d0,
        fin: d1,
        active: typeof active === "boolean" ? active : true,
        note: typeof note === "string" ? (note.trim() ? note : null) : undefined,
        publicNote: typeof publicNote === "string" ? (publicNote.trim() ? publicNote : null) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(charterSlots.id, id));

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: mapDbError(error, "Erreur mise a jour periode") });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Id invalide" });
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de donnees non disponible" });
    await db.delete(charterSlots).where(eq(charterSlots.id, id));
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: mapDbError(error, "Erreur suppression periode") });
  }
});

export default router;
