import { Router } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { requireAdmin } from "../_core/authz";
import { reservations } from "../../drizzle/schema";

const router = Router();

const MOLLIE_API_BASE = "https://api.mollie.com/v2";

function getMollieApiKey() {
  return (process.env.MOLLIE_API_KEY || "").trim();
}

function appBaseUrl(req: import("express").Request) {
  const host = req.get("host");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  return `${proto}://${host}`;
}

function getReturnUrls(req: import("express").Request) {
  const base = appBaseUrl(req);
  return {
    success: (process.env.MOLLIE_RETURN_URL_SUCCESS || `${base}/reservation/succes`).trim(),
    cancel: (process.env.MOLLIE_RETURN_URL_CANCEL || `${base}/reservation/annule`).trim(),
    webhook: (process.env.MOLLIE_WEBHOOK_URL || `${base}/api/mollie/webhook`).trim(),
  };
}

async function mollieFetch<T>(path: string, init: RequestInit) {
  const key = getMollieApiKey();
  if (!key) throw new Error("MOLLIE_API_KEY manquante");
  const res = await fetch(`${MOLLIE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(json?.detail || json?.title || `Erreur Mollie (${res.status})`);
  }
  return json as T;
}

type MolliePayment = {
  id: string;
  status: string;
  _links?: { checkout?: { href: string } };
  amount?: { value: string; currency: string };
  metadata?: Record<string, string>;
};

router.post("/create-payment-link", requireAdmin, async (req, res) => {
  try {
    const reservationId = Number(req.body?.reservationId);
    if (!Number.isFinite(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: "reservationId invalide" });
    }
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
    if (!r) return res.status(404).json({ error: "Réservation introuvable" });

    const amountCents =
      Number.isFinite(Number(req.body?.amountCents)) && Number(req.body?.amountCents) > 0
        ? Math.round(Number(req.body?.amountCents))
        : Math.max(100, Number(r.acompteMontant || 0) || Number(r.montantTotal || 0));
    const amountValue = (amountCents / 100).toFixed(2);

    const urls = getReturnUrls(req);
    const payment = await mollieFetch<MolliePayment>("/payments", {
      method: "POST",
      body: JSON.stringify({
        amount: { currency: "EUR", value: amountValue },
        description: `Sabine Sailing réservation #${reservationId}`,
        redirectUrl: `${urls.success}?reservation_id=${reservationId}`,
        webhookUrl: urls.webhook,
        metadata: {
          reservationId: String(reservationId),
          cancelUrl: urls.cancel,
        },
      }),
    });

    await db
      .update(reservations)
      .set({
        stripeSessionId: `mollie:${payment.id}`,
        internalComment: `Lien Mollie créé (${payment.id})`,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    return res.json({
      success: true,
      provider: "mollie",
      paymentId: payment.id,
      checkoutUrl: payment._links?.checkout?.href || null,
      amountValue,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur création lien Mollie" });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const paymentId = String(req.body?.id || req.query?.id || "").trim();
    if (!paymentId) return res.status(200).send("ok");
    const payment = await mollieFetch<MolliePayment>(`/payments/${encodeURIComponent(paymentId)}`, {
      method: "GET",
    });
    const reservationId = Number(payment?.metadata?.reservationId || "");
    if (!Number.isFinite(reservationId) || reservationId <= 0) return res.status(200).send("ok");

    const db = await getDb();
    if (!db) return res.status(200).send("ok");
    const [existing] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
    if (!existing) return res.status(200).send("ok");

    const paid = payment.status === "paid";
    const canceled = payment.status === "canceled" || payment.status === "expired" || payment.status === "failed";
    const amountPaidCents = Math.round(Number(payment.amount?.value || "0") * 100) || Number(existing.montantPaye || 0);

    await db
      .update(reservations)
      .set({
        statutPaiement: paid ? "paye" : canceled ? "echec" : existing.statutPaiement,
        montantPaye: paid ? amountPaidCents : existing.montantPaye,
        stripePaymentIntentId: `mollie:${payment.id}`,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    return res.status(200).send("ok");
  } catch {
    return res.status(200).send("ok");
  }
});

export default router;

