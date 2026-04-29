import { Router } from "express";
import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { requireAdmin } from "../_core/authz";
import { ENV } from "../_core/env";
import {
  contracts,
  disponibilites,
  invoices,
  quotes,
  reservations,
  reservationStatusHistory,
  esignEvents,
} from "../../drizzle/schema";
import { buildInvoicePdf, buildQuoteContractPdf } from "../_core/commercialDocs";
import { storageGetSignedUrl } from "../storage";
import {
  resolveDisponibiliteIdForReservation,
  refreshDisponibiliteBookingState,
} from "../_core/bookingRules";
import { listReservationsByIdSafe } from "../_core/reservationsSafe";

const router = Router();

const nowYear = () => new Date().getUTCFullYear();
const pad = (n: number) => String(n).padStart(4, "0");

const buildQuoteNumber = (id: number) => `DV-${nowYear()}-${pad(id)}`;
const buildContractNumber = (id: number) => `CT-${nowYear()}-${pad(id)}`;
const buildInvoiceNumber = (id: number, type: "acompte" | "solde" | "full") =>
  `FAC-${type.toUpperCase()}-${nowYear()}-${pad(id)}`;

function toAbsoluteUrl(req: any, rawUrl: string | null | undefined): string | null {
  const value = String(rawUrl || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const baseFromEnv = String(process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  const fallbackBase = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
  const base = baseFromEnv || fallbackBase;
  const normalizedPath = value.startsWith("/") ? value : `/${value}`;
  return `${base}${normalizedPath}`;
}

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || "").trim();
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const fromEmail = (process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  return { host, user, pass, fromEmail, port, secure };
}

type MolliePaymentLookup = {
  _links?: { checkout?: { href?: string } };
};

async function resolveMollieCheckoutUrlFromReservation(reservation: any): Promise<string | null> {
  const paymentRef = String(reservation?.stripeSessionId || "").trim();
  if (!paymentRef.startsWith("mollie:")) return null;
  const paymentId = paymentRef.replace(/^mollie:/, "").trim();
  if (!paymentId) return null;
  const mollieApiKey = String(process.env.MOLLIE_API_KEY || "").trim();
  if (!mollieApiKey) return null;

  try {
    const response = await fetch(`https://api.mollie.com/v2/payments/${encodeURIComponent(paymentId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${mollieApiKey}` },
    });
    if (!response.ok) return null;
    const payment = (await response.json().catch(() => null)) as MolliePaymentLookup | null;
    const checkoutHref = String(payment?._links?.checkout?.href || "").trim();
    return /^https?:\/\//i.test(checkoutHref) ? checkoutHref : null;
  } catch {
    return null;
  }
}

