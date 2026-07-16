import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { Reservation } from "../../drizzle/schema";

const COMPANY = {
  legalName: "SAS 3L Yachting",
  siret: "99130386800012",
  tva: "FR62991303868",
  address: "130 Traverse Haute Bertrandiere, 13600 La Ciotat, FR",
  email: "contact@3lyachting.com",
};

const BANK_DETAILS = {
  iban: "FR76 1695 8000 0129 3037 2555 023",
};

const ACOMPTE_PERCENT = 20;
const SOLDE_DAYS_BEFORE = 45;

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

type PageWriter = {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
  pageIndex: number;
  totalPages: number;
};

function drawHeader(writer: PageWriter) {
  const { page, font, bold, pageIndex, totalPages } = writer;
  page.drawText(sanitizePdfText(COMPANY.legalName), { x: 40, y: 800, font: bold, size: 8.5, color: rgb(0.15, 0.15, 0.15) });
  page.drawText(
    sanitizePdfText(
      `SIRET ${COMPANY.siret} - TVA ${COMPANY.tva} - Catamaran Sabine - Transport maritime de passagers NUC categorie 1`,
    ),
    { x: 40, y: 788, font, size: 7.5, color: rgb(0.35, 0.35, 0.35) },
  );
  page.drawText(sanitizePdfText(`Page ${pageIndex} sur ${totalPages}`), {
    x: 480,
    y: 788,
    font,
    size: 7.5,
    color: rgb(0.35, 0.35, 0.35),
  });
  page.drawLine({ start: { x: 40, y: 782 }, end: { x: 555, y: 782 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  writer.y = 760;
}

function wrapLine(text: string, maxChars = 105) {
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

function drawParagraph(writer: PageWriter, text: string, opts?: { bold?: boolean; size?: number; gap?: number }) {
  const size = opts?.size ?? 9.5;
  const gap = opts?.gap ?? 12;
  const useFont = opts?.bold ? writer.bold : writer.font;
  for (const line of wrapLine(text)) {
    if (writer.y < 56) break;
    writer.page.drawText(line, { x: 40, y: writer.y, font: useFont, size, color: rgb(0.12, 0.12, 0.12) });
    writer.y -= gap;
  }
}

function drawBullet(writer: PageWriter, text: string) {
  drawParagraph(writer, `- ${text}`, { size: 9.2, gap: 11 });
}

function drawTitle(writer: PageWriter, text: string) {
  writer.y -= 4;
  writer.page.drawText(sanitizePdfText(text), { x: 40, y: writer.y, font: writer.bold, size: 12, color: rgb(0.1, 0.2, 0.36) });
  writer.y -= 18;
}

function drawSection(writer: PageWriter, text: string) {
  writer.y -= 6;
  writer.page.drawText(sanitizePdfText(text), { x: 40, y: writer.y, font: writer.bold, size: 10.5, color: rgb(0.12, 0.12, 0.12) });
  writer.y -= 14;
}

function drawField(writer: PageWriter, label: string, value: string) {
  writer.page.drawText(sanitizePdfText(`${label}:`), { x: 40, y: writer.y, font: writer.bold, size: 9.5, color: rgb(0.12, 0.12, 0.12) });
  writer.page.drawText(sanitizePdfText(value), { x: 210, y: writer.y, font: writer.font, size: 9.5, color: rgb(0.12, 0.12, 0.12) });
  writer.y -= 14;
}

function computeTransatPaymentSchedule(r: Reservation) {
  const acompteMontant = Math.round((r.montantTotal * ACOMPTE_PERCENT) / 100);
  const soldeMontant = Math.max(0, r.montantTotal - acompteMontant);
  const soldeEcheanceAt = new Date(r.dateDebut);
  soldeEcheanceAt.setUTCDate(soldeEcheanceAt.getUTCDate() - SOLDE_DAYS_BEFORE);
  return { acompteMontant, soldeMontant, soldeEcheanceAt };
}

export async function buildTransatBerthContractPdf(r: Reservation, contractNumber: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const totalPages = 7;
  const pages = Array.from({ length: totalPages }, () => doc.addPage([595, 842]));

  const fullName = String(r.nomClient || "-").trim();
  const places = Math.max(1, Number(r.nbPersonnes || r.nbCabines || 1));
  const payment = computeTransatPaymentSchedule(r);
  const itinerary = String(r.destination || "Traversee Atlantique").trim();

  const writers = pages.map((page, index) => ({
    page,
    font,
    bold,
    y: 760,
    pageIndex: index + 1,
    totalPages,
  }));

  // Page 1 — identification
  {
    const w = writers[0];
    drawHeader(w);
    drawTitle(w, "CONTRAT TRAVERSEE ATLANTIQUE — PLACE PASSAGER");
    drawParagraph(w, "Sabine Sailing — Navire professionnel NUC — Pavillon francais", { size: 9 });
    writerGap(w, 8);
    drawField(w, "Reference dossier", contractNumber);
    drawField(w, "Passager principal", fullName);
    drawField(w, "Telephone", String(r.telClient || "-"));
    drawField(w, "Email", String(r.emailClient || "-"));
    drawField(w, "Navire", "Catamaran Sabine");
    drawField(w, "Type de prestation", "[X] PLACE SUR TRAVERSEE ATLANTIQUE (passager)");
    drawField(w, "Nombre de places", String(places));
    drawField(w, "Itineraire / traversee", itinerary);
    drawField(w, "Port d'embarquement", "Selon programme (La Ciotat, Gibraltar ou Tenerife — voir dossier)");
    drawField(w, "Date embarquement", dateFr(r.dateDebut) || "-");
    drawField(w, "Date debarquement", dateFr(r.dateFin) || "-");
    drawField(w, "Tarif total TTC", `${euro(r.montantTotal)} EUR`);
    drawField(w, "Acompte (20 %)", `${euro(payment.acompteMontant)} EUR`);
    drawField(w, "Solde", `${euro(payment.soldeMontant)} EUR au plus tard le ${dateFr(payment.soldeEcheanceAt)}`);
    drawField(w, "Reglement", `Virement — IBAN ${BANK_DETAILS.iban}`);
    drawField(w, "Message client", sanitizePdfText(String(r.message || "").trim() || "-"));
    writerGap(w, 10);
    drawSection(w, "PARTIE A — CONDITIONS COMMUNES");
    drawParagraph(
      w,
      "Toute reservation implique l'acceptation des presentes conditions. Le capitaine est seul maitre a bord et responsable de la securite des personnes, du navire et de l'environnement. Les itineraires sont indicatifs et peuvent etre modifies pour des raisons meteorologiques, techniques ou de securite.",
    );
    drawBullet(w, "Passeport en cours de validite obligatoire pour toute la traversee.");
    drawBullet(w, "Respect obligatoire du briefing et des consignes de securite.");
    drawBullet(w, "Assurances personnelles recommandees (annulation, rapatriement, medical).");
    drawBullet(w, "Toute reclamation doit etre adressee dans les 30 jours suivant le debarquement.");
  }

  // Page 2 — prestation transat
  {
    const w = writers[1];
    drawHeader(w);
    drawTitle(w, "PARTIE B — TRAVERSEE ATLANTIQUE A LA PLACE");
    drawParagraph(
      w,
      "Le passager reserve une ou plusieurs places a bord du catamaran Sabine pour une traversee atlantique en equipage professionnel. Le navire est partage avec d'autres passagers. Le passager n'est pas membre d'equipage et n'assure ni les manoeuvres ni les quarts de veille.",
    );
    drawSection(w, "Inclus");
    drawBullet(w, "Hebergement a bord selon la place reservee.");
    drawBullet(w, "Services du capitaine et de l'equipage professionnel.");
    drawBullet(w, "Pension complete a bord (repas prepares collectivement).");
    drawBullet(w, "Boissons de base pendant les repas (eau, the, cafe, jus, vin de table modere).");
    drawBullet(w, "Carburant necessaire a la traversee programmee.");
    drawBullet(w, "Materiel de loisirs embarque : snorkeling, paddles, kayak.");
    drawBullet(w, "Assurance RC armateur.");
    drawSection(w, "Non inclus");
    drawBullet(w, "Transport vers/depuis le port d'embarquement ou de debarquement.");
    drawBullet(w, "Formalites personnelles, visas et taxes d'escale le cas echeant.");
    drawBullet(w, "Boissons alcoolisees hors formule et depenses personnelles a terre.");
    drawBullet(w, "Assurances personnelles du passager.");
    drawSection(w, "Participation a la vie de bord");
    drawParagraph(
      w,
      "En qualite de passager, une participation active aux taches quotidiennes de la vie a bord est requise, notamment : entretien des parties communes, cuisine, vaisselle, rangement et menage leger du carre et des espaces partages.",
    );
    drawParagraph(
      w,
      "Cette participation ne comprend en aucun cas les manoeuvres du navire, la conduite, la veille de quart ou toute fonction d'equipage. Ces missions restent exclusivement assurees par l'equipage professionnel. Le capitaine peut adapter la repartition des taches selon les capacites de chacun.",
    );
    drawSection(w, "Paiements");
    drawBullet(w, "Acompte de 20 % a la reservation.");
    drawBullet(w, "Solde au plus tard 45 jours avant le depart.");
    drawBullet(w, "Barème d'annulation : >90 jours 25 % • 89-60 jours 50 % • 59-30 jours 75 % • <30 jours 100 %.");
  }

  // Page 3 — CGV essentielles
  {
    const w = writers[2];
    drawHeader(w);
    drawTitle(w, "CONDITIONS GENERALES — TRAVERSEE ATLANTIQUE");
    drawSection(w, "1. Prestation");
    drawParagraph(
      w,
      "La prestation correspond a une place passager sur une traversee atlantique a bord du catamaran Sabine, avec equipage professionnel. Le port d'embarquement effectif (La Ciotat, Gibraltar, Tenerife ou autre selon programme) est confirme par l'armateur avant le depart.",
    );
    drawSection(w, "2. Documents et aptitude");
    drawParagraph(w, "Chaque passager doit etre en possession d'un passeport valide pour toute la duree de la traversee et les escales prevues. Tout probleme de sante ou situation particuliere doit etre signale avant la reservation.");
    drawSection(w, "3. Embarquement et deroulement");
    drawParagraph(
      w,
      "Les heures d'embarquement et de debarquement figurent au contrat. En cas de retard d'un passager, le navire peut appareiller pour ne pas penaliser l'equipage et les autres participants. Le capitaine peut modifier l'itineraire, les escales et le rythme de navigation pour des raisons meteorologiques, de securite ou de contraintes operationnelles.",
    );
    drawSection(w, "4. Vie a bord et comportement");
    drawParagraph(
      w,
      "Les passagers respectent les consignes du capitaine et participent de bonne volonte aux taches quotidiennes de la vie a bord, sans intervention sur la navigation. Le capitaine peut refuser l'embarquement ou debarquer tout passager dont le comportement met en danger la traversee.",
    );
    drawSection(w, "5. Force majeure");
    drawParagraph(
      w,
      "Sont consideres cas de force majeure : conditions meteorologiques severes, avarie majeure, decisions administratives, conflits, evenements sanitaires ou tout evenement independant de la volonte raisonnable de l'armateur. L'organisateur pourra modifier, reporter ou annuler la prestation ; seules les sommes correspondant aux services non fournis seront remboursees.",
    );
    drawSection(w, "6. Assurances et responsabilite");
    drawParagraph(
      w,
      "Les assurances de l'armateur couvrent sa responsabilite professionnelle. Chaque passager doit disposer de ses propres assurances pour les risques personnels, notamment annulation, rapatriement et frais medicaux en mer.",
    );
  }

  // Page 4 — suite CGV
  {
    const w = writers[3];
    drawHeader(w);
    drawTitle(w, "CONDITIONS GENERALES (suite)");
    drawSection(w, "7. Caisse de bord");
    drawParagraph(
      w,
      "Une contribution forfaitaire a la caisse de bord peut etre demandee pour couvrir taxes locales, frais portuaires, clearances et consommations variables. Les modalites sont precisees avant le depart. Le solde non utilise est restitue en fin de traversee lorsque applicable.",
    );
    drawSection(w, "8. Bagages et objets personnels");
    drawParagraph(
      w,
      "La place a bord est limitee : sacs souples recommandes. L'armateur decline toute responsabilite en cas de perte, vol ou deterioration d'objets personnels. Il est deconseille d'embarquer des objets de valeur.",
    );
    drawSection(w, "9. Annulation et modification");
    drawParagraph(
      w,
      "Le paiement d'un acompte vaut acceptation des presentes conditions. Tout retard de paiement peut entrainer la resiliation de la reservation et l'application des frais d'annulation. La non-presentation au depart vaut annulation avec facturation integrale des sommes dues.",
    );
    drawSection(w, "10. Reclamations et droit applicable");
    drawParagraph(
      w,
      "Toute reclamation doit etre formulee par ecrit dans un delai maximum de 30 jours apres le debarquement. Les presentes conditions sont regies par le droit francais. Competence exclusive des tribunaux du siege social de l'organisateur (Marseille).",
    );
    drawSection(w, "ANNEXE 1 — Infos pratiques traversee");
    drawBullet(w, "Protection solaire renforcee, vetements chauds et impermeables indispensables.");
    drawBullet(w, "Medicaments personnels, seasickness remedies si sensibilite au mal de mer.");
    drawBullet(w, "Passeport, copies numeriques et assurance voyage a jour.");
    drawBullet(w, "Participation bienveillante aux taches collectives ; repos et hydratation en navigation.");
  }

  // Page 5 — briefing & securite
  {
    const w = writers[4];
    drawHeader(w);
    drawTitle(w, "ANNEXE 2 — BRIEFING ET SECURITE");
    drawParagraph(w, "Chaque passager reconnait avoir ete informe que le briefing a l'embarquement comprend notamment :");
    drawBullet(w, "Presentation du navire et des equipements de securite.");
    drawBullet(w, "Gilets de sauvetage, extincteurs, moyens d'alerte et issues.");
    drawBullet(w, "Gestion de l'eau et de l'electricite a bord.");
    drawBullet(w, "Utilisation des toilettes marines et consignes d'hygiene.");
    drawBullet(w, "Deplacements sur le pont, notamment de nuit et par mer formee.");
    drawBullet(w, "Organisation des repas, des taches communes et des espaces autorises.");
    drawBullet(w, "Programme indicatif de navigation et escales eventuelles.");
    drawSection(w, "Consignes de securite");
    drawBullet(w, "Porter le gilet de sauvetage lorsque le capitaine l'exige.");
    drawBullet(w, "Ne jamais intervenir sur les manoeuvres sans ordre explicite du capitaine.");
    drawBullet(w, "Attendre l'arret des moteurs et l'autorisation avant toute baignade.");
    drawBullet(w, "Interdiction de fumer a l'interieur du navire.");
    drawBullet(w, "Interdiction d'armes et de substances illicites.");
    drawBullet(w, "Les enfants restent sous la responsabilite directe de leurs accompagnants.");
  }

  // Page 6 — signatures passagers
  {
    const w = writers[5];
    drawHeader(w);
    drawTitle(w, "SIGNATURES");
    drawParagraph(
      w,
      "Je reconnais avoir pris connaissance des conditions communes, de la partie B relative a la traversee atlantique a la place, ainsi que des annexes. Je m'engage a respecter les consignes de securite et a participer de bonne volonte aux taches quotidiennes de la vie a bord, sans prendre part aux manoeuvres ni aux quarts de veille.",
    );
    writerGap(w, 16);
    for (let i = 0; i < 4; i += 1) {
      w.page.drawText(sanitizePdfText(`Passager ${i + 1} — Nom & prenom : ________________________________`), {
        x: 40,
        y: w.y,
        font: w.font,
        size: 9,
        color: rgb(0.12, 0.12, 0.12),
      });
      w.y -= 16;
      w.page.drawText(sanitizePdfText("Signature : ________________________________________   Date : __________"), {
        x: 40,
        y: w.y,
        font: w.font,
        size: 9,
        color: rgb(0.12, 0.12, 0.12),
      });
      w.y -= 28;
    }
    writerGap(w, 10);
    w.page.drawText(sanitizePdfText(`Periode : ${dateFr(r.dateDebut)} au ${dateFr(r.dateFin)}`), {
      x: 40,
      y: w.y,
      font: w.bold,
      size: 9.5,
      color: rgb(0.12, 0.12, 0.12),
    });
    w.y -= 14;
    w.page.drawText(sanitizePdfText(`Total : ${euro(r.montantTotal)} EUR — ${places} place(s)`), {
      x: 40,
      y: w.y,
      font: w.bold,
      size: 9.5,
      color: rgb(0.12, 0.12, 0.12),
    });
  }

  // Page 7 — signature client + armateur
  {
    const w = writers[6];
    drawHeader(w);
    drawTitle(w, "SIGNATURES FINALES DU CONTRAT");
    drawParagraph(
      w,
      "Bon pour accord du passager principal. Je reconnais avoir pris connaissance de l'ensemble du contrat et de ses annexes.",
    );
    writerGap(w, 20);
    w.page.drawText(sanitizePdfText("Lieu : La Ciotat"), { x: 40, y: w.y, font: w.font, size: 10, color: rgb(0.12, 0.12, 0.12) });
    w.y -= 22;
    w.page.drawText(sanitizePdfText("Date : ____ / ____ / ________"), { x: 40, y: w.y, font: w.font, size: 10, color: rgb(0.12, 0.12, 0.12) });
    w.y -= 30;
    w.page.drawText(sanitizePdfText(`Signature client : ${fullName}`), { x: 40, y: w.y, font: w.font, size: 10, color: rgb(0.12, 0.12, 0.12) });
    w.page.drawLine({ start: { x: 150, y: w.y - 4 }, end: { x: 420, y: w.y - 4 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });
    w.y -= 40;
    w.page.drawText(sanitizePdfText("Signature armateur : SAS 3L Yachting"), {
      x: 40,
      y: w.y,
      font: w.bold,
      size: 10,
      color: rgb(0.12, 0.12, 0.12),
    });
    w.page.drawLine({ start: { x: 180, y: w.y - 4 }, end: { x: 420, y: w.y - 4 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });
    w.y -= 18;
    w.page.drawText(sanitizePdfText(`Date : ${dateFr(new Date())}`), { x: 40, y: w.y, font: w.font, size: 9, color: rgb(0.35, 0.35, 0.35) });
    w.y -= 24;
    w.page.drawText(sanitizePdfText(`${COMPANY.legalName} — ${COMPANY.email}`), {
      x: 40,
      y: w.y,
      font: w.font,
      size: 8.5,
      color: rgb(0.45, 0.45, 0.45),
    });
  }

  return await doc.save();
}

function writerGap(writer: PageWriter, px: number) {
  writer.y -= px;
}
