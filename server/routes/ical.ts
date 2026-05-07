import { Router, type Request, type Response } from "express";
import nodeIcal from "node-ical";
import { eq, gte } from "drizzle-orm";
import type { CalendarResponse, FetchOptions, VEvent } from "node-ical";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import { charterSlots, config, disponibilites, reservations } from "../../drizzle/schema";

const router = Router();

const ICAL_KEY = "google_ical_url";

/** Cache des événements déjà parsés (évite de solliciter Google à chaque hit). */
let cacheData: GoogleIcalEvent[] | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const FETCH_OPTIONS: FetchOptions = {
  headers: {
    "User-Agent": "SabineSailing/1.0 (node; iCal sync)",
    Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8",
  },
  redirect: "follow",
};

const escapeIcs = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

/** Origine publique pour construire des URLs absolues (Google Agenda abonne l’URL depuis ses serveurs). */
function resolvePublicOrigin(req: Request): string {
  if (ENV.publicBaseUrl) return ENV.publicBaseUrl;
  const xfProto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0]?.trim() || "https";
  const xfHost = (req.get("x-forwarded-host") || req.get("host") || "").split(",")[0]?.trim();
  if (!xfHost) return "";
  return `${xfProto}://${xfHost}`;
}

/** Aligné sur le calendrier interne : tout sauf créneaux charter « disponibles ». */
function isBlockingPlanningExport(ev: { planningType: string; statut: string }): boolean {
  if (ev.planningType !== "charter") return true;
  return ev.statut !== "disponible";
}

const toIcsDateTime = (date: Date) =>
  date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

type GoogleIcalEvent = {
  uid?: string;
  titre: string;
  description: string;
  debut: string;
  fin: string;
  destination: string;
  statut: "disponible" | "reserve" | "option" | "ferme";
  tarif: number | null;
  source: "google-ical";
};

function detectDestination(text: string): string {
  const t = (text || "").toLowerCase();
  if (/antille|martinique|grenadin|caraib|caribb|guadeloupe|saintes/.test(t)) {
    return "Antilles";
  }
  if (/atlantique|atlantic|transat|traverse/.test(t)) {
    return "Traversée Atlantique";
  }
  if (/corse|sardaig|mediter|mediterr|baleare|italie/.test(t)) {
    return "Méditerranée";
  }
  return "Méditerranée";
}

function detectStatut(summary: string): "disponible" | "reserve" | "option" | "ferme" {
  const s = (summary || "").toLowerCase();
  if (/reserv|booked|confirm|vendu/.test(s)) return "reserve";
  if (/option|pending|tentative/.test(s)) return "option";
  if (/ferme|fermé|closed|indispo/.test(s)) return "ferme";
  return "disponible";
}

function detectTarif(text: string): number | null {
  if (!text) return null;
  const match = text.match(/(\d[\d\s]{2,})\s*(€|euros?|EUR)/i);
  if (match) {
    const num = Number.parseInt(match[1].replace(/\s/g, ""), 10);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function eurosFromCents(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return (n / 100).toFixed(2);
}

/** Valeurs iCal avec paramètres → chaîne lisible (node-ical). */
function paramToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "val" in value) {
    const v = (value as { val: unknown }).val;
    return v == null ? "" : String(v);
  }
  return String(value);
}

function toValidDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatIcalFetchError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b401\b|Unauthorized/i.test(msg)) {
    return "Accès refusé (401). Régénérez l’« adresse secrète iCal » dans Google Agenda — l’ancien lien a peut‑être été révoqué.";
  }
  if (/\b403\b|Forbidden/i.test(msg)) {
    return "Accès refusé (403). Vérifiez que l’agenda est bien partagé avec le lien secret ou régénérez l’URL iCal.";
  }
  if (/\b404\b|Not Found/i.test(msg)) {
    return "URL introuvable (404). Vérifiez que l’URL est complète et se termine souvent par /basic.ics.";
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|CERT_|certificate|TLS|SSL/i.test(msg)) {
    return `Réseau / TLS : ${msg}`;
  }
  return msg || "Erreur lors de la lecture du flux iCal.";
}

function pushParsed(out: GoogleIcalEvent[], uid: string | undefined, summary: string, description: string, location: string, start: Date, end: Date) {
  const combined = `${summary} ${description} ${location}`;
  out.push({
    uid,
    titre: summary,
    description,
    debut: start.toISOString(),
    fin: end.toISOString(),
    destination: detectDestination(combined),
    statut: detectStatut(summary),
    tarif: detectTarif(combined),
    source: "google-ical",
  });
}

/**
 * Fenêtre d’expansion des récurrences (Google renvoie souvent des RRULE sans instances matérialisées).
 */