router.post("/reservations/:id/owner-validate", requireAdmin, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const existing = await listReservationsByIdSafe(db, reservationId);
    if (!existing.length) return res.status(404).json({ error: "Réservation introuvable" });
    const r = existing[0];
    const optionExpiresAt = new Date();
    optionExpiresAt.setUTCDate(optionExpiresAt.getUTCDate() + 7);

    const acompteMontant = Math.round((r.montantTotal * 20) / 100);
    const soldeMontant = Math.max(0, r.montantTotal - acompteMontant);
    const soldeEcheanceAt = new Date(r.dateDebut);
    soldeEcheanceAt.setUTCDate(soldeEcheanceAt.getUTCDate() - 45);

    await db
      .update(reservations)
      .set({
        workflowStatut: "validee_owner",
        acomptePercent: 20,
        acompteMontant,
        soldeMontant,
        soldeEcheanceAt,
        ownerValidatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    const linkedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, r);
    if (linkedDisponibiliteId) {
      await db
        .update(disponibilites)
        .set({
          statut: "option",
          updatedAt: new Date(),
        })
        .where(eq(disponibilites.id, linkedDisponibiliteId));
    }

    const quoteNumber = buildQuoteNumber(reservationId);
    const contractNumber = buildContractNumber(reservationId);
    const proposalPdf = await buildQuoteContractPdf(r, quoteNumber, contractNumber, optionExpiresAt);
    const proposalFile = await storagePut(
      `commercial/proposals/proposition-${reservationId}.pdf`,
      proposalPdf,
      "application/pdf"
    );

    const existingQuotes = await db.select().from(quotes).where(eq(quotes.reservationId, reservationId));
    let quoteId: number | null = null;
    if (existingQuotes.length) {
      const existingQuote = existingQuotes.slice().sort((a, b) => b.id - a.id)[0];
      await db
        .update(quotes)
        .set({
          quoteNumber,
          totalAmount: r.montantTotal,
          currency: "EUR",
          pdfStorageKey: proposalFile.key,
        })
        .where(eq(quotes.id, existingQuote.id));
      quoteId = existingQuote.id;
    } else {
      const quoteInsert = await db
        .insert(quotes)
        .values({
          reservationId,
          quoteNumber,
          totalAmount: r.montantTotal,
          currency: "EUR",
          pdfStorageKey: proposalFile.key,
        })
        .returning({ id: quotes.id });
      quoteId = quoteInsert[0]?.id ?? null;
    }

    const existingContracts = await db.select().from(contracts).where(eq(contracts.reservationId, reservationId));
    let createdContract: { id: number; contractNumber: string; pdfStorageKey: string | null };
    if (existingContracts.length) {
      const existingContract = existingContracts.slice().sort((a, b) => b.id - a.id)[0];
      await db
        .update(contracts)
        .set({
          quoteId,
          contractNumber,
          pdfStorageKey: proposalFile.key,
        })
        .where(eq(contracts.id, existingContract.id));
      createdContract = {
        id: existingContract.id,
        contractNumber,
        pdfStorageKey: proposalFile.key,
      };
    } else {
      const contractInsert = await db
        .insert(contracts)
        .values({
          reservationId,
          quoteId,
          contractNumber,
          pdfStorageKey: proposalFile.key,
          esignProvider: "other",
        })
        .returning({ id: contracts.id, contractNumber: contracts.contractNumber, pdfStorageKey: contracts.pdfStorageKey });
      createdContract = contractInsert[0];
    }
    await db
      .update(reservations)
      .set({
        workflowStatut: "validee_owner",
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    await db.insert(reservationStatusHistory).values({
      reservationId,
      fromStatut: r.workflowStatut,
      toStatut: "validee_owner",
      actorType: "admin",
      note: "Réservation validée par le propriétaire. Devis et contrat générés (en attente d'envoi).",
    });

    return res.json({
      success: true,
      acompteMontant,
      soldeMontant,
      soldeEcheanceAt,
      optionExpiresAt,
      quoteUrl: proposalFile.url,
      contractUrl: proposalFile.url,
      contractId: createdContract.id,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur workflow owner validation" });
  }
});

router.post("/reservations/:id/send-contract", requireAdmin, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const existing = await listReservationsByIdSafe(db, reservationId);
    if (!existing.length) return res.status(404).json({ error: "Réservation introuvable" });
    const r = existing[0];

    const contractRows = await db.select().from(contracts).where(eq(contracts.reservationId, reservationId));
    if (!contractRows.length) {
      return res.status(400).json({ error: "Aucun contrat généré. Validez d'abord la réservation." });
    }
    const contract = contractRows.slice().sort((a, b) => b.id - a.id)[0];
    if (!contract.pdfStorageKey) {
      return res.status(400).json({ error: "Contrat sans fichier PDF." });
    }

    const sentAt = new Date();
    const proposalUrl = await storageGetSignedUrl(contract.pdfStorageKey).catch(() => null);

    await db
      .update(contracts)
      .set({
        esignProvider: "other",
        esignEnvelopeId: null,
        sentAt,
      })
      .where(eq(contracts.id, contract.id));

    const linkedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, r);
    if (linkedDisponibiliteId) {
      await refreshDisponibiliteBookingState(db, linkedDisponibiliteId);
    }

    await db
      .update(reservations)
      .set({
        workflowStatut: "contrat_envoye",
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    await db.insert(reservationStatusHistory).values({
      reservationId,
      fromStatut: r.workflowStatut,
      toStatut: "contrat_envoye",
      actorType: "admin",
      note: "Proposition PDF (devis + contrat) envoyée au client.",
    });

    return res.json({
      success: true,
      proposalUrl,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur envoi contrat" });
  }
});

router.post("/reservations/:id/send-proposal-email", requireAdmin, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const existing = await listReservationsByIdSafe(db, reservationId);
    if (!existing.length) return res.status(404).json({ error: "Réservation introuvable" });
    const r = existing[0];
    if (!r.emailClient) return res.status(400).json({ error: "Email client manquant" });

    const quoteRows = await db.select().from(quotes).where(eq(quotes.reservationId, reservationId));
    const contractRows = await db.select().from(contracts).where(eq(contracts.reservationId, reservationId));
    const latestQuote = quoteRows.slice().sort((a, b) => b.id - a.id)[0] || null;
    const latestContract = contractRows.slice().sort((a, b) => b.id - a.id)[0] || null;

    const quoteUrlRaw = latestQuote?.pdfStorageKey ? await storageGetSignedUrl(latestQuote.pdfStorageKey).catch(() => null) : null;
    const contractUrlRaw = latestContract?.pdfStorageKey ? await storageGetSignedUrl(latestContract.pdfStorageKey).catch(() => null) : null;
    const quoteUrl = toAbsoluteUrl(req, quoteUrlRaw);
    const contractUrl = toAbsoluteUrl(req, contractUrlRaw);
    const paymentUrlRaw = String(req.body?.paymentUrl || "").trim();
    const paymentUrlFromBody = /^https?:\/\//i.test(paymentUrlRaw) ? paymentUrlRaw : null;
    const looksLikeSiteResultPage = /\/reservation\/(succes|annule)(\/|$|\?)/i.test(paymentUrlFromBody || "");
    const paymentUrl =
      (!looksLikeSiteResultPage && paymentUrlFromBody) || (await resolveMollieCheckoutUrlFromReservation(r)) || null;

    const smtp = getSmtpConfig();
    if (!smtp.host || !smtp.user || !smtp.pass || !smtp.fromEmail) {
      return res.status(400).json({
        error:
          "SMTP non configuré. Définissez SMTP_HOST, SMTP_USER, SMTP_PASS et CONTACT_FROM_EMAIL.",
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    const subject = `Votre proposition de croisière - réservation #${reservationId}`;
    const textLines = [
      `Bonjour ${r.nomClient || ""},`,
      "",
      "Votre proposition est prête.",
      contractUrl ? `Proposition (devis + contrat PDF): ${contractUrl}` : "Proposition PDF: indisponible",
      paymentUrl ? `Lien de paiement acompte (20%): ${paymentUrl}` : "Lien de paiement: indisponible",
      "",
      "N'hésitez pas à répondre à cet email si vous avez des questions.",
      "",
      "Merci.",
      "Sabine Sailing",
    ];

    await transporter.sendMail({
      from: smtp.fromEmail,
      to: r.emailClient,
      subject,
      text: textLines.join("\n"),
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; color:#0f172a; line-height:1.5;">
          <h2 style="margin:0 0 12px; color:#0b3a53;">Votre proposition est prête</h2>
          <p style="margin:0 0 14px;">Bonjour ${String(r.nomClient || "client")},</p>
          <p style="margin:0 0 16px;">
            Nous vous remercions pour votre demande. Vous pouvez maintenant consulter vos documents et finaliser votre dossier.
          </p>
          <div style="margin:0 0 16px; padding:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
            <p style="margin:0;">${contractUrl ? `<a href="${contractUrl}" style="color:#0b3a53; font-weight:600;">Télécharger la proposition (devis + contrat PDF)</a>` : "Proposition PDF indisponible"}</p>
          </div>
          <p style="margin:0 0 16px;">
            ${
              paymentUrl
                ? `<a href="${paymentUrl}" style="display:inline-block; background:#16a34a; color:#ffffff; text-decoration:none; padding:10px 14px; border-radius:8px; font-weight:600;">Régler l'acompte (20%)</a>`
                : `<span style="color:#64748b;">Lien de paiement indisponible.</span>`
            }
          </p>
          <p style="margin:0;">N'hésitez pas à répondre à cet email si vous avez des questions.</p>
          <p style="margin:14px 0 0;">Merci,<br/>Sabine Sailing</p>
        </div>
      `,
    });

    return res.json({ success: true, quoteUrl, contractUrl, paymentUrl });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur envoi email proposition" });
  }
});

router.post("/reservations/:id/acompte-received", requireAdmin, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const existing = await listReservationsByIdSafe(db, reservationId);
    if (!existing.length) return res.status(404).json({ error: "Réservation introuvable" });
    const r = existing[0];

    const acompteAmount = r.acompteMontant || Math.round((r.montantTotal * 20) / 100);

    // Toggle: si déjà confirmé, un second clic annule la confirmation d'acompte.
    if (r.workflowStatut === "acompte_confirme") {
      const linkedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, r);
      await db
        .update(reservations)
        .set({
          workflowStatut: "contrat_envoye",
          montantPaye: 0,
          statutPaiement: "en_attente",
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, reservationId));
      if (linkedDisponibiliteId) {
        await db
          .update(disponibilites)
          .set({
            statut: "option",
            updatedAt: new Date(),
          })
          .where(eq(disponibilites.id, linkedDisponibiliteId));
      }

      await db.insert(reservationStatusHistory).values({
        reservationId,
        fromStatut: "acompte_confirme",
        toStatut: "contrat_envoye",
        actorType: "admin",
        note: "Annulation de la confirmation d'acompte (second clic).",
      });
      if (linkedDisponibiliteId) {
        await refreshDisponibiliteBookingState(db, linkedDisponibiliteId);
      }

      return res.json({ success: true, cancelled: true, acompteAmount: 0, invoiceUrl: null });
    }

    await db
      .update(reservations)
      .set({
        workflowStatut: "acompte_confirme",
        montantPaye: acompteAmount,
        statutPaiement: "en_attente",
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));
    const linkedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, r);
    if (linkedDisponibiliteId) {
      await refreshDisponibiliteBookingState(db, linkedDisponibiliteId);
    }

    const existingAcompteInvoice = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.reservationId, reservationId), eq(invoices.invoiceType, "acompte")))
      .limit(1);

    let invoiceUrl: string | null = null;
    if (existingAcompteInvoice.length) {
      invoiceUrl = existingAcompteInvoice[0].pdfStorageKey
        ? await storageGetSignedUrl(existingAcompteInvoice[0].pdfStorageKey).catch(() => null)
        : null;
    } else {
      const invoiceNumber = buildInvoiceNumber(reservationId, "acompte");
      const invoicePdf = await buildInvoicePdf(r, invoiceNumber, "acompte", acompteAmount, new Date());
      const invoiceFile = await storagePut(
        `commercial/invoices/invoice-acompte-${reservationId}.pdf`,
        invoicePdf,
        "application/pdf"
      );

      await db.insert(invoices).values({
        reservationId,
        invoiceNumber,
        invoiceType: "acompte",
        amount: acompteAmount,
        currency: "EUR",
        dueAt: new Date(),
        paidAt: new Date(),
        pdfStorageKey: invoiceFile.key,
      });
      invoiceUrl = invoiceFile.url;
    }

    await db.insert(reservationStatusHistory).values({
      reservationId,
      fromStatut: r.workflowStatut,
      toStatut: "acompte_confirme",
      actorType: "admin",
      note: "Acompte de 20% confirmé manuellement (virement reçu). Le créneau passe d'option à réservation.",
    });

    return res.json({ success: true, acompteAmount, invoiceUrl });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur confirmation acompte" });
  }
});

router.post("/reservations/:id/contract-signed", requireAdmin, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const existing = await listReservationsByIdSafe(db, reservationId);
    if (!existing.length) return res.status(404).json({ error: "Réservation introuvable" });
    const r = existing[0];
    const linkedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, r);

    await db
      .update(reservations)
      .set({
        workflowStatut: "contrat_signe",
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    await db.insert(reservationStatusHistory).values({
      reservationId,
      fromStatut: r.workflowStatut,
      toStatut: "contrat_signe",
      actorType: "admin",
      note: "Contrat marqué comme signé manuellement depuis le backoffice.",
    });
    if (linkedDisponibiliteId) {
      await refreshDisponibiliteBookingState(db, linkedDisponibiliteId);
    }

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur validation contrat" });
  }
});

router.post("/reservations/:id/solde-received", requireAdmin, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const existing = await listReservationsByIdSafe(db, reservationId);
    if (!existing.length) return res.status(404).json({ error: "Réservation introuvable" });
    const r = existing[0];

    const soldeAmount = r.soldeMontant || Math.max(0, r.montantTotal - (r.acompteMontant || 0));
    const acompteAmount = r.acompteMontant || Math.round((r.montantTotal * 20) / 100);

    // Toggle: si déjà confirmé, un second clic annule la confirmation du solde.
    if (r.workflowStatut === "solde_confirme") {
      const linkedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, r);
      await db
        .update(reservations)
        .set({
          workflowStatut: "acompte_confirme",
          montantPaye: acompteAmount,
          statutPaiement: "en_attente",
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, reservationId));
      if (linkedDisponibiliteId) {
        await db
          .update(disponibilites)
          .set({
            statut: "reserve",
            updatedAt: new Date(),
          })
          .where(eq(disponibilites.id, linkedDisponibiliteId));
      }

      await db.insert(reservationStatusHistory).values({
        reservationId,
        fromStatut: "solde_confirme",
        toStatut: "acompte_confirme",
        actorType: "admin",
        note: "Annulation de la confirmation du solde (second clic).",
      });
      if (linkedDisponibiliteId) {
        await refreshDisponibiliteBookingState(db, linkedDisponibiliteId);
      }

      return res.json({ success: true, cancelled: true, soldeAmount: 0, invoiceUrl: null });
    }

    await db
      .update(reservations)
      .set({
        workflowStatut: "solde_confirme",
        montantPaye: r.montantTotal,
        statutPaiement: "paye",
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));
    const linkedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, r);
    if (linkedDisponibiliteId) {
      await refreshDisponibiliteBookingState(db, linkedDisponibiliteId);
    }

    const existingSoldeInvoice = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.reservationId, reservationId), eq(invoices.invoiceType, "solde")))
      .limit(1);

    let invoiceUrl: string | null = null;
    if (existingSoldeInvoice.length) {
      invoiceUrl = existingSoldeInvoice[0].pdfStorageKey
        ? await storageGetSignedUrl(existingSoldeInvoice[0].pdfStorageKey).catch(() => null)
        : null;
    } else {
      const invoiceNumber = buildInvoiceNumber(reservationId, "solde");
      const invoicePdf = await buildInvoicePdf(
        r,
        invoiceNumber,
        "solde",
        soldeAmount,
        r.soldeEcheanceAt || new Date()
      );
      const invoiceFile = await storagePut(
        `commercial/invoices/invoice-solde-${reservationId}.pdf`,
        invoicePdf,
        "application/pdf"
      );

      await db.insert(invoices).values({
        reservationId,
        invoiceNumber,
        invoiceType: "solde",
        amount: soldeAmount,
        currency: "EUR",
        dueAt: r.soldeEcheanceAt || new Date(),
        paidAt: new Date(),
        pdfStorageKey: invoiceFile.key,
      });
      invoiceUrl = invoiceFile.url;
    }

    await db.insert(reservationStatusHistory).values({
      reservationId,
      fromStatut: r.workflowStatut,
      toStatut: "solde_confirme",
      actorType: "admin",
      note: "Solde confirmé manuellement (virement reçu).",
    });

    return res.json({ success: true, soldeAmount, invoiceUrl });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur confirmation solde" });
  }
});

router.get("/reservations/:id/documents", requireAdmin, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const [quoteList, contractList, invoiceList] = await Promise.all([
      db.select().from(quotes).where(eq(quotes.reservationId, reservationId)),
      db.select().from(contracts).where(eq(contracts.reservationId, reservationId)),
      db.select().from(invoices).where(eq(invoices.reservationId, reservationId)),
    ]);

    const quotesWithUrls = await Promise.all(
      quoteList.map(async (q) => ({
        ...q,
        downloadUrl: q.pdfStorageKey ? await storageGetSignedUrl(q.pdfStorageKey).catch(() => null) : null,
      }))
    );
    const contractsWithUrls = await Promise.all(
      contractList.map(async (c) => ({
        ...c,
        downloadUrl: c.pdfStorageKey ? await storageGetSignedUrl(c.pdfStorageKey).catch(() => null) : null,
      }))
    );
    const invoicesWithUrls = await Promise.all(
      invoiceList.map(async (i) => ({
        ...i,
        downloadUrl: i.pdfStorageKey ? await storageGetSignedUrl(i.pdfStorageKey).catch(() => null) : null,
      }))
    );

    return res.json({
      quotes: quotesWithUrls,
      contracts: contractsWithUrls,
      invoices: invoicesWithUrls,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur listing documents" });
  }
});

// Webhook conservé en no-op pour compatibilité (e-sign désactivé)
router.post("/esign/webhook", async (req, res) => {
  void req;
  return res.json({ success: true, ignored: true });
});

export default router;
