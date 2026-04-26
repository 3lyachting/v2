import { eq } from "drizzle-orm";
import { disponibilites, reservations } from "../../drizzle/schema";

type BookingDb = any;

export type BookingUsage = {
  totalUnits: number;
  reservedUnits: number;
  hasPrivate: boolean;
  status: "disponible" | "option" | "reserve" | "ferme";
};

const CONFIRMED_WORKFLOW_STATUSES = ["contrat_signe", "acompte_confirme", "solde_confirme"] as const;
const OPTION_WORKFLOW_STATUSES = ["validee_owner", "contrat_envoye"] as const;
const OPTION_HOLD_DAYS = 7;
const BLOCKING_WORKFLOW_STATUSES = [
  ...OPTION_WORKFLOW_STATUSES,
  ...CONFIRMED_WORKFLOW_STATUSES,
] as const;

const AUTO_NOTE_MARKER = "[AUTO_SEASON_SLOT]";

type SeasonTemplate = {
  startIso: string;
  endIso: string;
  planningType: "charter" | "technical_stop";
  destination: string;
  notePublique: string | null;
  tarif: number | null;
  tarifCabine: number | null;
  tarifJourPersonne: number | null;
  tarifJourPriva: number | null;
  capaciteTotale: number;
};

function toIsoDay(value: any) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function overlapsIsoDayRange(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && aEnd >= bStart;
}

function getInclusiveReservationIsoRange(r: any) {
  const start = toIsoDay(r.dateDebut);
  const endRaw = toIsoDay(r.dateFin);
  if (!start || !endRaw) return null;
  const end = endRaw < start ? start : endRaw;
  return { start, end };
}

function isActiveOptionReservation(r: any) {
  const ws = String(r?.workflowStatut || "");
  const requestValidated = String(r?.requestStatus || "") === "validee";
  if (!OPTION_WORKFLOW_STATUSES.includes(ws as any) && !requestValidated) return false;
  const baseDateRaw = r?.ownerValidatedAt || r?.updatedAt || r?.createdAt;
  if (!baseDateRaw) return false;
  const baseDate = new Date(baseDateRaw);
  if (Number.isNaN(baseDate.getTime())) return false;
  const expiry = new Date(baseDate);
  expiry.setUTCDate(expiry.getUTCDate() + OPTION_HOLD_DAYS);
  return expiry.getTime() > Date.now();
}

export async function resolveDisponibiliteIdForReservation(db: BookingDb, r: any): Promise<number | null> {
  if (r.disponibiliteId) return r.disponibiliteId;
  const rows = await db.select().from(disponibilites);
  const range = getInclusiveReservationIsoRange(r);
  if (!range) return null;
  const { start: reservationStart, end: reservationEnd } = range;
  let match = rows.find((d: any) => {
    const dStart = toIsoDay(d.debut);
    const dEnd = toIsoDay(d.fin);
    if (!dStart || !dEnd) return false;
    return dStart === reservationStart && dEnd === reservationEnd;
  });
  if (!match) {
    match = rows.find((d: any) => {
      const dStart = toIsoDay(d.debut);
      const dEnd = toIsoDay(d.fin);
      if (!dStart || !dEnd) return false;
      return overlapsIsoDayRange(reservationStart, reservationEnd, dStart, dEnd);
    });
  }
  return match?.id || null;
}