function expansionRange(): { from: Date; to: Date } {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 120);
  const to = new Date();
  to.setUTCFullYear(to.getUTCFullYear() + 2);
  return { from, to };
}

function calendarResponseToEvents(data: CalendarResponse): GoogleIcalEvent[] {
  const out: GoogleIcalEvent[] = [];
  const { from, to } = expansionRange();

  for (const key of Object.keys(data)) {
    if (key === "vcalendar") continue;
    const comp = data[key as keyof CalendarResponse];
    if (!comp || typeof comp !== "object") continue;
    const ev = comp as VEvent & { type?: string };
    if (String(ev.type) !== "VEVENT") continue;

    const summary = paramToString(ev.summary);
    const description = paramToString(ev.description);
    const location = paramToString(ev.location);
    const uid = typeof ev.uid === "string" ? ev.uid : undefined;

    if (ev.rrule) {
      try {
        const instances = nodeIcal.expandRecurringEvent(ev, { from, to, expandOngoing: true });
        for (const inst of instances) {
          const start = inst.start instanceof Date ? inst.start : toValidDate(inst.start);
          const end = inst.end instanceof Date ? inst.end : toValidDate(inst.end);
          if (!start || !end) continue;
          const instSummary = paramToString(inst.summary) || summary;
          pushParsed(out, uid, instSummary, description, location, start, end);
        }
      } catch (e) {
        console.warn("[iCal] expansion RRULE ignorée pour un événement:", e);
        const start = toValidDate(ev.start);
        const end = toValidDate(ev.end);
        if (start && end) {
          pushParsed(out, uid, summary, description, location, start, end);
        }
      }
      continue;
    }

    const start = toValidDate(ev.start);
    let end = toValidDate(ev.end);
    if (!start) continue;
    if (!end) {
      end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    }
    pushParsed(out, uid, summary, description, location, start, end);
  }

  out.sort((a, b) => new Date(a.debut).getTime() - new Date(b.debut).getTime());
  return out;
}

async function fetchCalendarFromUrl(url: string): Promise<CalendarResponse> {
  let trimmed = url.trim();
  if (trimmed.toLowerCase().startsWith("webcal://")) {
    trimmed = `https://${trimmed.slice("webcal://".length)}`;
  }
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    throw new Error("L’URL doit commencer par https:// (ou webcal:// converti automatiquement).");
  }
  const parsed = nodeIcal.async.fromURL(trimmed, FETCH_OPTIONS);
  return await (parsed as unknown as Promise<CalendarResponse>);
}

async function parseIcalUrlToEvents(url: string): Promise<GoogleIcalEvent[]> {
  const data = await fetchCalendarFromUrl(url);
  return calendarResponseToEvents(data);
}

/** GET /api/ical/events — événements depuis Google (cache 5 min). */
router.get("/events", async (_req, res) => {
  try {
    if (cacheData && Date.now() - cacheTs < CACHE_TTL_MS) {
      return res.json(cacheData);
    }

    const db = await getDb();
    if (!db) return res.json([]);

    const [row] = await db.select().from(config).where(eq(config.cle, ICAL_KEY)).limit(1);
    const url = String(row?.valeur || "").trim();
    if (!url) return res.json([]);

    const parsed = await parseIcalUrlToEvents(url);
    cacheData = parsed;
    cacheTs = Date.now();
    res.json(parsed);
  } catch (err: unknown) {
    console.error("[iCal] Erreur:", err);
    res.status(500).json({ error: formatIcalFetchError(err) });
  }
});

/** Vide le cache (prochain GET /events refetch). */
router.post("/refresh", async (_req, res) => {
  cacheData = null;
  cacheTs = 0;
  res.json({ ok: true, message: "Cache iCal vidé." });
});

/**
 * POST /api/ical/verify — teste une URL (corps { url }) ou l’URL enregistrée si url vide.
 * Ne modifie pas le cache des /events sauf si vous appelez /refresh après sauvegarde.
 */
router.post("/verify", async (req, res) => {
  try {
    const bodyUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    let url = bodyUrl;
    if (!url) {
      const db = await getDb();
      if (!db) return res.status(500).json({ ok: false, error: "Base de données indisponible." });
      const [row] = await db.select().from(config).where(eq(config.cle, ICAL_KEY)).limit(1);
      url = String(row?.valeur || "").trim();
    }
    if (!url) {
      return res.json({
        ok: false,
        error: "Collez d’abord l’URL secrète .ics (ou enregistrez-la puis testez sans la resaisir).",
      });
    }

    const events = await parseIcalUrlToEvents(url);
    return res.json({
      ok: true,
      count: events.length,
      samples: events.slice(0, 10).map((e) => ({
        titre: e.titre,
        debut: e.debut,
        fin: e.fin,
        destination: e.destination,
      })),
    });
  } catch (err: unknown) {
    return res.json({ ok: false, error: formatIcalFetchError(err), count: 0 });
  }
});

