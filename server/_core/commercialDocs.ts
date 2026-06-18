import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Reservation } from "../../drizzle/schema";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const COMPANY = {
  legalName: "SAS 3L Yachting",
  siret: "99130386800012",
  tva: "FR62991303868",
  address: "130 Traverse Haute Bertrandiere, 13600 La Ciotat, FR",
  email: "contact@3lyachting.com",
};

const BANK_DETAILS = {
  accountName: "3L yachting",
  iban: "FR76 1695 8000 0129 3037 2555 023",
  bic: "QNTOFRP1XXX",
  partnerSwift: "TRWIBEB3XXX",
};

const euro = (cents: number) =>
  (cents / 100)
    .toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ");
const dateFr = (value: Date | string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

const sanitizePdfText = (input: string) =>
  input
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7EÀ-ÿ]/g, "");

function resolveLogoPath(): string | null {
  const custom = process.env.QUOTE_LOGO_PATH;
  const candidates = [
    custom,
    path.resolve(process.cwd(), "client", "public", "logo-sabine.png"),
    path.resolve(process.cwd(), "public", "logo-sabine.png"),
    path.resolve(process.cwd(), "logo-sabine.png"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function embedImageByPath(doc: PDFDocument, imgPath: string) {
  const bytes = readFileSync(imgPath);
  const lower = imgPath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return await doc.embedJpg(bytes);
  }
  return await doc.embedPng(bytes);
}

function resolveQuoteBoatBgPath(): string | null {
  const custom = process.env.QUOTE_BG_BOAT_PATH;
  const candidates = [
    custom,
    path.resolve(process.cwd(), "client", "public", "docs", "boat-bg.png"),
    path.resolve(process.cwd(), "client", "public", "docs", "devis-boat-bg.png"),
    "C:\\Users\\vleyd\\.cursor\\projects\\c-Users-vleyd-Desktop-catamaran-croisieres-22042026\\assets\\c__Users_vleyd_AppData_Roaming_Cursor_User_workspaceStorage_3ea31a7bc3a0390ead66e6911168ba79_images_noir_sans_fond-90096d3c-0aa4-4e07-853f-d2085ba8d522.png",
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function resolveContractTemplatePath(): string | null {
  const raw = process.env.CONTRACT_TEMPLATE_PATH || "";
  const normalizedCustom = raw.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  const customWithPdf = normalizedCustom && !normalizedCustom.toLowerCase().endsWith(".pdf") ? `${normalizedCustom}.pdf` : normalizedCustom;
  const candidates = [
    normalizedCustom,
    customWithPdf,
    path.resolve(process.cwd(), "client", "public", "docs", "contrat-template.pdf"),
    path.resolve(process.cwd(), "client", "public", "docs", "contrat_modele.pdf"),
    path.resolve(process.cwd(), "client", "public", "docs", "modele-contrat.pdf"),
    path.resolve(process.cwd(), "client", "public", "docs", "contrat-charter-v2.pdf"),
    path.resolve(process.cwd(), "public", "docs", "contrat-template.pdf"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export const DAY_TRIP_EMBARK_HOUR = "10:00";
export const DAY_TRIP_DISEMBARK_HOUR = "16:00";
export const DAY_TRIP_DURATION_HOURS = 6;
export const SUNSET_EMBARK_HOUR = "18:30";
export const SUNSET_DISEMBARK_HOUR = "22:00";
export const SUNSET_DURATION_HOURS = 3.5;
export const DAY_TRIP_ACOMPTE_PERCENT = 20;
export const DAY_TRIP_SOLDE_DAYS_BEFORE_EMBARK = 7;

export function isSunsetReservation(r: Reservation): boolean {
  const formule = String(r.formule || "").toLowerCase();
  const destination = String(r.destination || "").toLowerCase();
  return (
    formule.includes("soiree") ||
    formule.includes("soirée") ||
    destination.includes("soiree") ||
    destination.includes("soirée") ||
    destination.includes("coucher") ||
    destination.includes("sunset")
  );
}

export function isDayTripReservation(r: Reservation): boolean {
  if (isSunsetReservation(r)) return false;
  const formule = String(r.formule || "").toLowerCase();
  const destination = String(r.destination || "").toLowerCase();
  const sameDay = dateFr(r.dateDebut) === dateFr(r.dateFin);
  return formule.includes("journee") || formule.includes("journ") || destination.includes("journee") || sameDay;
}

export function isShortCharterReservation(r: Reservation): boolean {
  return isDayTripReservation(r) || isSunsetReservation(r);
}

export function getReservationCharterHours(r: Reservation): {
  embark: string;
  disembark: string;
  durationHours: number;
} {
  if (isSunsetReservation(r)) {
    return {
      embark: SUNSET_EMBARK_HOUR,
      disembark: SUNSET_DISEMBARK_HOUR,
      durationHours: SUNSET_DURATION_HOURS,
    };
  }
  if (isDayTripReservation(r)) {
    return {
      embark: DAY_TRIP_EMBARK_HOUR,
      disembark: DAY_TRIP_DISEMBARK_HOUR,
      durationHours: DAY_TRIP_DURATION_HOURS,
    };
  }
  return { embark: "15:00", disembark: "10:00", durationHours: 0 };
}

export function computeReservationPaymentSchedule(r: Reservation) {
  const acomptePercent = DAY_TRIP_ACOMPTE_PERCENT;
  const acompteMontant = Math.round((r.montantTotal * acomptePercent) / 100);
  const soldeMontant = Math.max(0, r.montantTotal - acompteMontant);
  const soldeEcheanceAt = new Date(r.dateDebut);
  const soldeLeadDays = isShortCharterReservation(r) ? DAY_TRIP_SOLDE_DAYS_BEFORE_EMBARK : 45;
  soldeEcheanceAt.setUTCDate(soldeEcheanceAt.getUTCDate() - soldeLeadDays);
  return { acomptePercent, acompteMontant, soldeMontant, soldeEcheanceAt };
}

function resolveDayContractTemplatePath(): string | null {
  const raw = process.env.CONTRACT_TEMPLATE_DAY_PATH || "";
  const normalizedCustom = raw.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  const customWithPdf =
    normalizedCustom && !normalizedCustom.toLowerCase().endsWith(".pdf") ? `${normalizedCustom}.pdf` : normalizedCustom;
  const candidates = [
    normalizedCustom,
    customWithPdf,
    path.resolve(process.cwd(), "public", "docs", "day charter template.pdf"),
    path.resolve(process.cwd(), "public", "docs", "day-charter-template.pdf"),
    path.resolve(process.cwd(), "dist", "public", "docs", "day charter template.pdf"),
    path.resolve(process.cwd(), "dist", "public", "docs", "day-charter-template.pdf"),
    path.resolve(process.cwd(), "..", "public", "docs", "day charter template.pdf"),
    path.resolve(process.cwd(), "..", "public", "docs", "day-charter-template.pdf"),
    path.resolve(process.cwd(), "..", "dist", "public", "docs", "day charter template.pdf"),
    path.resolve(process.cwd(), "..", "dist", "public", "docs", "day-charter-template.pdf"),
    path.resolve(process.cwd(), "client", "public", "docs", "day charter template.pdf"),
    path.resolve(process.cwd(), "client", "public", "docs", "day-charter-template.pdf"),
    path.resolve(process.cwd(), "dist", "public", "docs", "contrat-journee.pdf"),
    path.resolve(process.cwd(), "dist", "public", "docs", "contrat-journee-template.pdf"),
    path.resolve(process.cwd(), "dist", "public", "docs", "contrat-journee-modele.pdf"),
    path.resolve(process.cwd(), "client", "public", "docs", "contrat-journee.pdf"),
    path.resolve(process.cwd(), "client", "public", "docs", "contrat-journee-template.pdf"),
    path.resolve(process.cwd(), "client", "public", "docs", "contrat-journee-modele.pdf"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function formatFrDateTime(value: Date | string | null | undefined, fallbackHour = "00:00") {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hasExplicitTime =
    (typeof value === "string" && /t\d{2}:\d{2}/i.test(value) && !/t00:00(:00)?(\.000)?z?$/i.test(value)) ||
    d.getUTCHours() !== 0 ||
    d.getUTCMinutes() !== 0 ||
    d.getUTCSeconds() !== 0;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const time = hasExplicitTime ? `${hh}:${mm}` : fallbackHour;
  return `${date} a ${time}`;
}

function formatHour(value: Date | string | null | undefined, fallbackHour = "00:00") {
  if (!value) return fallbackHour;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallbackHour;
  const hasExplicitTime =
    (typeof value === "string" && /t\d{2}:\d{2}/i.test(value) && !/t00:00(:00)?(\.000)?z?$/i.test(value)) ||
    d.getUTCHours() !== 0 ||
    d.getUTCMinutes() !== 0 ||
    d.getUTCSeconds() !== 0;
  if (!hasExplicitTime) return fallbackHour;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function renderPdf(title: string, lines: string[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 810;
  page.drawText(title, { x: 40, y, font: bold, size: 16, color: rgb(0.1, 0.1, 0.1) });
  y -= 24;

  for (const line of lines) {
    const safeLine = sanitizePdfText(line);
    const chunks = safeLine.length > 110 ? [safeLine.slice(0, 110), safeLine.slice(110)] : [safeLine];
    for (const c of chunks) {
      if (y < 50) break;
      page.drawText(c, { x: 40, y, font, size: 10, color: rgb(0.12, 0.12, 0.12) });
      y -= 14;
    }
    if (y < 50) break;
  }

  return await doc.save();
}

export async function buildQuotePdf(r: Reservation, quoteNumber: string, optionExpiresAt?: Date) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Filigrane bateau en fond (discret)
  try {
    const boatBgPath = resolveQuoteBoatBgPath();
    if (boatBgPath) {
      const boatImage = await embedImageByPath(doc, boatBgPath);
      const maxWidth = 470;
      const scale = Math.min(maxWidth / boatImage.width, 500 / boatImage.height);
      const dims = boatImage.scale(scale);
      page.drawImage(boatImage, {
        x: (595 - dims.width) / 2,
        y: 150,
        width: dims.width,
        height: dims.height,
        opacity: 0.12,
      });
    }
  } catch (error) {
    console.warn("[QuotePDF] Fond bateau non chargé:", (error as any)?.message || error);
  }

  const drawLabelValue = (y: number, label: string, value: string) => {
    page.drawText(sanitizePdfText(label), { x: 44, y, font: bold, size: 10, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(sanitizePdfText(value), { x: 170, y, font, size: 10, color: rgb(0.15, 0.15, 0.15) });
  };

  const totalTtc = r.montantTotal;
  const totalHt = Math.round(totalTtc / 1.1);
  const tva = totalTtc - totalHt;
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 15);
  const optionUntil = optionExpiresAt || (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  })();
  const isPrivate = r.typeReservation === "bateau_entier";
  const isShortCharter = isShortCharterReservation(r);
  const charterHours = getReservationCharterHours(r);
  const paymentSchedule = computeReservationPaymentSchedule(r);

  // Header
  page.drawRectangle({ x: 0, y: 780, width: 595, height: 62, color: rgb(0.1, 0.2, 0.36) });
  try {
    const logoPath = resolveLogoPath();
    if (!logoPath) throw new Error("Logo introuvable");
    const logoImage = await embedImageByPath(doc, logoPath);
    const maxLogoWidth = 150;
    const maxLogoHeight = 52;
    const logoScale = Math.min(maxLogoWidth / logoImage.width, maxLogoHeight / logoImage.height);
    const logoDims = logoImage.scale(logoScale);
    page.drawImage(logoImage, {
      x: 555 - logoDims.width,
      y: 780 + (62 - logoDims.height) / 2,
      width: logoDims.width,
      height: logoDims.height,
      opacity: 1,
    });
  } catch (error) {
    console.warn("[QuotePDF] Logo non chargé:", (error as any)?.message || error);
  }
  page.drawText("DEVIS", { x: 44, y: 812, font: bold, size: 24, color: rgb(1, 1, 1) });
  page.drawText(sanitizePdfText(quoteNumber), { x: 44, y: 792, font, size: 11, color: rgb(0.9, 0.95, 1) });
  page.drawText(sanitizePdfText(COMPANY.legalName), { x: 360, y: 812, font: bold, size: 11, color: rgb(1, 1, 1) });
  page.drawText(sanitizePdfText(COMPANY.address), { x: 360, y: 797, font, size: 8.5, color: rgb(0.9, 0.95, 1) });
  page.drawText(`SIRET ${COMPANY.siret} | TVA ${COMPANY.tva}`, { x: 360, y: 784, font, size: 8.5, color: rgb(0.9, 0.95, 1) });

  // Meta line
  page.drawText(`Emission: ${dateFr(new Date())}`, { x: 44, y: 760, font, size: 9.5, color: rgb(0.25, 0.25, 0.25) });
  page.drawText(`Expiration: ${dateFr(expiresAt)}`, { x: 180, y: 760, font, size: 9.5, color: rgb(0.25, 0.25, 0.25) });

  // Client block
  page.drawRectangle({ x: 40, y: 640, width: 515, height: 105, borderColor: rgb(0.83, 0.85, 0.9), borderWidth: 1 });
  page.drawText("CLIENT", { x: 44, y: 730, font: bold, size: 11, color: rgb(0.1, 0.2, 0.36) });
  drawLabelValue(712, "Nom", r.nomClient);
  drawLabelValue(696, "Email", r.emailClient);
  drawLabelValue(680, "Telephone", r.telClient || "-");
  drawLabelValue(664, "Destination", r.destination);

  // Prestation block
  page.drawRectangle({ x: 40, y: 560, width: 515, height: 70, borderColor: rgb(0.83, 0.85, 0.9), borderWidth: 1 });
  page.drawText("PRESTATION", { x: 44, y: 614, font: bold, size: 11, color: rgb(0.1, 0.2, 0.36) });
  drawLabelValue(596, "Formule", r.formule);
  drawLabelValue(
    580,
    "Periode",
    isShortCharter
      ? `${dateFr(r.dateDebut)} · ${formatHour(r.dateDebut, charterHours.embark)} - ${formatHour(r.dateFin, charterHours.disembark)}`
      : `${dateFr(r.dateDebut)} au ${dateFr(r.dateFin)}`,
  );
  drawLabelValue(564, "Blocage", `Option 7 jours (jusqu'au ${dateFr(optionUntil)})`);

  // Price table
  page.drawRectangle({ x: 40, y: 430, width: 515, height: 115, borderColor: rgb(0.83, 0.85, 0.9), borderWidth: 1 });
  page.drawText("DETAIL PRIX", { x: 44, y: 528, font: bold, size: 11, color: rgb(0.1, 0.2, 0.36) });
  page.drawText("Montant HT", { x: 44, y: 505, font, size: 10, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`${euro(totalHt)} EUR`, { x: 450, y: 505, font: bold, size: 10, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("TVA (10%)", { x: 44, y: 486, font, size: 10, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`${euro(tva)} EUR`, { x: 450, y: 486, font: bold, size: 10, color: rgb(0.2, 0.2, 0.2) });
  page.drawLine({ start: { x: 44, y: 472 }, end: { x: 550, y: 472 }, thickness: 1, color: rgb(0.86, 0.88, 0.92) });
  page.drawText("TOTAL TTC", { x: 44, y: 452, font: bold, size: 12, color: rgb(0.1, 0.2, 0.36) });
  page.drawText(`${euro(totalTtc)} EUR`, { x: 430, y: 452, font: bold, size: 14, color: rgb(0.1, 0.2, 0.36) });

  // Payment terms block
  page.drawRectangle({ x: 40, y: 290, width: 515, height: 125, borderColor: rgb(0.83, 0.85, 0.9), borderWidth: 1 });
  page.drawText("CONDITIONS DE PAIEMENT", { x: 44, y: 398, font: bold, size: 11, color: rgb(0.1, 0.2, 0.36) });
  if (isShortCharter) {
    page.drawText(`- Acompte ${DAY_TRIP_ACOMPTE_PERCENT} % a la reservation`, {
      x: 44,
      y: 378,
      font,
      size: 10,
      color: rgb(0.15, 0.15, 0.15),
    });
    page.drawText(`- Solde ${euro(paymentSchedule.soldeMontant)} EUR au plus tard 1 semaine avant embarquement`, {
      x: 44,
      y: 362,
      font,
      size: 10,
      color: rgb(0.15, 0.15, 0.15),
    });
  } else {
    page.drawText(isPrivate ? "- Acompte 10 % a la reservation" : "- Acompte 20 % a la reservation", {
      x: 44,
      y: 378,
      font,
      size: 10,
      color: rgb(0.15, 0.15, 0.15),
    });
    page.drawText(isPrivate ? "- Solde 60 jours avant depart" : "- Solde 45 jours avant depart", {
      x: 44,
      y: 362,
      font,
      size: 10,
      color: rgb(0.15, 0.15, 0.15),
    });
  }
  page.drawText("Reglement par virement bancaire", { x: 44, y: 343, font: bold, size: 10, color: rgb(0.15, 0.15, 0.15) });
  page.drawText(`Titulaire: ${BANK_DETAILS.accountName}`, { x: 44, y: 327, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`IBAN ${BANK_DETAILS.iban}`, { x: 44, y: 313, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`BIC ${BANK_DETAILS.bic} (banque partenaire SWIFT ${BANK_DETAILS.partnerSwift})`, {
    x: 44,
    y: 299,
    font,
    size: 9.5,
    color: rgb(0.2, 0.2, 0.2),
  });

  // Inclusions / exclusions block (as in charter contract, depends on mode)
  page.drawRectangle({ x: 40, y: 150, width: 515, height: 130, borderColor: rgb(0.83, 0.85, 0.9), borderWidth: 1 });
  page.drawText("RAPPEL INCLUS / NON INCLUS", { x: 44, y: 262, font: bold, size: 11, color: rgb(0.1, 0.2, 0.36) });
  if (isShortCharter) {
    page.drawText("Inclus:", { x: 44, y: 244, font: bold, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Mise a disposition privee du navire avec equipage professionnel.", { x: 95, y: 244, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Carburant pour navigation normale locale.", { x: 95, y: 230, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Assurance du navire, materiel loisirs (2 paddles, 1 kayak, snorkeling).", { x: 95, y: 216, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("Non inclus:", { x: 44, y: 198, font: bold, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Repas / boissons, transferts terrestres, prestations traiteur.", { x: 110, y: 198, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Options: 2 scooters sous-marins, moteur electrique paddle, bouee tractee.", { x: 110, y: 184, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
  } else if (isPrivate) {
    page.drawText("Inclus:", { x: 44, y: 244, font: bold, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Mise a disposition exclusive du navire avec equipage professionnel.", { x: 95, y: 244, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Hebergement a bord selon capacite autorisee, 2 paddles et 1 kayak.", { x: 95, y: 230, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("Non inclus:", { x: 44, y: 212, font: bold, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Carburant, avitaillement alimentaire et boissons (caisse de bord).", { x: 110, y: 212, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Options: 2 scooters sous-marins, 1 moteur electrique paddle, bouee tractee.", { x: 110, y: 198, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
  } else {
    page.drawText("Inclus:", { x: 44, y: 244, font: bold, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Hebergement en cabine, equipage, pension complete.", { x: 95, y: 244, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Boissons de base pendant les repas, carburant programme standard.", { x: 95, y: 230, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Materiel de loisirs: snorkeling, 2 paddles, 1 kayak.", { x: 95, y: 216, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("Non inclus:", { x: 44, y: 198, font: bold, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Transport vers/depuis le port, depenses a terre, assurances personnelles.", { x: 110, y: 198, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("- Options: 2 scooters sous-marins, 1 moteur electrique paddle, bouee tractee.", { x: 110, y: 184, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
  }

  // Footer validation block
  page.drawLine({ start: { x: 40, y: 92 }, end: { x: 555, y: 92 }, thickness: 1, color: rgb(0.86, 0.88, 0.92) });
  page.drawText("BON POUR ACCORD CLIENT", { x: 44, y: 74, font: bold, size: 10.5, color: rgb(0.12, 0.12, 0.12) });
  page.drawText("Lieu: La Ciotat", { x: 44, y: 58, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("Date: ____ / ____ / ________", { x: 170, y: 58, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("Signature client: ________________________________", { x: 320, y: 58, font, size: 9.5, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("Signature armateur: SAS 3L Yachting", { x: 44, y: 43, font: bold, size: 9, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`Date: ${dateFr(new Date())}`, { x: 230, y: 43, font, size: 9, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("SAS 3L Yachting - contact@3lyachting.com", { x: 44, y: 24, font, size: 8.5, color: rgb(0.45, 0.45, 0.45) });

  return await doc.save();
}

export async function buildContractPdf(r: Reservation, contractNumber: string) {
  const isShortCharter = isShortCharterReservation(r);
  const charterHours = getReservationCharterHours(r);
  const dayTemplatePath = isShortCharter ? resolveDayContractTemplatePath() : null;
  const weekTemplatePath = resolveContractTemplatePath();
  const templatePath = isShortCharter ? dayTemplatePath : weekTemplatePath;
  if (!templatePath) {
    if (isShortCharter) {
      throw new Error(
        "[DAY_CONTRACT_TEMPLATE_REQUIRED] Modèle contrat journée introuvable. Ajoutez CONTRACT_TEMPLATE_DAY_PATH ou placez day-charter-template.pdf dans public/docs ou dist/public/docs.",
      );
    }
    throw new Error(
      "[CONTRACT_TEMPLATE_REQUIRED] Modèle contrat introuvable. Ajoutez CONTRACT_TEMPLATE_PATH dans .env vers votre PDF modèle.",
    );
  }

  const templateDoc = await PDFDocument.load(readFileSync(templatePath));
  const pages = templateDoc.getPages();
  const font = await templateDoc.embedFont(StandardFonts.Helvetica);
  const bold = await templateDoc.embedFont(StandardFonts.HelveticaBold);
  const firstPage = pages[0];
  const firstSize = firstPage.getSize();
  const isPrivate = r.typeReservation === "bateau_entier";
  const [firstNameRaw, ...lastNameParts] = String(r.nomClient || "").trim().split(/\s+/);
  const firstName = firstNameRaw || "-";
  const lastName = lastNameParts.join(" ") || "-";
  const drawField = (label: string, value: string, y: number) => {
    firstPage.drawText(`${sanitizePdfText(label)}:`, {
      x: 42,
      y,
      font: bold,
      size: 9,
      color: rgb(0.1, 0.1, 0.1),
    });
    firstPage.drawText(sanitizePdfText(value), {
      x: 178,
      y,
      font,
      size: 9,
      color: rgb(0.1, 0.1, 0.1),
    });
  };

  if (isShortCharter) {
    const datePrestation = dateFr(r.dateDebut) || "-";
    const embarkHour = formatHour(r.dateDebut, charterHours.embark);
    const disembarkHour = formatHour(r.dateFin, charterHours.disembark);
    const durationHours = charterHours.durationHours;
    const totalTtc = `${euro(r.montantTotal)} EUR`;
    const { acompteMontant, soldeMontant } = computeReservationPaymentSchedule(r);
    const acompteText = `${euro(acompteMontant)} EUR`;
    const soldeText = `${euro(soldeMontant)} EUR`;
    const todayDate = dateFr(new Date()) || "-";
    const fullName = sanitizePdfText(String(r.nomClient || "-"));
    const addressLine = sanitizePdfText(String(r.destination || "A completer"));
    const phone = sanitizePdfText(String(r.telClient || "-"));
    const email = sanitizePdfText(String(r.emailClient || "-"));
    const embarkDateTime = `${datePrestation} a ${embarkHour}`;
    const disembarkDateTime = `${datePrestation} a ${disembarkHour}`;

    // Mode "contrat journée" : remplir les lignes prévues dans le modèle.
    const page1 = pages[0];
    const page5 = pages[4] || pages[pages.length - 1];
    const textColor = rgb(0.08, 0.08, 0.08);
    const drawAt = (
      page: any,
      value: string,
      x: number,
      y: number,
      size = 10,
      useBold = false
    ) => {
      page.drawText(sanitizePdfText(value), {
        x,
        y,
        font: useBold ? bold : font,
        size,
        color: textColor,
      });
    };

    // Page 1 - Encadré d'informations (toutes les données de réservation).
    const leftX = 72;
    const valueX = 245;
    let y = 455;
    const rowGap = 20;
    const drawRow = (label: string, value: string) => {
      drawAt(page1, `${label}:`, leftX, y, 10, true);
      drawAt(page1, value, valueX, y, 10, false);
      y -= rowGap;
    };
    drawAt(page1, `Reference dossier: ${contractNumber}`, leftX, y + 18, 9, false);
    drawRow("Nom et prenom", fullName);
    drawRow("Telephone", phone);
    drawRow("Email", email);
    drawRow("Port / zone", "La Ciotat");
    drawRow("Destination", addressLine);
    drawRow("Embarquement", embarkDateTime);
    drawRow("Debarquement", disembarkDateTime);
    drawRow("Duree estimee", `${durationHours} h`);
    drawRow("Carburant", "Inclus (navigation locale)");
    drawRow("Tarif total TTC", totalTtc);
    drawRow(`Acompte (${DAY_TRIP_ACOMPTE_PERCENT}%)`, acompteText);
    drawRow("Solde (1 sem. avant embarq.)", soldeText);
    drawRow("Reglement", `Virement - IBAN ${BANK_DETAILS.iban}`);

    // Page 5 - Signatures
    drawAt(page5, "La Ciotat", 95, 214);
    drawAt(page5, todayDate, 95, 194);
    drawAt(page5, fullName, 90, 154);
    drawAt(page5, "SAS 3L Yachting", 365, 150, 10, true);

    return await templateDoc.save();
  }

  // Surcouche auto-remplie depuis la reservation.
  const topY = Math.max(540, firstSize.height - 170);
  firstPage.drawRectangle({
    x: 36,
    y: topY - 132,
    width: Math.min(523, firstSize.width - 72),
    height: 142,
    color: rgb(1, 1, 1),
    opacity: 0.88,
  });
  firstPage.drawText("INFORMATIONS RENSEIGNEES AUTOMATIQUEMENT", {
    x: 42,
    y: topY - 14,
    font: bold,
    size: 10,
    color: rgb(0.1, 0.1, 0.1),
  });
  drawField("Reference dossier", contractNumber, topY - 30);
  drawField("Nom", lastName, topY - 44);
  drawField("Prenom", firstName, topY - 58);
  drawField("Telephone", r.telClient || "-", topY - 72);
  drawField("Email", r.emailClient || "-", topY - 86);
  drawField("Navire", "Catamaran Sabine", topY - 100);
  drawField("Destination", r.destination || "-", topY - 114);
  const embarkDefaultHour = charterHours.embark;
  const disembarkDefaultHour = charterHours.disembark;
  drawField("Date d'embarquement", formatFrDateTime(r.dateDebut, embarkDefaultHour), topY - 128);
  drawField("Date de debarquement", formatFrDateTime(r.dateFin, disembarkDefaultHour), topY - 142);

  // Type de reservation coche automatiquement.
  firstPage.drawText(`Type: ${isPrivate ? "PRIVATISATION BATEAU ENTIER" : "CROISIERE A LA CABINE"}`, {
    x: 42,
    y: topY - 156,
    font: bold,
    size: 9,
    color: rgb(0.1, 0.1, 0.1),
  });
  firstPage.drawText(`${isPrivate ? "[X]" : "[ ]"} Privatisation`, {
    x: 330,
    y: topY - 114,
    font,
    size: 9,
    color: rgb(0.1, 0.1, 0.1),
  });
  firstPage.drawText(`${isPrivate ? "[ ]" : "[X]"} Cabine`, {
    x: 330,
    y: topY - 128,
    font,
    size: 9,
    color: rgb(0.1, 0.1, 0.1),
  });

  const lastPage = pages[pages.length - 1];
  const lastSize = lastPage.getSize();
  const today = dateFr(new Date());
  // Mettre periode + total juste sous la zone de signature client (plus visible).
  lastPage.drawText(
    `Periode: ${sanitizePdfText(dateFr(r.dateDebut))} au ${sanitizePdfText(dateFr(r.dateFin))}`,
    {
      x: 36,
      y: 96,
      font: bold,
      size: 9,
      color: rgb(0.12, 0.12, 0.12),
    },
  );
  lastPage.drawText(`Total: ${sanitizePdfText(euro(r.montantTotal))} EUR`, {
    x: 36,
    y: 82,
    font: bold,
    size: 9,
    color: rgb(0.12, 0.12, 0.12),
  });
  lastPage.drawText("Document genere depuis le modele contractuel client.", {
    x: 36,
    y: 12,
    font,
    size: 7.5,
    color: rgb(0.4, 0.4, 0.4),
  });
  lastPage.drawLine({
    start: { x: Math.max(36, lastSize.width - 240), y: 64 },
    end: { x: Math.max(160, lastSize.width - 40), y: 64 },
    thickness: 1,
    color: rgb(0.25, 0.25, 0.25),
  });
  lastPage.drawText("Signature armateur: SAS 3L Yachting", {
    x: Math.max(36, lastSize.width - 240),
    y: 68,
    font,
    size: 8,
    color: rgb(0.15, 0.15, 0.15),
  });
  lastPage.drawText(`Date: ${sanitizePdfText(today)}`, {
    x: Math.max(36, lastSize.width - 240),
    y: 54,
    font,
    size: 8,
    color: rgb(0.15, 0.15, 0.15),
  });
  return await templateDoc.save();
}

export async function buildQuoteContractPdf(
  r: Reservation,
  quoteNumber: string,
  contractNumber: string,
  optionExpiresAt?: Date
) {
  try {
    const quoteBytes = await buildQuotePdf(r, quoteNumber, optionExpiresAt);
    const contractBytes = await buildContractPdf(r, contractNumber);

    const merged = await PDFDocument.create();
    const quoteDoc = await PDFDocument.load(quoteBytes);
    const contractDoc = await PDFDocument.load(contractBytes);

    const quotePages = await merged.copyPages(quoteDoc, quoteDoc.getPageIndices());
    quotePages.forEach((p) => merged.addPage(p));

    const contractPages = await merged.copyPages(contractDoc, contractDoc.getPageIndices());
    contractPages.forEach((p) => merged.addPage(p));

    return await merged.save();
  } catch (error: any) {
    const message = String(error?.message || "");
    if (message.includes("[CONTRACT_TEMPLATE_REQUIRED]") || message.includes("[DAY_CONTRACT_TEMPLATE_REQUIRED]")) {
      throw error;
    }
    console.warn("[QuoteContractPDF] Fusion standard échouée, fallback activé:", (error as any)?.message || error);
    const lines = [
      "DOCUMENT COMMUN DEVIS + CONTRAT",
      "",
      `Devis: ${quoteNumber}`,
      `Contrat: ${contractNumber}`,
      `Client: ${r.nomClient} - ${r.emailClient}`,
      `Destination: ${r.destination}`,
      `Periode: ${dateFr(r.dateDebut)} au ${dateFr(r.dateFin)}`,
      `Montant total: ${euro(r.montantTotal)} EUR`,
      "",
      "Ce document fallback a ete genere automatiquement pour garantir la continuité du workflow commercial.",
      "Le devis et le contrat ont ete regroupes dans ce meme PDF.",
    ];
    return await renderPdf(`DEVIS + CONTRAT ${quoteNumber}`, lines);
  }
}

export async function buildInvoicePdf(
  r: Reservation,
  invoiceNumber: string,
  type: "acompte" | "solde",
  amount: number,
  dueAt: Date | null
) {
  const lines = [
    `Numero facture: ${invoiceNumber}`,
    `Date facture: ${dateFr(new Date())}`,
    "",
    `${COMPANY.legalName} - ${COMPANY.address}`,
    `Email: ${COMPANY.email} | SIRET: ${COMPANY.siret} | TVA: ${COMPANY.tva}`,
    "",
    `Client: ${r.nomClient} | ${r.emailClient}`,
    `Reservation: ${r.destination} du ${dateFr(r.dateDebut)} au ${dateFr(r.dateFin)}`,
    "",
    `Type: ${type === "acompte" ? "Acompte de reservation" : "Solde de reservation"}`,
    `Montant: ${euro(amount)} EUR`,
    `Echeance: ${dateFr(dueAt)}`,
    "",
    "Reglement par virement:",
    `Titulaire: ${BANK_DETAILS.accountName}`,
    `IBAN ${BANK_DETAILS.iban}`,
    `BIC ${BANK_DETAILS.bic} (banque partenaire SWIFT ${BANK_DETAILS.partnerSwift})`,
  ];

  return renderPdf(`FACTURE ${invoiceNumber}`, lines);
}