export async function getConfirmedBookingUsage(db: BookingDb, disponibiliteId: number): Promise<BookingUsage> {
  const dispoRows = await db
    .select()
    .from(disponibilites)
    .where(eq(disponibilites.id, disponibiliteId))
    .limit(1);
  const dispo = dispoRows[0];
  const totalUnits = dispo?.capaciteTotale || 4;
  if (!dispo) {
    return { totalUnits, reservedUnits: 0, hasPrivate: false, status: "disponible" };
  }
  if (dispo.planningType && dispo.planningType !== "charter") {
    return { totalUnits, reservedUnits: 0, hasPrivate: false, status: "ferme" };
  }

  const allReservations = await db
    .select()
    .from(reservations)
    .where(eq(reservations.disponibiliteId, disponibiliteId));

  const confirmedReservations = allReservations.filter((r: any) =>
    CONFIRMED_WORKFLOW_STATUSES.includes(r.workflowStatut as any)
  );
  const activeOptionReservations = allReservations.filter((r: any) => isActiveOptionReservation(r));

  const hasPrivate = confirmedReservations.some((r: any) => r.typeReservation === "bateau_entier");
  const hasPrivateOption = !hasPrivate && activeOptionReservations.some((r: any) => r.typeReservation === "bateau_entier");
  const confirmedUnits = hasPrivate
    ? totalUnits
    : confirmedReservations
        .filter((r: any) => r.typeReservation === "cabine" || r.typeReservation === "place")
        .reduce((sum: number, r: any) => sum + Math.max(1, r.nbCabines || 1), 0);
  const optionUnits = hasPrivateOption
    ? totalUnits
    : activeOptionReservations
        .filter((r: any) => r.typeReservation === "cabine" || r.typeReservation === "place")
        .reduce((sum: number, r: any) => sum + Math.max(1, r.nbCabines || 1), 0);
  const confirmedClamped = Math.max(0, Math.min(totalUnits, confirmedUnits));
  const reservedUnits = hasPrivate ? confirmedUnits : confirmedUnits + optionUnits;
  const clampedReserved = Math.max(0, Math.min(totalUnits, reservedUnits));

  let status: BookingUsage["status"] = "disponible";
  if (hasPrivate || confirmedClamped >= totalUnits) status = "reserve";
  else if (clampedReserved > 0 || hasPrivateOption) status = "option";

  return {
    totalUnits,
    reservedUnits: clampedReserved,
    hasPrivate,
    status,
  };
}

