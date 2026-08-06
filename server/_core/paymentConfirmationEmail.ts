import nodemailer from "nodemailer";
import type { Reservation } from "../../drizzle/schema";

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || "").trim();
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const fromEmail = (process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER || "").trim();
  const toAdmin = (process.env.CONTACT_TO_EMAIL || process.env.SMTP_USER || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  return { host, user, pass, fromEmail, toAdmin, port, secure };
}

const euro = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateFr = (value: Date | string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

/**
 * Email de confirmation client (+ copie armateur) après paiement Mollie réussi.
 * Retourne false si SMTP indisponible ou email client manquant (sans throw).
 */
export async function sendPaymentConfirmationEmail(
  reservation: Reservation,
  amountPaidCents: number,
): Promise<boolean> {
  const smtp = getSmtpConfig();
  const clientEmail = String(reservation.emailClient || "").trim();
  if (!smtp.host || !smtp.user || !smtp.pass || !smtp.fromEmail || !clientEmail) {
    console.warn("[paymentConfirmation] SMTP ou email client manquant — email non envoyé", {
      reservationId: reservation.id,
      hasClientEmail: Boolean(clientEmail),
    });
    return false;
  }

  const fullName =
    `${String(reservation.prenomClient || "").trim()} ${String(reservation.nomClient || "").trim()}`.trim() ||
    String(reservation.nomClient || "Client");
  const amountLabel = `${euro(amountPaidCents)} €`;
  const period =
    dateFr(reservation.dateDebut) === dateFr(reservation.dateFin)
      ? dateFr(reservation.dateDebut)
      : `${dateFr(reservation.dateDebut)} → ${dateFr(reservation.dateFin)}`;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  const subject = `Confirmation de paiement — réservation #${reservation.id}`;
  const text = [
    `Bonjour ${fullName},`,
    "",
    "Nous confirmons la bonne réception de votre paiement.",
    "",
    `Dossier : #${reservation.id}`,
    `Montant reçu : ${amountLabel}`,
    `Destination : ${reservation.destination || "—"}`,
    `Période : ${period}`,
    "",
    "Votre place / prestation est bien enregistrée. Notre équipe vous recontacte si besoin pour la suite du dossier.",
    "",
    "Vous pouvez aussi suivre votre dossier depuis l'espace client : https://sabine-sailing.com/espace-client",
    "",
    "À bientôt à bord,",
    "Sabine Sailing — 3L Yachting",
  ].join("\n");

  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:22px;color:#00384A;">Paiement confirmé</h1>
      <p>Bonjour <strong>${fullName}</strong>,</p>
      <p>Nous confirmons la bonne réception de votre paiement.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#64748b;">Dossier</td><td style="padding:8px 0;text-align:right;font-weight:700;">#${reservation.id}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Montant reçu</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#15803d;">${amountLabel}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Destination</td><td style="padding:8px 0;text-align:right;">${reservation.destination || "—"}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Période</td><td style="padding:8px 0;text-align:right;">${period}</td></tr>
      </table>
      <p style="font-size:14px;color:#334155;">Votre place / prestation est bien enregistrée. Notre équipe vous recontacte si besoin pour la suite du dossier.</p>
      <p style="margin-top:24px;">
        <a href="https://sabine-sailing.com/espace-client" style="display:inline-block;background:#00384A;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Voir mon espace client</a>
      </p>
      <p style="margin-top:28px;font-size:13px;color:#64748b;">Sabine Sailing — 3L Yachting</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Sabine Sailing" <${smtp.fromEmail}>`,
    to: clientEmail,
    bcc: smtp.toAdmin && smtp.toAdmin !== clientEmail ? smtp.toAdmin : undefined,
    subject,
    text,
    html,
  });

  console.info("[paymentConfirmation] Email envoyé", {
    reservationId: reservation.id,
    to: clientEmail,
    amountPaidCents,
  });
  return true;
}