router.get("/config", async (_req, res) => {
  const db = await getDb();
  // Prefer extension-less path: some proxies/CDNs mishandle ".ics" routes.
  const exportPath = "/api/ical/export";
  if (!db) return res.json({ url: "", exportUrl: exportPath });
  const [row] = await db.select().from(config).where(eq(config.cle, ICAL_KEY)).limit(1);
  const origin = resolvePublicOrigin(_req);
  res.json({
    url: row?.valeur || "",
    exportUrl: origin ? `${origin}${exportPath}` : exportPath,
  });
});

router.put("/config", async (req, res) => {
  const raw = req.body?.url;
  let url = typeof raw === "string" ? raw.trim() : "";
  if (url.toLowerCase().startsWith("webcal://")) {
    url = `https://${url.slice("webcal://".length)}`;
  }
  const db = await getDb();
  if (!db) return res.status(500).json({ error: "DB indisponible" });

  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    return res.status(400).json({ error: "URL invalide : doit commencer par http:// ou https://" });
  }

  const [existing] = await db.select().from(config).where(eq(config.cle, ICAL_KEY)).limit(1);
  if (existing) {
    await db.update(config).set({ valeur: url }).where(eq(config.cle, ICAL_KEY));
  } else {
    await db.insert(config).values({
      cle: ICAL_KEY,
      valeur: url,
      description: "URL iCal secrète du Google Agenda Sabine Sailing",
    });
  }
  cacheData = null;
  cacheTs = 0;
  res.json({ ok: true });
});