export async function refreshDisponibiliteBookingState(db: BookingDb, disponibiliteId: number) {
  const usage = await getConfirmedBookingUsage(db, disponibiliteId);
  console.info("[BookingRules] refreshDisponibiliteBookingState", {
    disponibiliteId,
    status: usage.status,
    reservedUnits: usage.reservedUnits,
    totalUnits: usage.totalUnits,
    hasPrivate: usage.hasPrivate,
  });
  await db
    .update(disponibilites)
    .set({
      statut: usage.status,
      cabinesReservees: usage.status === "ferme" ? 0 : usage.reservedUnits,
      updatedAt: new Date(),
    })
    .where(eq(disponibilites.id, disponibiliteId));
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDaysIso(iso: string, days: number) {
  const dt = new Date(`${iso}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dayOfWeekIso(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

function nextSaturdayOnOrAfter(iso: string) {
  let cursor = iso;
  while (dayOfWeekIso(cursor) !== 6) {
    cursor = addDaysIso(cursor, 1);
  }
  return cursor;
}

function generateDailySlots(startIso: string, endIso: string, template: Omit<SeasonTemplate, "startIso" | "endIso">) {
  const out: SeasonTemplate[] = [];
  let cursor = startIso;
  while (cursor <= endIso) {
    out.push({
      ...template,
      startIso: cursor,
      endIso: cursor,
    });
    cursor = addDaysIso(cursor, 1);
  }
  return out;
}

function generateSaturdayWeeks(startIso: string, endIso: string, template: Omit<SeasonTemplate, "startIso" | "endIso">) {
  const out: SeasonTemplate[] = [];
  let start = nextSaturdayOnOrAfter(startIso);
  while (start < endIso) {
    const end = addDaysIso(start, 7);
    if (end > endIso) break;
    out.push({
      ...template,
      startIso: start,
      endIso: end,
    });
    start = end;
  }
  return out;
}

function getSeasonTemplatesForYear(year: number): SeasonTemplate[] {
  const currentYear = new Date().getUTCFullYear();
  const templates: SeasonTemplate[] = [];

  // Janvier -> début avril: semaines Caraïbes (samedi -> samedi).
  templates.push(
    ...generateSaturdayWeeks(isoDate(year, 1, 1), isoDate(year, 4, 5), {
      planningType: "charter",
      destination: "Caraïbes",
      notePublique: "Croisière Caraïbes (samedi à samedi).",
      tarif: null,
      tarifCabine: 1750,
      tarifJourPersonne: null,
      tarifJourPriva: null,
      capaciteTotale: 4,
    })
  );

  // 5 avril -> 15 décembre: transat aller dédiée, réservation flexible (hors samedi->samedi).
  templates.push(
    ...generateDailySlots(isoDate(year, 4, 5), isoDate(year, 12, 15), {
      planningType: "charter",
      destination: "Transat aller La Ciotat -> Pointe-à-Pitre (Canaries + Cap-Vert)",
      notePublique: "Transat aller dédiée (réservation flexible selon itinéraire).",
      tarif: 3000,
      tarifCabine: null,
      tarifJourPersonne: null,
      tarifJourPriva: null,
      capaciteTotale: 8,
    })
  );

  // Exception avril + mai: journées/mini-séjours autorisés.
  templates.push(
    ...generateDailySlots(isoDate(year, 4, 1), isoDate(year, 5, 31), {
      planningType: "charter",
      destination: "La Ciotat - Cassis (plage de l'Arène) - retour",
      notePublique: "Avril/mai: réservations à la journée ou multi-jours possibles.",
      tarif: null,
      tarifCabine: null,
      tarifJourPersonne: 130,
      tarifJourPriva: 900,
      capaciteTotale: 6,
    })
  );

  // Juin -> fin août: semaines Corse/Sardaigne (samedi -> samedi).
  templates.push(
    ...generateSaturdayWeeks(isoDate(year, 6, 1), isoDate(year, 9, 1), {
      planningType: "charter",
      destination: "Corse & Sardaigne — départ Ajaccio",
      notePublique: "Semaine de croisière en Corse et Sardaigne (samedi à samedi).",
      tarif: null,
      tarifCabine: 1750,
      tarifJourPersonne: null,
      tarifJourPriva: null,
      capaciteTotale: 4,
    })
  );

  // Septembre (1ère quinzaine): journées La Ciotat.
  templates.push(
    ...generateDailySlots(isoDate(year, 9, 1), isoDate(year, 9, 15), {
      planningType: "charter",
      destination: "La Ciotat - Cassis (plage de l'Arène) - retour",
      notePublique: "Journée privative (La Ciotat): navigation, baignade, paddle, apéro.",
      tarif: null,
      tarifCabine: null,
      tarifJourPersonne: 130,
      tarifJourPriva: 900,
      capaciteTotale: 6,
    })
  );

  // 2e quinzaine Dec -> 1 Apr (année suivante): Caraïbes, samedi -> samedi.
  templates.push(
    ...generateSaturdayWeeks(isoDate(year, 12, 16), isoDate(year + 1, 4, 1), {
      planningType: "charter",
      destination: "Caraïbes",
      notePublique: "Croisière Caraïbes (samedi à samedi).",
      tarif: null,
      tarifCabine: 1750,
      tarifJourPersonne: null,
      tarifJourPriva: null,
      capaciteTotale: 4,
    })
  );

  // Exception transat retour dédiée: 5 avril -> 15 mai, sauf année courante.
  if (year !== currentYear) {
    templates.push(
      ...generateDailySlots(isoDate(year, 4, 5), isoDate(year, 5, 15), {
        planningType: "charter",
        destination: "Transat retour Pointe-à-Pitre -> La Ciotat",
        notePublique: "Transat retour dédiée (hors année courante).",
        tarif: 3000,
        tarifCabine: null,
        tarifJourPersonne: null,
        tarifJourPriva: null,
        capaciteTotale: 8,
      })
    );
  }

  return templates;
}

async function ensureSeasonAvailabilitySlots(db: BookingDb, years: number[]) {
  const normalizedYears = Array.from(new Set(years)).sort((a, b) => a - b);
  const allDispos = await db.select().from(disponibilites);
  const existingByRange = new Map<string, any>();
  for (const d of allDispos) {
    const start = toIsoDay(d.debut);
    const end = toIsoDay(d.fin);
    if (!start || !end) continue;
    existingByRange.set(`${start}|${end}`, d);
  }

  for (const year of normalizedYears) {
    const templates = getSeasonTemplatesForYear(year);
    for (const t of templates) {
      const key = `${t.startIso}|${t.endIso}`;
      if (existingByRange.has(key)) continue;
      const inserted = await db
        .insert(disponibilites)
        .values({
          planningType: t.planningType,
          debut: new Date(`${t.startIso}T00:00:00.000Z`),
          fin: new Date(`${t.endIso}T00:00:00.000Z`),
          statut: t.planningType === "technical_stop" ? "ferme" : "disponible",
          destination: t.destination,
          tarif: t.tarif,
          tarifCabine: t.tarifCabine,
          tarifJourPersonne: t.tarifJourPersonne,
          tarifJourPriva: t.tarifJourPriva,
          capaciteTotale: t.capaciteTotale,
          note: AUTO_NOTE_MARKER,
          notePublique: t.notePublique,
        })
        .returning({ id: disponibilites.id, debut: disponibilites.debut, fin: disponibilites.fin });
      const start = toIsoDay(inserted[0]?.debut);
      const end = toIsoDay(inserted[0]?.fin);
      if (start && end) {
        existingByRange.set(`${start}|${end}`, inserted[0]);
      }
    }
  }
}

export async function runBookingConsistencyAudit(db: BookingDb) {
  const allDispos = await db.select().from(disponibilites);
  const allReservations = await db.select().from(reservations);
  const dispoIds = new Set(allDispos.map((d: any) => d.id));

  const reservationsWithoutSlot = allReservations
    .filter((r: any) => r.disponibiliteId && !dispoIds.has(r.disponibiliteId))
    .map((r: any) => r.id);

  const rangeDuplicates: Record<string, number[]> = {};
  for (const d of allDispos) {
    const start = toIsoDay(d.debut);
    const end = toIsoDay(d.fin);
    if (!start || !end) continue;
    const key = `${start}|${end}`;
    if (!rangeDuplicates[key]) rangeDuplicates[key] = [];
    rangeDuplicates[key].push(d.id);
  }
  const duplicateRanges = Object.entries(rangeDuplicates)
    .filter(([, ids]) => ids.length > 1)
    .map(([range, ids]) => ({ range, ids }));

  return {
    summary: {
      totalDispos: allDispos.length,
      totalReservations: allReservations.length,
      reservationsWithoutSlot: reservationsWithoutSlot.length,
      duplicateRanges: duplicateRanges.length,
    },
    reservationsWithoutSlot,
    duplicateRanges,
  };
}

export async function syncDisponibilitesFromReservations(db: BookingDb) {
  const allReservations = await db.select().from(reservations);
  const reservationYears = allReservations
    .map((r: any) => new Date(r.dateDebut).getUTCFullYear())
    .filter((y: any) => Number.isFinite(y)) as number[];
  const currentYear = new Date().getUTCFullYear();
  await ensureSeasonAvailabilitySlots(db, [currentYear - 1, currentYear, currentYear + 1, ...reservationYears]);

  const allDisposAfterSeed = await db.select().from(disponibilites);
  const createdDispoIds: number[] = [];
  const linkedDispoIds = new Set<number>();

  for (const r of allReservations) {
    let bestId = await resolveDisponibiliteIdForReservation(db, r);
    const isBlockingByWorkflow = BLOCKING_WORKFLOW_STATUSES.includes(String(r.workflowStatut || "") as any);
    const isBlockingByRequest = String(r?.requestStatus || "") === "validee";
    if (!bestId && (isBlockingByWorkflow || isBlockingByRequest)) {
      // Si une réservation est déjà en phase bloquante (option/confirmée) mais ne matche aucun créneau,
      // on crée un créneau dédié pour que le calendrier client/backoffice reflète bien l'occupation.
      const created = await db
        .insert(disponibilites)
        .values({
          planningType: "charter",
          debut: new Date(r.dateDebut),
          fin: new Date(r.dateFin),
          statut: CONFIRMED_WORKFLOW_STATUSES.includes(String(r.workflowStatut || "") as any) ? "reserve" : "option",
          destination: r.destination || "La Ciotat",
          notePublique: "Créneau créé automatiquement depuis réservation",
          capaciteTotale: String(r.formule || "") === "journee" ? 6 : 4,
        })
        .returning({ id: disponibilites.id });
      bestId = created[0]?.id || null;
      if (bestId) createdDispoIds.push(bestId);
    }
    if (bestId) linkedDispoIds.add(bestId);
    if (r.disponibiliteId) linkedDispoIds.add(r.disponibiliteId);
    if (bestId && r.disponibiliteId !== bestId) {
      await db
        .update(reservations)
        .set({
          disponibiliteId: bestId,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, r.id));
    }
  }

  // Inclure aussi les créneaux potentiellement "stale" (réservés/optionnés sans résa active)
  // pour éviter des restes de cabinesReservees quand une résa est déplacée/supprimée.
  const staleDispoIds = allDisposAfterSeed
    .filter((d: any) => (d.cabinesReservees || 0) > 0 || String(d.statut || "") === "option" || String(d.statut || "") === "reserve")
    .map((d: any) => d.id);

  const idsToRefresh = Array.from(new Set([...Array.from(linkedDispoIds), ...createdDispoIds, ...staleDispoIds]));
  console.info("[BookingRules] syncDisponibilitesFromReservations", {
    totalReservations: allReservations.length,
    totalDispos: allDisposAfterSeed.length,
    refreshCount: idsToRefresh.length,
  });
  for (const dispoId of idsToRefresh) {
    if (!dispoId) continue;
    await refreshDisponibiliteBookingState(db, dispoId);
  }
}
