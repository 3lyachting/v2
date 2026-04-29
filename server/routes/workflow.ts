import { Router } from "express";
import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import crypto from "node:crypto";
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
import { buildInvoicePdf, buildQuotePdf, buildContractPdf } from "../_core/commercialDocs";
import { dispatchEsign } from "../_core/esign";
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

function normalizeSignature(input: string) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("sha256=")) return value.slice("sha256=".length).trim();
  return value;
}

function safeEqualHex(expectedHex: string, incoming: string) {
  const a = Buffer.from(normalizeSignature(expectedHex), "utf8");
  const b = Buffer.from(normalizeSignature(incoming), "utf8");
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyYousignSignature(rawBody: Buffer, secret: string, headers: Record<string, unknown>) {
  const candidateHeaderKeys = [
    "x-yousign-signature-256",
    "x-yousign-signature",
    "yousign-signature",
    "x-signature",
  ];
  const provided = candidateHeaderKeys
    .map((k) => String(headers[k] || "").trim())
    .find((v) => v.length > 0);
  if (!provided) return false;
  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expectedHex, provided);
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
    const quotePdf = await buildQuotePdf(r, quoteNumber, optionExpiresAt);
    const quoteFile = await storagePut(
      `commercial/quotes/devis-${reservationId}.pdf`,
      quotePdf,
      "application/pdf"
    );

    const contractPdf = await buildContractPdf(r, contractNumber);
    const contractFile = await storagePut(
      `commercial/contracts/contrat-${reservationId}.pdf`,
      contractPdf,
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
          pdfStorageKey: quoteFile.key,
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
          pdfStorageKey: quoteFile.key,
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
          pdfStorageKey: contractFile.key,
        })
        .where(eq(contracts.id, existingContract.id));
      createdContract = {
        id: existingContract.id,
        contractNumber,
        pdfStorageKey: contractFile.key,
      };
    } else {
      const contractInsert = await db
        .insert(contracts)
        .values({
          reservationId,
          quoteId,
          contractNumber,
          pdfStorageKey: contractFile.key,
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
      quoteUrl: quoteFile.url,
      contractUrl: contractFile.url,
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

    const configuredProvider = (process.env.ESIGN_PROVIDER || "other").toLowerCase();
    const strictEsign =
      configuredProvider === "yousign" || configuredProvider === "docusign" || configuredProvider === "docuseal";
    let esignProvider: "yousign" | "docusign" | "docuseal" | "other" = "other";
    let esignProviderDb: "yousign" | "docusign" | "other" = "other";
    let esignEnvelopeId = `manual-${reservationId}-${Date.now()}`;
    let signUrl: string | null = null;
    let sentAt: Date | null = null;
    let fallbackReason: string | null = null;

    try {
      const signedUrl = await storageGetSignedUrl(contract.pdfStorageKey);
      const quoteRows = await db.select().from(quotes).where(eq(quotes.reservationId, reservationId));
      const latestQuote = quoteRows.slice().sort((a, b) => b.id - a.id)[0] || null;
      const quoteSignedUrl = latestQuote?.pdfStorageKey
        ? await storageGetSignedUrl(latestQuote.pdfStorageKey).catch(() => null)
        : null;
      const webhookBase = `${req.protocol}://${req.get("host")}`;
      const result = await dispatchEsign({
        contractNumber: contract.contractNumber,
        signerName: r.nomClient,
        signerEmail: r.emailClient,
        contractDownloadUrl: signedUrl,
        webhookUrl: `${webhookBase}/api/workflow/esign/webhook`,
        additionalDocuments: quoteSignedUrl
          ? [{ name: `Devis reservation ${reservationId}.pdf`, downloadUrl: quoteSignedUrl }]
          : [],
      });
      esignProvider = result.provider;
      esignProviderDb = result.provider === "docuseal" ? "other" : result.provider;
      esignEnvelopeId = result.envelopeId;
      signUrl = result.signUrl;
      sentAt = result.sentAt;
    } catch (error: any) {
      const reason = error?.message || "Erreur envoi e-sign";
      if (strictEsign) {
        return res.status(502).json({
          error: `Échec ${configuredProvider}: ${reason}`,
        });
      }
      esignProvider = "other";
      esignProviderDb = "other";
      esignEnvelopeId = `manual-${reservationId}-${Date.now()}`;
      sentAt = new Date();
      fallbackReason = reason;
    }

    await db
      .update(contracts)
      .set({
        esignProvider: esignProviderDb,
        esignEnvelopeId,
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
      note: "Contrat envoyé au client pour signature.",
    });

    return res.json({
      success: true,
      esign: {
        provider: esignProvider,
        envelopeId: esignEnvelopeId,
        signUrl,
        fallbackReason,
        webhookUrl: "/api/workflow/esign/webhook",
      },
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
    const paymentUrl = String(req.body?.paymentUrl || "").trim() || null;
    const contractSignUrl = toAbsoluteUrl(req, String(req.body?.contractSignUrl || "").trim() || null);

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
      contractSignUrl
        ? `Signature électronique (contrat + devis): ${contractSignUrl}`
        : "Signature électronique: indisponible",
      quoteUrl ? `Devis (PDF): ${quoteUrl}` : "Devis (PDF): indisponible",
      contractUrl ? `Contrat (PDF): ${contractUrl}` : "Contrat (PDF): indisponible",
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
            ${
              contractSignUrl
                ? `<p style="margin:0 0 10px;"><a href="${contractSignUrl}" style="display:inline-block; background:#0b3a53; color:#ffffff; text-decoration:none; padding:10px 14px; border-radius:8px; font-weight:600;">Signer en ligne (Yousign)</a></p>`
                : `<p style="margin:0 0 10px; color:#64748b;">Lien de signature en ligne indisponible pour le moment.</p>`
            }
            <p style="margin:0 0 6px;">${quoteUrl ? `<a href="${quoteUrl}" style="color:#0b3a53;">Télécharger le devis (PDF)</a>` : "Devis PDF indisponible"}</p>
            <p style="margin:0;">${contractUrl ? `<a href="${contractUrl}" style="color:#0b3a53;">Télécharger le contrat (PDF)</a>` : "Contrat PDF indisponible"}</p>
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

    return res.json({ success: true, quoteUrl, contractUrl, contractSignUrl, paymentUrl });
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

// Webhook générique e-sign (Yousign/DocuSign/other)
router.post("/esign/webhook", async (req, res) => {
  try {
    const expectedSecret = process.env.ESIGN_WEBHOOK_SECRET || ENV.cookieSecret;
    const rawBody =
      Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}), "utf8");
    const incomingSecret = String(req.headers["x-webhook-secret"] || "");
    const bySharedHeader = Boolean(expectedSecret && incomingSecret && incomingSecret === expectedSecret);
    const byYousignSignature = Boolean(
      expectedSecret && verifyYousignSignature(rawBody, expectedSecret, req.headers as Record<string, unknown>)
    );
    if (!bySharedHeader && !byYousignSignature) {
      return res.status(401).json({ error: "Webhook non autorisé (signature invalide)." });
    }

    let body: any = {};
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      body = typeof req.body === "object" && req.body ? req.body : {};
    }
    const { contractId, envelopeId, provider, eventType, payload } = body || {};
    if (!eventType || (!contractId && !envelopeId)) {
      return res.status(400).json({ error: "eventType + (contractId ou envelopeId) requis" });
    }
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    let resolvedContractId: number | null = contractId ? parseInt(contractId, 10) : null;
    if (!resolvedContractId && envelopeId) {
      const matched = await db.select().from(contracts).where(eq(contracts.esignEnvelopeId, String(envelopeId)));
      resolvedContractId = matched[0]?.id ?? null;
    }
    if (!resolvedContractId) {
      return res.status(404).json({ error: "Contrat e-sign introuvable" });
    }

    await db.insert(esignEvents).values({
      contractId: resolvedContractId,
      provider: provider || "other",
      eventType: String(eventType),
      payload: payload ? JSON.stringify(payload) : null,
    });

    const event = String(eventType).toLowerCase();
    const isSigned =
      event.includes("signed") ||
      event.includes("completed") ||
      event.includes("done") ||
      event.includes("signature_request.done");
    if (isSigned) {
      await db
        .update(contracts)
        .set({ signedAt: new Date() })
        .where(eq(contracts.id, resolvedContractId));

      const linked = await db.select().from(contracts).where(eq(contracts.id, resolvedContractId));
      const reservationId = linked[0]?.reservationId;
      if (reservationId) {
        const current = await listReservationsByIdSafe(db, reservationId);
        const previous = current[0];
        await db
          .update(reservations)
          .set({ workflowStatut: "contrat_signe", updatedAt: new Date() })
          .where(eq(reservations.id, reservationId));
        const linkedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, previous);
        if (linkedDisponibiliteId) {
          await refreshDisponibiliteBookingState(db, linkedDisponibiliteId);
        }
        await db.insert(reservationStatusHistory).values({
          reservationId,
          fromStatut: previous?.workflowStatut || null,
          toStatut: "contrat_signe",
          actorType: "system",
          note: "Contrat signé via webhook e-sign.",
        });
      }
    }

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur webhook e-sign" });
  }
});

export default router;
