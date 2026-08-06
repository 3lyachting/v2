import { Router } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { requireAdmin } from "../_core/authz";
import { reservations } from "../../drizzle/schema";
import { sendPaymentConfirmationEmail } from "../_core/paymentConfirmationEmail";

const router = Router();

const MOLLIE_API_BASE = "https://api.mollie.com/v2";
const PAYMENT_LINK_PREFIX = "mollie-pl:";
const LEGACY_PAYMENT_PREFIX = "mollie:";
/** Liens email : 14 jours (les /payments classiques n'expirent qu'après ~15 min). */
const PAYMENT_LINK_TTL_DAYS = 14;

function getMollieApiKey() {
  return (process.env.MOLLIE_API_KEY || "").trim();
}

function appBaseUrl(req: import("express").Request) {
  const fromEnv = String(process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
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

async function mollieFetch<T>(path: string, init: RequestInit = { method: "GET" }) {
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
  description?: string;
  _links?: { checkout?: { href: string } };
  amount?: { value: string; currency: string };
  metadata?: Record<string, string>;
};

type MolliePaymentLink = {
  id: string;
  description?: string;
  archived?: boolean;
  paidAt?: string | null;
  expiresAt?: string | null;
  amount?: { value: string; currency: string };
  _links?: { paymentLink?: { href: string } };
};

function paymentLinkRef(id: string) {
  return `${PAYMENT_LINK_PREFIX}${id}`;
}

function parseStoredMollieRef(raw: string | null | undefined): { kind: "payment-link" | "payment"; id: string } | null {
  const value = String(raw || "").trim();
  if (value.startsWith(PAYMENT_LINK_PREFIX)) {
    const id = value.slice(PAYMENT_LINK_PREFIX.length).trim();
    return id ? { kind: "payment-link", id } : null;
  }
  if (value.startsWith(LEGACY_PAYMENT_PREFIX)) {
    const id = value.slice(LEGACY_PAYMENT_PREFIX.length).trim();
    // Ancien format "mollie:tr_..." ou parfois déjà "mollie:pl_..."
    if (id.startsWith("pl_")) return { kind: "payment-link", id };
    return id ? { kind: "payment", id } : null;
  }
  if (value.startsWith("pl_")) return { kind: "payment-link", id: value };
  if (value.startsWith("tr_")) return { kind: "payment", id: value };
  return null;
}

function reservationIdFromDescription(description: string | null | undefined): number | null {
  const match = String(description || "").match(/#(\d+)\b/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isPaymentLinkStillUsable(link: MolliePaymentLink): boolean {
  if (link.archived) return false;
  if (link.paidAt) return false;
  if (link.expiresAt) {
    const expires = new Date(link.expiresAt).getTime();
    if (Number.isFinite(expires) && expires <= Date.now()) return false;
  }
  return Boolean(link._links?.paymentLink?.href);
}

function buildExpiresAt(days = PAYMENT_LINK_TTL_DAYS): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

async function createPaymentLinkForReservation(
  req: import("express").Request,
  reservationId: number,
  amountCents: number,
  description: string,
) {
  const amountValue = (amountCents / 100).toFixed(2);
  const urls = getReturnUrls(req);
  const link = await mollieFetch<MolliePaymentLink>("/payment-links", {
    method: "POST",
    body: JSON.stringify({
      amount: { currency: "EUR", value: amountValue },
      description,
      redirectUrl: `${urls.success}?reservation_id=${reservationId}`,
      webhookUrl: urls.webhook,
      reusable: false,
      expiresAt: buildExpiresAt(),
    }),
  });
  return { link, amountValue };
}

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

    const forceNew = Boolean(req.body?.forceNew);
    const stored = parseStoredMollieRef(r.stripeSessionId);
    if (!forceNew && stored?.kind === "payment-link") {
      try {
        const existing = await mollieFetch<MolliePaymentLink>(
          `/payment-links/${encodeURIComponent(stored.id)}`,
        );
        if (isPaymentLinkStillUsable(existing)) {
          return res.json({
            success: true,
            provider: "mollie",
            kind: "payment-link",
            paymentLinkId: existing.id,
            checkoutUrl: existing._links?.paymentLink?.href || null,
            amountValue: existing.amount?.value || null,
            reused: true,
          });
        }
      } catch {
        // Lien invalide / archivé → on en recrée un.
      }
    }

    const description = `Sabine Sailing acompte réservation #${reservationId}`;
    const { link, amountValue } = await createPaymentLinkForReservation(
      req,
      reservationId,
      amountCents,
      description,
    );

    await db
      .update(reservations)
      .set({
        stripeSessionId: paymentLinkRef(link.id),
        internalComment: `Lien Mollie Payment Link créé (${link.id}) — valide ${PAYMENT_LINK_TTL_DAYS} jours`,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    return res.json({
      success: true,
      provider: "mollie",
      kind: "payment-link",
      paymentLinkId: link.id,
      checkoutUrl: link._links?.paymentLink?.href || null,
      amountValue,
      reused: false,
      expiresAt: link.expiresAt || null,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur création lien Mollie" });
  }
});

router.get("/payment-link/:reservationId", requireAdmin, async (req, res) => {
  try {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isFinite(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: "reservationId invalide" });
    }
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
    if (!r) return res.status(404).json({ error: "Réservation introuvable" });

    const stored = parseStoredMollieRef(r.stripeSessionId);
    if (!stored) {
      return res.status(404).json({ error: "Aucun lien de paiement Mollie enregistré pour cette réservation" });
    }

    if (stored.kind === "payment-link") {
      const link = await mollieFetch<MolliePaymentLink>(`/payment-links/${encodeURIComponent(stored.id)}`);
      return res.json({
        success: true,
        provider: "mollie",
        kind: "payment-link",
        paymentLinkId: link.id,
        checkoutUrl: isPaymentLinkStillUsable(link) ? link._links?.paymentLink?.href || null : null,
        status: link.paidAt ? "paid" : link.archived ? "archived" : "open",
        expiresAt: link.expiresAt || null,
      });
    }

    // Legacy: paiement ponctuel (souvent déjà expiré → checkout null).
    const payment = await mollieFetch<MolliePayment>(`/payments/${encodeURIComponent(stored.id)}`);
    return res.json({
      success: true,
      provider: "mollie",
      kind: "payment",
      paymentId: payment.id,
      checkoutUrl: payment._links?.checkout?.href || null,
      status: payment.status || null,
      warning:
        "Ancien lien Mollie (paiement ponctuel, courte durée). Recréez un lien pour obtenir un Payment Link durable.",
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur récupération lien Mollie" });
  }
});

async function applyPaidStatus(
  reservationId: number,
  amountPaidCents: number,
  paymentIntentRef?: string,
) {
  const db = await getDb();
  if (!db) return { updated: false, emailed: false };

  const [existing] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
  if (!existing) return { updated: false, emailed: false };

  const alreadyPaid = String(existing.statutPaiement || "") === "paye" && Number(existing.montantPaye || 0) > 0;
  const patch: Record<string, unknown> = {
    statutPaiement: "paye",
    montantPaye: Math.max(amountPaidCents, Number(existing.montantPaye || 0)),
    updatedAt: new Date(),
  };
  if (paymentIntentRef) patch.stripePaymentIntentId = paymentIntentRef;

  const workflow = String(existing.workflowStatut || "");
  if (
    !workflow ||
    workflow === "demande" ||
    workflow === "validee_owner" ||
    workflow === "devis_emis" ||
    workflow === "devis_accepte" ||
    workflow === "contrat_envoye" ||
    workflow === "contrat_signe" ||
    workflow === "acompte_attente"
  ) {
    patch.workflowStatut = "acompte_confirme";
  }

  await db.update(reservations).set(patch).where(eq(reservations.id, reservationId));

  let emailed = false;
  if (!alreadyPaid) {
    try {
      emailed = await sendPaymentConfirmationEmail(existing, Math.max(amountPaidCents, 0));
    } catch (error: any) {
      console.warn("[mollie] Echec email confirmation paiement", {
        reservationId,
        error: error?.message || String(error),
      });
    }
  }
  return { updated: true, emailed };
}

async function markReservationPaidFromPayment(payment: MolliePayment) {
  let reservationId = Number(payment?.metadata?.reservationId || "");
  if (!Number.isFinite(reservationId) || reservationId <= 0) {
    reservationId = reservationIdFromDescription(payment.description) || 0;
  }
  if (!Number.isFinite(reservationId) || reservationId <= 0) return;

  if (payment.status === "paid") {
    const amountPaidCents = Math.round(Number(payment.amount?.value || "0") * 100);
    await applyPaidStatus(reservationId, amountPaidCents, `${LEGACY_PAYMENT_PREFIX}${payment.id}`);
    return;
  }

  const canceled = payment.status === "canceled" || payment.status === "expired" || payment.status === "failed";
  if (!canceled) return;

  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
  if (!existing || String(existing.statutPaiement || "") === "paye") return;
  await db
    .update(reservations)
    .set({
      statutPaiement: "echec",
      stripePaymentIntentId: `${LEGACY_PAYMENT_PREFIX}${payment.id}`,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId));
}

async function markReservationPaidFromPaymentLink(link: MolliePaymentLink) {
  if (!link.paidAt) return;
  const amountPaidCents = Math.round(Number(link.amount?.value || "0") * 100);

  let reservationId = reservationIdFromDescription(link.description);
  if (!reservationId) {
    const db = await getDb();
    if (!db) return;
    const rows = await db.select().from(reservations);
    const match = rows.find((row) => String(row.stripeSessionId || "").trim() === paymentLinkRef(link.id));
    if (!match) return;
    reservationId = match.id;
  }

  await applyPaidStatus(reservationId, amountPaidCents || 0);
}

/** Statut public pour la page /reservation/succes (pas de données sensibles). */
router.get("/payment-confirmation/:reservationId", async (req, res) => {
  try {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isFinite(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: "reservationId invalide" });
    }
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
    if (!r) return res.status(404).json({ error: "Réservation introuvable" });

    const paid = String(r.statutPaiement || "") === "paye";
    return res.json({
      reservationId: r.id,
      paid,
      statutPaiement: r.statutPaiement || "en_attente",
      amountPaidCents: Number(r.montantPaye || 0),
      amountPaidLabel: `${(Number(r.montantPaye || 0) / 100).toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} €`,
      destination: r.destination || null,
      dateDebut: r.dateDebut,
      dateFin: r.dateFin,
      clientFirstName: r.prenomClient || null,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur statut paiement" });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const id = String(req.body?.id || req.query?.id || "").trim();
    if (!id) return res.status(200).send("ok");

    if (id.startsWith("pl_")) {
      const link = await mollieFetch<MolliePaymentLink>(`/payment-links/${encodeURIComponent(id)}`);
      await markReservationPaidFromPaymentLink(link);
      return res.status(200).send("ok");
    }

    const payment = await mollieFetch<MolliePayment>(`/payments/${encodeURIComponent(id)}`);
    await markReservationPaidFromPayment(payment);
    return res.status(200).send("ok");
  } catch {
    return res.status(200).send("ok");
  }
});

export default router;
