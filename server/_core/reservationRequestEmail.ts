import nodemailer from "nodemailer";

type ReservationRequestEmailInput = {
  reservationId?: number;
  nomClient: string;
  prenomClient?: string | null;
  emailClient: string;
  telClient?: string | null;
  nbPersonnes: number;
  destination: string;
  formuleLabel: string;
  typeLabel: string;
  dateDebut: Date | string;
  dateFin: Date | string;
  montantEuros: string;
  message?: string | null;
};

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || "").trim();
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const fromEmail = (process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER || "").trim();
  const toEmail = (process.env.CONTACT_TO_EMAIL || process.env.SMTP_USER || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  return { host, user, pass, fromEmail, toEmail, port, secure };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "—");
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

/**
 * Mail armateur à chaque demande publique. Retourne false si SMTP est absent
 * ou si l'envoi échoue, sans faire échouer la réservation.
 */
export async function sendNewReservationRequestEmail(input: ReservationRequestEmailInput): Promise<boolean> {
  const smtp = getSmtpConfig();
  if (!smtp.host || !smtp.user || !smtp.pass || !smtp.fromEmail || !smtp.toEmail) {
    console.error("[Reservations] SMTP incomplet — mail de nouvelle demande non envoyé", {
      reservationId: input.reservationId,
      hasHost: Boolean(smtp.host),
      hasUser: Boolean(smtp.user),
      hasPass: Boolean(smtp.pass),
      hasFrom: Boolean(smtp.fromEmail),
      hasTo: Boolean(smtp.toEmail),
    });
    return false;
  }

  const fullName = [input.prenomClient, input.nomClient].filter(Boolean).join(" ").trim() || input.nomClient;
  const phone = (input.telClient || "").trim() || "Non fourni";
  const note = (input.message || "").trim() || "Aucun message";
  const dossier = input.reservationId ? `#${input.reservationId}` : "—";
  const adminUrl = (process.env.PUBLIC_BASE_URL || "https://sabine-sailing.com").replace(/\/+$/, "");

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  const subject = `Nouvelle demande de réservation — ${fullName}`;
  const text = [
    `Nouvelle demande de réservation ${dossier}`,
    "",
    `Client : ${fullName}`,
    `Email : ${input.emailClient}`,
    `Téléphone : ${phone}`,
    `Personnes : ${input.nbPersonnes}`,
    "",
    `Destination : ${input.destination}`,
    `Formule : ${input.formuleLabel}`,
    `Type : ${input.typeLabel}`,
    `Du : ${formatDate(input.dateDebut)}`,
    `Au : ${formatDate(input.dateFin)}`,
    `Montant estimé : ${input.montantEuros} €`,
    "",
    "Message :",
    note,
    "",
    `Backoffice : ${adminUrl}/admin`,
  ].join("\n");

  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:22px;color:#00384A;">Nouvelle demande de réservation</h1>
      <p style="margin:0 0 16px;color:#64748b;">Dossier ${escapeHtml(dossier)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#64748b;">Client</td><td style="padding:6px 0;text-align:right;font-weight:700;">${escapeHtml(fullName)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Email</td><td style="padding:6px 0;text-align:right;"><a href="mailto:${escapeHtml(input.emailClient)}">${escapeHtml(input.emailClient)}</a></td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Téléphone</td><td style="padding:6px 0;text-align:right;">${escapeHtml(phone)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Personnes</td><td style="padding:6px 0;text-align:right;">${input.nbPersonnes}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Destination</td><td style="padding:6px 0;text-align:right;">${escapeHtml(input.destination)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Formule</td><td style="padding:6px 0;text-align:right;">${escapeHtml(input.formuleLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Type</td><td style="padding:6px 0;text-align:right;">${escapeHtml(input.typeLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Du</td><td style="padding:6px 0;text-align:right;">${escapeHtml(formatDate(input.dateDebut))}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Au</td><td style="padding:6px 0;text-align:right;">${escapeHtml(formatDate(input.dateFin))}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Montant estimé</td><td style="padding:6px 0;text-align:right;font-weight:700;">${escapeHtml(input.montantEuros)} €</td></tr>
      </table>
      <p style="margin-top:18px;"><strong>Message</strong><br/>${escapeHtml(note).replace(/\n/g, "<br/>")}</p>
      <p style="margin-top:24px;">
        <a href="${escapeHtml(adminUrl)}/admin" style="display:inline-block;background:#00384A;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Ouvrir le backoffice</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Sabine Sailing" <${smtp.fromEmail}>`,
    to: smtp.toEmail,
    replyTo: input.emailClient,
    subject,
    text,
    html,
  });

  console.info("[Reservations] Mail nouvelle demande envoyé", {
    reservationId: input.reservationId,
    to: smtp.toEmail,
  });
  return true;
}