async function sendPlanningExportIcs(_req: Request, res: Response) {
  try {
    const db = await getDb();
    if (!db) return res.status(500).send("DB indisponible");

    const now = new Date();
    const legacyDisponibilites = await db
      .select()
      .from(disponibilites)
      .where(gte(disponibilites.fin, now))
      .orderBy(disponibilites.debut);
    const blockingLegacy = legacyDisponibilites.filter((ev) => isBlockingPlanningExport(ev));
    const inactiveCharterSlots = await db
      .select()
      .from(charterSlots)
      .where(gte(charterSlots.fin, now))
      .orderBy(charterSlots.debut);
    const blockingSlots = inactiveCharterSlots.filter((s) => !s.active);
    const allReservations = await db
      .select()
      .from(reservations)
      .orderBy(reservations.dateDebut);
    const exportableReservations = allReservations.filter((r) => {
      const status = String(r.requestStatus || "");
      return status !== "refusee" && status !== "archivee";
    });

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Sabine Sailing//Planning Export//FR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Sabine Sailing Planning",
      "X-WR-TIMEZONE:UTC",
    ];

    for (const ev of blockingLegacy) {
      const title = `[${ev.planningType}] ${ev.destination} - ${ev.statut}`;
      const descriptionParts = [
        `Type: ${ev.planningType}`,
        `Statut: ${ev.statut}`,
        ev.tarif != null ? `Tarif bateau entier: ${ev.tarif} EUR` : "",
        ev.tarifCabine != null ? `Tarif cabine: ${ev.tarifCabine} EUR` : "",
        ev.tarifJourPersonne != null ? `Tarif/jour/personne: ${ev.tarifJourPersonne} EUR` : "",
        ev.tarifJourPriva != null ? `Tarif jour privatif: ${ev.tarifJourPriva} EUR` : "",
        ev.capaciteTotale != null ? `Capacité totale: ${ev.capaciteTotale}` : "",
        ev.cabinesReservees != null ? `Cabines réservées: ${ev.cabinesReservees}` : "",
        ev.note ? `Note interne: ${ev.note}` : "",
        ev.notePublique ? `Public: ${ev.notePublique}` : "",
      ].filter(Boolean);

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:dispo-${ev.id}@sabine-sailing.com`);
      lines.push(`DTSTAMP:${toIcsDateTime(new Date())}`);
      lines.push(`DTSTART:${toIcsDateTime(new Date(ev.debut))}`);
      lines.push(`DTEND:${toIcsDateTime(new Date(ev.fin))}`);
      lines.push(`SUMMARY:${escapeIcs(title)}`);
      lines.push(`DESCRIPTION:${escapeIcs(descriptionParts.join("\n"))}`);
      lines.push(`LOCATION:${escapeIcs(ev.destination)}`);
      lines.push("END:VEVENT");
    }
    for (const slot of blockingSlots) {
      const title = `[charter] ${slot.product} - indisponible`;
      const descriptionParts = [
        "Type: charter-slot",
        `ID slot: ${slot.id}`,
        `Produit: ${slot.product}`,
        `Actif: ${slot.active ? "oui" : "non"}`,
        slot.debut ? `Début brut: ${new Date(slot.debut).toISOString()}` : "",
        slot.fin ? `Fin brute: ${new Date(slot.fin).toISOString()}` : "",
        slot.note ? `Note: ${slot.note}` : "",
        slot.publicNote ? `Public: ${slot.publicNote}` : "",
      ].filter(Boolean);

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:charter-slot-${slot.id}@sabine-sailing.com`);
      lines.push(`DTSTAMP:${toIcsDateTime(new Date())}`);
      lines.push(`DTSTART:${toIcsDateTime(new Date(slot.debut))}`);
      lines.push(`DTEND:${toIcsDateTime(new Date(slot.fin))}`);
      lines.push(`SUMMARY:${escapeIcs(title)}`);
      lines.push(`DESCRIPTION:${escapeIcs(descriptionParts.join("\n"))}`);
      lines.push(`LOCATION:${escapeIcs("Sabine Sailing")}`);
      lines.push("END:VEVENT");
    }
    for (const r of exportableReservations) {
      const title = `[reservation] ${r.destination || "Sabine Sailing"} - ${r.formule}`;
      const descriptionParts = [
        `ID réservation: ${r.id}`,
        `Client: ${r.nomClient}${r.prenomClient ? ` ${r.prenomClient}` : ""}`.trim(),
        r.emailClient ? `Email: ${r.emailClient}` : "",
        r.telClient ? `Téléphone: ${r.telClient}` : "",
        r.customerId != null ? `Customer ID: ${r.customerId}` : "",
        r.disponibiliteId != null ? `Disponibilité ID: ${r.disponibiliteId}` : "",
        `Personnes: ${r.nbPersonnes}`,
        `Formule: ${r.formule}`,
        r.destination ? `Destination: ${r.destination}` : "",
        `Statut paiement: ${r.statutPaiement || "en_attente"}`,
        `Type paiement: ${r.typePaiement || "acompte"}`,
        `Montant total: ${eurosFromCents(r.montantTotal)} EUR`,
        `Montant payé: ${eurosFromCents(r.montantPaye)} EUR`,
        `Acompte %: ${r.acomptePercent ?? 0}`,
        `Acompte montant: ${eurosFromCents(r.acompteMontant)} EUR`,
        `Solde montant: ${eurosFromCents(r.soldeMontant)} EUR`,
        r.soldeEcheanceAt ? `Échéance solde: ${new Date(r.soldeEcheanceAt).toISOString()}` : "",
        `Statut demande: ${r.requestStatus || "nouvelle"}`,
        `Workflow: ${r.workflowStatut || "demande"}`,
        `Type: ${r.typeReservation || "bateau_entier"}`,
        r.nbCabines != null ? `Nb cabines/places: ${r.nbCabines}` : "",
        r.bookingOrigin ? `Origine: ${r.bookingOrigin}` : "",
        r.message ? `Message client: ${r.message}` : "",
        r.internalComment ? `Commentaire interne: ${r.internalComment}` : "",
        r.ownerValidatedAt ? `Validée le: ${new Date(r.ownerValidatedAt).toISOString()}` : "",
        r.ownerValidatedBy != null ? `Validée par user ID: ${r.ownerValidatedBy}` : "",
        r.archivedAt ? `Archivée le: ${new Date(r.archivedAt).toISOString()}` : "",
        r.createdAt ? `Créée le: ${new Date(r.createdAt).toISOString()}` : "",
        r.updatedAt ? `Modifiée le: ${new Date(r.updatedAt).toISOString()}` : "",
      ].filter(Boolean);

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:reservation-${r.id}@sabine-sailing.com`);
      lines.push(`DTSTAMP:${toIcsDateTime(new Date())}`);
      lines.push(`DTSTART:${toIcsDateTime(new Date(r.dateDebut))}`);
      lines.push(`DTEND:${toIcsDateTime(new Date(r.dateFin))}`);
      lines.push(`SUMMARY:${escapeIcs(title)}`);
      lines.push(`DESCRIPTION:${escapeIcs(descriptionParts.join("\n"))}`);
      lines.push(`LOCATION:${escapeIcs(r.destination || "Sabine Sailing")}`);
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", "inline; filename=\"sabine-planning.ics\"");
    return res.send(lines.join("\r\n"));
  } catch (err: unknown) {
    console.error("[iCal export] Erreur:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Erreur export iCal" });
  }
}

router.get("/export.ics", sendPlanningExportIcs);
/** Même contenu — certains reverse proxies filtrent les chemins avec extension. */
router.get("/export", sendPlanningExportIcs);

export default router;
