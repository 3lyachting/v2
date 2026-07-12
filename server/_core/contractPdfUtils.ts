import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

export const CONTRACT_COMPANY = {
  legalName: "SAS 3L Yachting",
  siret: "99130386800012",
  tva: "FR62991303868",
  address: "130 Traverse Haute Bertrandiere, 13600 La Ciotat, FR",
  email: "contact@3lyachting.com",
  contactEmail: "contact@sabine-sailing.com",
};

export const CONTRACT_BANK_DETAILS = {
  iban: "FR76 1695 8000 0129 3037 2555 023",
};

export const euro = (cents: number) =>
  (cents / 100)
    .toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ");

export const dateEn = (value: Date | string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

export const sanitizePdfText = (input: string) =>
  input
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7E]/g, "");

export type PageWriter = {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
  pageIndex: number;
  totalPages: number;
};

export function drawHeader(writer: PageWriter) {
  const { page, font, bold, pageIndex, totalPages } = writer;
  page.drawText(sanitizePdfText(CONTRACT_COMPANY.legalName), {
    x: 40,
    y: 800,
    font: bold,
    size: 8.5,
    color: rgb(0.15, 0.15, 0.15),
  });
  page.drawText(
    sanitizePdfText(
      `SIRET ${CONTRACT_COMPANY.siret} - VAT ${CONTRACT_COMPANY.tva} - Catamaran Sabine - Passenger vessel NUC category 1`,
    ),
    { x: 40, y: 788, font, size: 7.5, color: rgb(0.35, 0.35, 0.35) },
  );
  page.drawText(sanitizePdfText(`Page ${pageIndex} of ${totalPages}`), {
    x: 480,
    y: 788,
    font,
    size: 7.5,
    color: rgb(0.35, 0.35, 0.35),
  });
  page.drawLine({ start: { x: 40, y: 782 }, end: { x: 555, y: 782 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  writer.y = 760;
}

export function wrapLine(text: string, maxChars = 105) {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function drawParagraph(writer: PageWriter, text: string, opts?: { bold?: boolean; size?: number; gap?: number }) {
  const size = opts?.size ?? 9.5;
  const gap = opts?.gap ?? 12;
  const useFont = opts?.bold ? writer.bold : writer.font;
  for (const line of wrapLine(text)) {
    if (writer.y < 56) break;
    writer.page.drawText(line, { x: 40, y: writer.y, font: useFont, size, color: rgb(0.12, 0.12, 0.12) });
    writer.y -= gap;
  }
}

export function drawBullet(writer: PageWriter, text: string) {
  drawParagraph(writer, `- ${text}`, { size: 9.2, gap: 11 });
}

export function drawTitle(writer: PageWriter, text: string) {
  writer.y -= 4;
  writer.page.drawText(sanitizePdfText(text), {
    x: 40,
    y: writer.y,
    font: writer.bold,
    size: 12,
    color: rgb(0.1, 0.2, 0.36),
  });
  writer.y -= 18;
}

export function drawSection(writer: PageWriter, text: string) {
  writer.y -= 6;
  writer.page.drawText(sanitizePdfText(text), {
    x: 40,
    y: writer.y,
    font: writer.bold,
    size: 10.5,
    color: rgb(0.12, 0.12, 0.12),
  });
  writer.y -= 14;
}

export function drawField(writer: PageWriter, label: string, value: string) {
  writer.page.drawText(sanitizePdfText(`${label}:`), {
    x: 40,
    y: writer.y,
    font: writer.bold,
    size: 9.5,
    color: rgb(0.12, 0.12, 0.12),
  });
  writer.page.drawText(sanitizePdfText(value), {
    x: 210,
    y: writer.y,
    font: writer.font,
    size: 9.5,
    color: rgb(0.12, 0.12, 0.12),
  });
  writer.y -= 14;
}

export function writerGap(writer: PageWriter, px: number) {
  writer.y -= px;
}

export async function createContractWriters(pageCount: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = Array.from({ length: pageCount }, () => doc.addPage([595, 842]));
  const writers = pages.map((page, index) => ({
    page,
    font,
    bold,
    y: 760,
    pageIndex: index + 1,
    totalPages: pageCount,
  }));
  return { doc, writers };
}
