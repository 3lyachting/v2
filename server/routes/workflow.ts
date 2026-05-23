import { Router } from "express";
import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { requireAdmin } from "../_core/authz";
import { ENV } from "../_core/env";
import { dispatchEsign } from "../_core/esign";
import {
  contracts,
  disponibilites,
  invoices,
  quotes,
  reservations,
  reservationStatusHistory,
  esignEvents,
} from "../../drizzle/schema";
import {
  buildContractPdf,
  buildInvoicePdf,
  buildQuotePdf,
  computeReservationPaymentSchedule,
  DAY_TRIP_DISEMBARK_HOUR,
  DAY_TRIP_EMBARK_HOUR,
  isDayTripReservation,
} from "../_core/commercialDocs";
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

function isDayReservation(reservation: any): boolean {
  return isDayTripReservation(reservation);
}

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

function formatDateForEmail(value: string | Date | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function toDbEsignProvider(provider: string): "yousign" | "docusign" | "other" {
  if (provider === "yousign" || provider === "docusign") return provider;
  // Schéma actuel: enum DB ne contient pas "docuseal".
  return "other";
}

function readSignUrlFromEsignPayload(rawPayload: string | null | undefined): string | null {
  if (!rawPayload) return null;
  try {
    const parsed = JSON.parse(rawPayload) as any;
    const value = String(parsed?.signUrl || parsed?.sign_url || "").trim();
    return /^https?:\/\//i.test(value) ? value : null;
  } catch {
    return null;
  }
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

    const { acomptePercent, acompteMontant, soldeMontant, soldeEcheanceAt } = computeReservationPaymentSchedule(r);

    await db
      .update(reservations)
      .set({
        workflowStatut: "validee_owner",
        acomptePercent,
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
    const contractPdf = await buildContractPdf(r, contractNumber);
    console.info("[Workflow][owner-validate] PDF devis + contrat generes", {
      reservationId,
      quoteNumber,
      contractNumber,
    });
    const quoteFile = await storagePut(
      `commercial/quotes/devis-${reservationId}.pdf`,
      quotePdf,
      "application/pdf"
    );
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

    const proposalUrlRaw = await storageGetSignedUrl(contract.pdfStorageKey).catch(() => null);
    const proposalUrl = toAbsoluteUrl(req, proposalUrlRaw);
    const sentAt = new Date();
    const signerName = `${String(r.prenomClient || "").trim()} ${String(r.nomClient || "").trim()}`.trim() || String(r.nomClient || "Client");
    const canUseEsign =
      String(ENV.eSignProvider || "other").toLowerCase() !== "other" &&
      Boolean(proposalUrl) &&
      Boolean(r.emailClient);
    let esignProvider: "yousign" | "docusign" | "other" = "other";
    let esignEnvelopeId: string | null = null;
    let signUrl: string | null = null;
    let esignWarning: string | null = null;

    if (canUseEsign) {
      const publicBase = String(ENV.publicBaseUrl || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      const webhookUrl = `${publicBase}/api/workflow/esign/webhook`;
      const providerName = String(ENV.eSignProvider || "").toLowerCase();
      console.info("[Workflow][send-contract] E-sign dispatch", {
        reservationId,
        provider: providerName || "other",
      });
      try {
        const dispatchResult = await dispatchEsign({
          contractNumber: contract.contractNumber,
          signerName,
          signerEmail: String(r.emailClient),
          contractDownloadUrl: String(proposalUrl),
          webhookUrl,
          isDayTrip: isDayReservation(r),
        });
        esignProvider = toDbEsignProvider(dispatchResult.provider);
        esignEnvelopeId = dispatchResult.envelopeId || null;
        signUrl = dispatchResult.signUrl || null;
        console.info("[Workflow][send-contract] E-sign ok", {
          reservationId,
          envelopeId: esignEnvelopeId,
          hasSignUrl: Boolean(signUrl),
        });
        await db.insert(esignEvents).values({
          contractId: contract.id,
          provider: esignProvider,
          eventType: "sent",
          payload: JSON.stringify({
            sourceProvider: dispatchResult.provider,
            envelopeId: dispatchResult.envelopeId,
            signUrl: dispatchResult.signUrl,
            sentAt: dispatchResult.sentAt,
          }),
        });
      } catch (esignError: any) {
        esignWarning = esignError?.message || "E-sign indisponible";
        console.warn("[Workflow][send-contract] E-sign failed", {
          reservationId,
          message: esignWarning,
        });
        await db.insert(esignEvents).values({
          contractId: contract.id,
          provider: "other",
          eventType: "dispatch_failed",
          payload: JSON.stringify({ message: esignWarning }),
        });
      }
    }

    await db
      .update(contracts)
      .set({
        esignProvider,
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
      note:
        canUseEsign && !esignWarning
          ? "Contrat envoyé pour signature électronique (DocuSeal/e-sign)."
          : canUseEsign && esignWarning
            ? `E-sign indisponible (${esignWarning}). Envoi du contrat sans signature électronique.`
            : "Proposition PDF (devis + contrat) envoyée au client.",
    });

    return res.json({
      success: true,
      proposalUrl,
      signUrl,
      esignEnvelopeId,
      esignWarning,
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
    const signUrlRaw = String(req.body?.signUrl || "").trim();
    let signUrl = /^https?:\/\//i.test(signUrlRaw) ? signUrlRaw : null;
    if (!signUrl && latestContract?.id) {
      const recentEvents = await db
        .select()
        .from(esignEvents)
        .where(eq(esignEvents.contractId, latestContract.id));
      const sortedEvents = recentEvents.slice().sort((a, b) => b.id - a.id);
      for (const eventRow of sortedEvents) {
        const candidate = readSignUrlFromEsignPayload(eventRow.payload);
        if (candidate) {
          signUrl = candidate;
          break;
        }
      }
    }
    const isDayTrip = isDayReservation(r);
    const esignEnabled = String(ENV.eSignProvider || "other").toLowerCase() !== "other";
    if (esignEnabled && !signUrl) {
      console.warn("[Workflow][send-proposal-email] Missing signUrl while e-sign enabled, fallback email", {
        reservationId,
        provider: ENV.eSignProvider,
      });
      return res.status(400).json({
        error:
          "Lien de signature DocuSeal introuvable. Email annulé pour éviter l'envoi d'un lien PDF non signé.",
      });
    }
    const paymentUrlRaw = String(req.body?.paymentUrl || "").trim();
    const paymentUrlFromBody = /^https?:\/\//i.test(paymentUrlRaw) ? paymentUrlRaw : null;
    const looksLikeSiteResultPage = /\/reservation\/(succes|annule)(\/|$|\?)/i.test(paymentUrlFromBody || "");
    const paymentUrl = isDayTrip
      ? null
      : (!looksLikeSiteResultPage && paymentUrlFromBody) || (await resolveMollieCheckoutUrlFromReservation(r)) || null;

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
    const fullName = `${String(r.prenomClient || "").trim()} ${String(r.nomClient || "").trim()}`.trim() || "Client";
    const embarkDate = isDayTrip
      ? `${formatDateForEmail(r.dateDebut)} · ${DAY_TRIP_EMBARK_HOUR.replace(":", "h")} - ${DAY_TRIP_DISEMBARK_HOUR.replace(":", "h")}`
      : formatDateForEmail(r.dateDebut);
    const disembarkDate = isDayTrip ? "—" : formatDateForEmail(r.dateFin);
    const reservationLabel = isDayTrip ? "Sortie journée" : "Croisière";
    const destinationLabel = String(r.destination || "La Ciotat");
    const totalTtc = `${(Number(r.montantTotal || 0) / 100).toLocaleString("fr-FR")} € TTC`;
    const logoPathCandidates = [
      path.resolve(process.cwd(), "client", "public", "logo-sabine.png"),
      path.resolve(process.cwd(), "dist", "public", "logo-sabine.png"),
      path.resolve(process.cwd(), "public", "logo-sabine.png"),
    ];
    const logoPath = logoPathCandidates.find((candidate) => existsSync(candidate)) || null;
    const logoCid = logoPath ? "sabine-logo@3lyachting" : null;
    const textLines = signUrl
      ? [
          `Bonjour ${r.nomClient || ""},`,
          "",
          "Votre contrat est prêt à être signé.",
          `Lien de signature sécurisé: ${signUrl}`,
          ...(!isDayTrip
            ? [paymentUrl ? `Lien de paiement acompte (20%): ${paymentUrl}` : "Lien de paiement: indisponible"]
            : []),
          "",
          "N'hésitez pas à répondre à cet email si vous avez des questions.",
          "",
          "Merci.",
          "Sabine Sailing",
        ]
      : [
          `Bonjour ${r.nomClient || ""},`,
          "",
          "Votre proposition est prête.",
          contractUrl ? `Proposition (devis + contrat PDF): ${contractUrl}` : "Proposition PDF: indisponible",
          isDayTrip
            ? "Aucun lien de paiement en ligne n'est envoyé pour les sorties journée. Merci d'utiliser le virement (IBAN sur le devis)."
            : paymentUrl
              ? `Lien de paiement acompte (20%): ${paymentUrl}`
              : "Lien de paiement: indisponible",
          "",
          "N'hésitez pas à répondre à cet email si vous avez des questions.",
          "",
          "Merci.",
          "Sabine Sailing",
        ];

    await transporter.verify();

    const mailInfo = await transporter.sendMail({
      from: smtp.fromEmail,
      to: r.emailClient,
      subject,
      text: textLines.join("\n"),
      attachments: logoPath && logoCid ? [{ filename: "logo-sabine.png", path: logoPath, cid: logoCid }] : [],
      html: `
        <div style="margin:0;padding:24px;background:#f3f7f9;font-family:Arial,Helvetica,sans-serif;color:#10212c;">
          <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #dbe5ea;border-radius:16px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#00384a,#0b3a53);padding:22px 24px;color:#ffffff;">
              <div style="display:flex;align-items:center;gap:14px;">
                ${logoCid ? `<img src="cid:${logoCid}" alt="Sabine Sailing" style="height:40px;width:auto;display:block;background:#ffffff;padding:4px;border-radius:8px;" />` : ""}
                <div>
                  <p style="margin:0;font-size:12px;opacity:0.9;letter-spacing:0.6px;text-transform:uppercase;">Sabine Sailing</p>
                  <h1 style="margin:4px 0 0;font-size:20px;line-height:1.2;">${signUrl ? "Votre contrat est prêt à signer" : "Votre proposition est prête"}</h1>
                </div>
              </div>
            </div>
            <div style="padding:24px;">
              <p style="margin:0 0 12px;font-size:15px;">Bonjour <strong>${fullName}</strong>,</p>
              <p style="margin:0 0 16px;color:#334155;font-size:14px;">
                Merci pour votre demande. Nous avons préparé votre dossier et vous trouverez ci-dessous les prochaines étapes pour confirmer votre réservation.
              </p>

              <div style="margin:0 0 16px;padding:14px;border:1px solid #dbe5ea;border-radius:12px;background:#f8fbfd;">
                <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0b3a53;">Récapitulatif de votre demande</p>
                <table style="width:100%;border-collapse:collapse;font-size:13px;color:#334155;">
                  <tr><td style="padding:4px 0;width:42%;font-weight:600;">Réservation</td><td style="padding:4px 0;">#${reservationId} · ${reservationLabel}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;">Destination</td><td style="padding:4px 0;">${destinationLabel}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;">Embarquement</td><td style="padding:4px 0;">${embarkDate}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;">Débarquement</td><td style="padding:4px 0;">${disembarkDate}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;">Passagers</td><td style="padding:4px 0;">${Number(r.nbPersonnes || 0)} personne(s)</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;">Montant total</td><td style="padding:4px 0;font-weight:700;color:#0b3a53;">${totalTtc}</td></tr>
                </table>
              </div>

              ${
                signUrl
                  ? `<p style="margin:0 0 14px;color:#334155;font-size:14px;">Étape 1 : merci de signer votre contrat via le lien sécurisé ci-dessous.</p>
                     <p style="margin:0 0 16px;">
                       <a href="${signUrl}" style="display:inline-block;background:#00384a;color:#ffffff;text-decoration:none;padding:11px 16px;border-radius:9px;font-weight:700;">Signer le contrat</a>
                     </p>`
                  : `<div style="margin:0 0 16px;padding:14px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
                       <p style="margin:0;">${contractUrl ? `<a href="${contractUrl}" style="color:#0b3a53;font-weight:700;text-decoration:none;">Télécharger la proposition (devis + contrat PDF)</a>` : "Proposition PDF indisponible"}</p>
                     </div>`
              }

              ${
                !isDayTrip
                  ? `<p style="margin:0 0 10px;color:#334155;font-size:14px;">Étape 2 : règlement de l’acompte (20%) pour confirmer définitivement votre réservation.</p>
                     <p style="margin:0 0 16px;">
                       ${
                         paymentUrl
                           ? `<a href="${paymentUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:11px 16px;border-radius:9px;font-weight:700;">Régler l'acompte (20%)</a>`
                           : `<span style="color:#64748b;">Lien de paiement indisponible.</span>`
                       }
                     </p>`
                  : `<p style="margin:0 0 16px;color:#334155;font-size:14px;">Règlement sortie journée : acompte de 20 % à la réservation, solde au plus tard 1 semaine avant l'embarquement, par virement (IBAN sur le devis).</p>`
              }

              <p style="margin:0;color:#334155;font-size:14px;">Si vous avez la moindre question, répondez simplement à ce message.</p>
            </div>
            <div style="padding:14px 24px;background:#f8fbfd;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
              Sabine Sailing · contact@3lyachting.com
            </div>
          </div>
        </div>
      `,
    });
    const accepted = Array.isArray((mailInfo as any)?.accepted) ? (mailInfo as any).accepted : [];
    const rejected = Array.isArray((mailInfo as any)?.rejected) ? (mailInfo as any).rejected : [];
    if (!accepted.length) {
      throw new Error(`Email non accepté par le serveur SMTP (rejected: ${rejected.join(", ") || "none"})`);
    }
    console.info("[Workflow][send-proposal-email] Email envoye", {
      reservationId,
      hasSignUrl: Boolean(signUrl),
      hasPaymentUrl: Boolean(paymentUrl),
      dayTrip: isDayTrip,
      accepted,
      rejected,
      messageId: (mailInfo as any)?.messageId || null,
    });

    return res.json({
      success: true,
      quoteUrl,
      contractUrl,
      paymentUrl,
      signUrl,
      dayTrip: isDayTrip,
      emailDebug: {
        accepted,
        rejected,
        messageId: (mailInfo as any)?.messageId || null,
        response: String((mailInfo as any)?.response || ""),
      },
    });
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

router.post("/esign/webhook", async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });
    const payload: any = req.body || {};
    const eventType = String(
      payload?.event_type ||
        payload?.eventType ||
        payload?.type ||
        payload?.event ||
        payload?.name ||
        "unknown"
    );
    const envelopeId = String(
      payload?.submission_id ||
        payload?.submissionId ||
        payload?.id ||
        payload?.data?.submission_id ||
        payload?.data?.submissionId ||
        payload?.data?.id ||
        payload?.submission?.id ||
        ""
    ).trim();

    if (!envelopeId) {
      return res.json({ success: true, ignored: true, reason: "missing-envelope-id" });
    }

    const matchingContracts = await db.select().from(contracts).where(eq(contracts.esignEnvelopeId, envelopeId)).limit(1);
    if (!matchingContracts.length) {
      return res.json({ success: true, ignored: true, reason: "contract-not-found" });
    }
    const contract = matchingContracts[0];

    await db.insert(esignEvents).values({
      contractId: contract.id,
      provider: "other",
      eventType,
      payload: JSON.stringify(payload),
    });

    const statusToken = String(
      payload?.status ||
        payload?.data?.status ||
        payload?.submission?.status ||
        payload?.data?.submission?.status ||
        ""
    ).toLowerCase();
    const isSignedEvent =
      /complete|completed|signed|done|finish/.test(eventType.toLowerCase()) ||
      /complete|completed|signed|done|finish/.test(statusToken);

    if (isSignedEvent) {
      await db
        .update(contracts)
        .set({ signedAt: new Date() })
        .where(eq(contracts.id, contract.id));

      const reservationList = await listReservationsByIdSafe(db, contract.reservationId);
      const reservation = reservationList[0];
      if (reservation) {
        await db
          .update(reservations)
          .set({
            workflowStatut: "contrat_signe",
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, reservation.id));

        await db.insert(reservationStatusHistory).values({
          reservationId: reservation.id,
          fromStatut: reservation.workflowStatut,
          toStatut: "contrat_signe",
          actorType: "system",
          note: `Contrat signé via webhook e-sign (${eventType}).`,
        });
      }
    }

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur webhook e-sign" });
  }
});

export default router;
