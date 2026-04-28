import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { getDb } from "../db";
import { customers, disponibilites, reservations } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { requireAdmin } from "../_core/authz";
import { generateCustomerPassword, hashCustomerPassword, sendCustomerPasswordEmail } from "../_core/customerPassword";
import { ENV } from "../_core/env";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import {
  getConfirmedBookingUsage,
  refreshDisponibiliteBookingState,
  resolveDisponibiliteIdForReservation,
} from "../_core/bookingRules";
import {
  listReservationsByDisponibiliteSafe,
  listReservationsByIdSafe,
  listReservationsSafe,
} from "../_core/reservationsSafe";
import { validateReservationPolicy } from "@shared/reservationPolicy";

const router = Router();
const CUSTOMER_COOKIE = "customer_session_id";
const CAPACITY_BLOCKING_WORKFLOW = ["validee_owner", "contrat_envoye", "contrat_signe", "acompte_confirme", "solde_confirme"];
const BOOKING_ORIGINS = ["direct", "clicknboat", "skippair", "samboat"] as const;
type BookingOrigin = typeof BOOKING_ORIGINS[number];
let bookingOriginColumnAvailable: boolean | null = null;

function normalizeBookingOrigin(value: unknown): BookingOrigin {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "click&boat" || normalized === "click_and_boat") return "clicknboat";
  if ((BOOKING_ORIGINS as readonly string[]).includes(normalized)) return normalized as BookingOrigin;
  return "direct";
}

function inferBookingOriginFromRequest(payload: { bookingOrigin?: unknown; emailClient?: unknown; message?: unknown }): BookingOrigin {
  const explicit = normalizeBookingOrigin(payload.bookingOrigin);
  if (explicit !== "direct") return explicit;
  const haystack = `${String(payload.emailClient || "")} ${String(payload.message || "")}`.toLowerCase();
  if (haystack.includes("clicknboat") || haystack.includes("click&boat")) return "clicknboat";
  if (haystack.includes("skippair")) return "skippair";
  if (haystack.includes("samboat")) return "samboat";
  return "direct";
}

function isMissingBookingOriginColumnError(error: unknown) {
  const message = String((error as any)?.message || "").toLowerCase();
  return message.includes("bookingorigin") || message.includes("booking_origin");
}

async function insertReservationWithoutBookingOrigin(tx: any, payload: any) {
  const result = await tx.execute(sql`
    insert into "reservations" (
      "nomClient",
      "prenomClient",
      "emailClient",
      "customerId",
      "telClient",
      "nbPersonnes",
      "disponibiliteId",
      "formule",
      "typeReservation",
      "nbCabines",
      "destination",
      "dateDebut",
      "dateFin",
      "montantTotal",
      "typePaiement",
      "montantPaye",
      "statutPaiement",
      "requestStatus",
      "message"
    ) values (
      ${payload.nomClient},
      ${payload.prenomClient},
      ${payload.emailClient},
      ${payload.customerId},
      ${payload.telClient},
      ${payload.nbPersonnes},
      ${payload.disponibiliteId},
      ${payload.formule},
      ${payload.typeReservation},
      ${payload.nbCabines},
      ${payload.destination},
      ${payload.dateDebut},
      ${payload.dateFin},
      ${payload.montantTotal},
      ${payload.typePaiement},
      ${payload.montantPaye},
      ${payload.statutPaiement},
      ${payload.requestStatus},
      ${payload.message}
    )
    returning "id"
  `);
  const row = (result as any)?.rows?.[0];
  return row ? Number(row.id) : undefined;
}

async function supportsBookingOriginColumn(db: any) {
  if (bookingOriginColumnAvailable !== null) return bookingOriginColumnAvailable;
  try {
    const result = await db.execute(
      `select 1
       from information_schema.columns
       where table_name = 'reservations' and column_name = 'booking_origin'
       limit 1`,
    );
    bookingOriginColumnAvailable = Array.isArray((result as any)?.rows) && (result as any).rows.length > 0;
  } catch {
    bookingOriginColumnAvailable = false;
  }
  return bookingOriginColumnAvailable;
}

async function fetchClicknboatSummary() {
  if (!ENV.clicknboatApiBaseUrl || !ENV.clicknboatApiToken) {
    return { enabled: false as const, data: null, warning: null };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, ENV.clicknboatApiTimeoutMs || 3500));
  try {
    const base = ENV.clicknboatApiBaseUrl.replace(/\/+$/, "");
    const response = await fetch(`${base}/finance/summary`, {
      headers: {
        Authorization: `Bearer ${ENV.clicknboatApiToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload: any = await response.json();
    const count = Number(payload?.count ?? payload?.reservations ?? payload?.bookings ?? 0);
    const revenueCents = Number(payload?.revenueCents ?? payload?.revenue_centimes ?? payload?.amountCents ?? 0);
    return {
      enabled: true as const,
      data: {
        count: Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0,
        revenueCents: Number.isFinite(revenueCents) ? Math.max(0, Math.round(revenueCents)) : 0,
      },
      warning: null,
    };
  } catch (error: any) {
    return { enabled: true as const, data: null, warning: error?.message || "Click&Boat API indisponible" };
  } finally {
    clearTimeout(timeout);
  }
}

function isActiveReservationForCapacity(r: any) {
  const requestStatus = String(r?.requestStatus || "nouvelle");
  const workflow = String(r?.workflowStatut || "");
  if (CAPACITY_BLOCKING_WORKFLOW.includes(workflow)) return true;
  return requestStatus !== "refusee" && requestStatus !== "archivee";
}

async function lockDisponibiliteForCapacity(tx: any, disponibiliteId: number) {
  await tx.execute(sql`select id from disponibilites where id = ${disponibiliteId} for update`);
  await tx.execute(sql`select id from reservations where "disponibiliteId" = ${disponibiliteId} for update`);
}

function toIsoDay(value: string | Date) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isSaturdayIso(isoDay: string) {
  return new Date(`${isoDay}T00:00:00.000Z`).getUTCDay() === 6;
}

function diffDays(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T00:00:00.000Z`).getTime();
  const end = new Date(`${endIso}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 86400000);
}

function isHighSeasonMonth(month: number) {
  // Février, Juillet, Août, Décembre
  return month === 2 || month === 7 || month === 8 || month === 12;
}

function applyHighSeasonCheckinCheckout(dateDebut: string | Date, dateFin: string | Date) {
  const startIso = toIsoDay(dateDebut);
  const endIso = toIsoDay(dateFin);
  if (!startIso || !endIso) {
    return { startDate: new Date(dateDebut), endDate: new Date(dateFin) };
  }
  const highSeason = isHighSeasonMonth(Number(startIso.slice(5, 7))) || isHighSeasonMonth(Number(endIso.slice(5, 7)));
  const weeklySaturday = isSaturdayIso(startIso) && isSaturdayIso(endIso) && diffDays(startIso, endIso) === 7;
  if (!highSeason || !weeklySaturday) {
    return { startDate: new Date(dateDebut), endDate: new Date(dateFin) };
  }
  // Haute saison: check-in samedi 15:00, check-out samedi 10:00
  return {
    startDate: new Date(`${startIso}T15:00:00.000Z`),
    endDate: new Date(`${endIso}T10:00:00.000Z`),
  };
}


async function signCustomerSession(email: string) {
  const secret = new TextEncoder().encode(ENV.cookieSecret || "dev-secret");
  return await new SignJWT({ email, type: "customer" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

// Créer une demande de réservation (simple, sans paiement)
router.post("/request", async (req, res) => {
  try {
    const {
      nomClient,
      prenomClient,
      emailClient,
      telClient,
      nbPersonnes,
      formule,
      destination,
      dateDebut,
      dateFin,
      montantTotal, // en centimes
      typeReservation, // "bateau_entier" | "cabine" | "place"
      nbCabines, // nombre de cabines ou places réservées
      message,
      disponibiliteId,
      bookingOrigin,
      simpleRequest,
    } = req.body;

    const isSimpleRequest = Boolean(simpleRequest);
    if (!nomClient || !emailClient || !dateDebut || !dateFin) {
      return res.status(400).json({ error: "Données manquantes" });
    }

    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }

    const normalizedEmail = String(emailClient).trim().toLowerCase();
    const parsedNbPersonnes = Math.max(1, parseInt(nbPersonnes) || 1);
    const normalizedTypeReservation: "bateau_entier" | "cabine" | "place" =
      typeReservation === "cabine" || typeReservation === "place" ? typeReservation : "bateau_entier";
    const computedNbCabines =
      normalizedTypeReservation === "cabine"
        ? Math.max(1, Math.ceil(parsedNbPersonnes / 2))
        : normalizedTypeReservation === "place"
          ? Math.max(1, parsedNbPersonnes)
        : Math.max(1, parseInt(nbCabines) || 1);

    const customerRows = await db.select().from(customers).where(eq(customers.email, normalizedEmail)).limit(1);
    let customerId = customerRows[0]?.id;
    let createdPassword: string | null = null;
    if (!customerId) {
      createdPassword = generateCustomerPassword(12);
      const passwordHash = await hashCustomerPassword(createdPassword);
      const insertedCustomer = await db
        .insert(customers)
        .values({
          email: normalizedEmail,
          firstName: String(nomClient).split(" ")[0] || null,
          lastName: String(nomClient).split(" ").slice(1).join(" ") || null,
          phone: telClient || null,
          authMethod: "password",
          passwordHash,
        })
        .returning({ id: customers.id });
      customerId = insertedCustomer[0]?.id;
    } else if (!customerRows[0]?.passwordHash) {
      createdPassword = generateCustomerPassword(12);
      const passwordHash = await hashCustomerPassword(createdPassword);
      await db
        .update(customers)
        .set({
          passwordHash,
          authMethod: "password",
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerRows[0].id));
    }

    if (createdPassword) {
      try {
        const origin = `${req.protocol}://${req.get("host")}`;
        await sendCustomerPasswordEmail(normalizedEmail, createdPassword, origin);
      } catch (mailError: any) {
        console.warn("[Reservations] Email mot de passe non envoyé:", mailError?.message || mailError);
      }
    }

    const parsedDisponibiliteIdRaw =
      disponibiliteId !== null && disponibiliteId !== undefined ? parseInt(disponibiliteId, 10) : null;

    const selectedDispoForPolicy =
      parsedDisponibiliteIdRaw && Number.isFinite(parsedDisponibiliteIdRaw)
        ? await db.select().from(disponibilites).where(eq(disponibilites.id, parsedDisponibiliteIdRaw)).limit(1)
        : [];
    const effectiveDestination = destination || selectedDispoForPolicy[0]?.destination || "";
    const isCalendarBoundRequest = !isSimpleRequest && parsedDisponibiliteIdRaw && Number.isFinite(parsedDisponibiliteIdRaw);
    if (isCalendarBoundRequest) {
      const policyCheck = validateReservationPolicy({
        dateDebut,
        dateFin,
        destination: effectiveDestination,
        typeReservation: normalizedTypeReservation,
        nbCabines: normalizedTypeReservation === "cabine" ? computedNbCabines : null,
      });
      if (!policyCheck.ok) {
        return res.status(400).json({ error: policyCheck.reason });
      }
    }
    const normalizedSchedule = applyHighSeasonCheckinCheckout(dateDebut, dateFin);
    const resolvedBookingOrigin = inferBookingOriginFromRequest({ bookingOrigin, emailClient, message });

    const parsedDisponibiliteId = isSimpleRequest
      ? null
      : await resolveDisponibiliteIdForReservation(db, {
          disponibiliteId: parsedDisponibiliteIdRaw,
          dateDebut,
          dateFin,
        });

    let isAdminRequester = false;
    try {
      const authUser = await sdk.authenticateRequest(req);
      isAdminRequester = authUser?.role === "admin";
    } catch {
      isAdminRequester = false;
    }

    const finalFormule = String(formule || (isSimpleRequest ? "semaine" : "")).trim();
    const finalDestination = String(destination || (isSimpleRequest ? "A définir" : "")).trim();
    const parsedMontantTotal = Number(montantTotal);
    const finalMontantTotal = Number.isFinite(parsedMontantTotal) && parsedMontantTotal > 0 ? parsedMontantTotal : 100;

    let reservationId: number | undefined;
    await db.transaction(async (tx: any) => {
      if (parsedDisponibiliteId) {
        await lockDisponibiliteForCapacity(tx, parsedDisponibiliteId);
        const { totalUnits } = await getConfirmedBookingUsage(tx, parsedDisponibiliteId);
        const selectedDispo = await tx.select().from(disponibilites).where(eq(disponibilites.id, parsedDisponibiliteId)).limit(1);
        const isDayTrip = Boolean(selectedDispo[0] && new Date(selectedDispo[0].debut).toISOString().slice(0, 10) === new Date(selectedDispo[0].fin).toISOString().slice(0, 10));
        const isTransat = String(selectedDispo[0]?.destination || "").toLowerCase().includes("transat");
        const maxPeople = isTransat ? 4 : isDayTrip ? 12 : 8;
        if (parsedNbPersonnes > maxPeople) throw new Error(`Maximum ${maxPeople} personnes sur cette période.`);
        const sameSlotReservations = await listReservationsByDisponibiliteSafe(tx, parsedDisponibiliteId);
        const activeReservations = isAdminRequester
          ? sameSlotReservations.filter((r: any) => isActiveReservationForCapacity(r))
          : sameSlotReservations.filter((r: any) => CAPACITY_BLOCKING_WORKFLOW.includes(String(r.workflowStatut || "")));
        const hasPrivate = activeReservations.some((r: any) => r.typeReservation === "bateau_entier");
        const reservedUnits = hasPrivate
          ? totalUnits
          : activeReservations
              .filter((r: any) => r.typeReservation === "cabine" || r.typeReservation === "place")
              .reduce((sum: number, r: any) => sum + Math.max(1, r.nbCabines || 1), 0);
        if (hasPrivate && (normalizedTypeReservation === "cabine" || normalizedTypeReservation === "place")) {
          throw new Error("Cette période est déjà privatisée.");
        }
        if (normalizedTypeReservation === "bateau_entier" && reservedUnits > 0) {
          throw new Error("Cette période a déjà des options/réservations en cours. Privatisation impossible.");
        }
        if (normalizedTypeReservation === "cabine" || normalizedTypeReservation === "place") {
          const nextReserved = reservedUnits + computedNbCabines;
          if (nextReserved > totalUnits) {
            const remaining = Math.max(0, totalUnits - reservedUnits);
            throw new Error(`Il ne reste pas assez de cabines disponibles (${remaining} restante(s)).`);
          }
        }
      }
      const baseInsertPayload: any = {
        nomClient,
        prenomClient: prenomClient || null,
        emailClient,
        customerId: customerId || null,
        telClient: telClient || null,
        nbPersonnes: parsedNbPersonnes,
        formule: finalFormule,
        destination: finalDestination,
        dateDebut: isSimpleRequest ? new Date(dateDebut) : normalizedSchedule.startDate,
        dateFin: isSimpleRequest ? new Date(dateFin) : normalizedSchedule.endDate,
        montantTotal: finalMontantTotal,
        typePaiement: "acompte",
        montantPaye: 0,
        typeReservation: normalizedTypeReservation,
        nbCabines: computedNbCabines,
        message: message || null,
        requestStatus: isAdminRequester ? "validee" : "nouvelle",
        disponibiliteId: parsedDisponibiliteId || null,
        statutPaiement: "en_attente",
      };
      if (await supportsBookingOriginColumn(tx)) {
        baseInsertPayload.bookingOrigin = resolvedBookingOrigin;
      }
      let inserted;
      try {
        inserted = await tx.insert(reservations).values(baseInsertPayload).returning({ id: reservations.id });
      } catch (insertError: any) {
        if (!isMissingBookingOriginColumnError(insertError)) throw insertError;
        bookingOriginColumnAvailable = false;
        const { bookingOrigin: _ignored, ...fallbackPayload } = baseInsertPayload;
        const fallbackId = await insertReservationWithoutBookingOrigin(tx, fallbackPayload);
        inserted = [{ id: fallbackId }];
      }
      reservationId = inserted[0]?.id;
      if (parsedDisponibiliteId) await refreshDisponibiliteBookingState(tx, parsedDisponibiliteId);
    });

    // Ne pas incrémenter cabinesReservees ici:
    // une "demande" ne doit pas bloquer le planning tant qu'elle n'est pas confirmée.

    // Notifier le propriétaire
    const typeResLabels: Record<string, string> = {
      bateau_entier: "Bateau entier",
      cabine: `${computedNbCabines} cabine(s) double(s)`,
      place: `${computedNbCabines} place(s)`,
    };
    const typeResLabel = typeResLabels[normalizedTypeReservation] || "Bateau entier";

    const formuleLabels: Record<string, string> = {
      journee: "Journée catamaran",
      weekend: "Week-end catamaran",
      semaine: "Semaine catamaran",
      traversee: "Traversée Atlantique",
    };

    try {
      await notifyOwner({
        title: `Nouvelle demande de réservation — ${nomClient}`,
        content: `
Nouvelle demande reçue :

**Client:** ${nomClient}
**Email:** ${emailClient}
**Téléphone:** ${telClient || "Non fourni"}
**Nombre de personnes:** ${nbPersonnes}

**Croisière:**
- Destination: ${finalDestination}
- Formule: ${formuleLabels[finalFormule] || finalFormule}
- Type: ${typeResLabel}
- Dates: ${new Date(dateDebut).toLocaleDateString("fr-FR")} → ${new Date(dateFin).toLocaleDateString("fr-FR")}
- Montant estimé: ${(finalMontantTotal / 100).toLocaleString("fr-FR")} €

**Message:** ${message || "Aucun message"}

Accédez à l'admin pour consulter et envoyer un devis.
        `,
      });
    } catch (notifyError: any) {
      console.warn("[Reservations] Notification non envoyée:", notifyError?.message || notifyError);
    }

    const jwt = await signCustomerSession(normalizedEmail);
    res.cookie(CUSTOMER_COOKIE, jwt, getSessionCookieOptions(req));

    res.json({ 
      success: true, 
      reservationId,
      message: "Demande de réservation envoyée avec succès" 
    });
  } catch (error: any) {
    if (String(error?.message || "").includes("période") || String(error?.message || "").includes("Maximum ")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("[Reservations] Erreur lors de la création de la demande:", error);
    res.status(500).json({ error: error.message || "Erreur lors de l'envoi de la demande" });
  }
});

// Lister toutes les réservations (admin)
router.get("/", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }
    const all = await listReservationsSafe(db);
    res.json(all);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/origins-summary", requireAdmin, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }
    const all = await listReservationsSafe(db);
    const totals: Record<BookingOrigin, { count: number; revenueCents: number; source: "local" | "clicknboat_api" }> = {
      direct: { count: 0, revenueCents: 0, source: "local" },
      clicknboat: { count: 0, revenueCents: 0, source: "local" },
      skippair: { count: 0, revenueCents: 0, source: "local" },
      samboat: { count: 0, revenueCents: 0, source: "local" },
    };
    all.forEach((r: any) => {
      const origin = normalizeBookingOrigin(r.bookingOrigin);
      totals[origin].count += 1;
      totals[origin].revenueCents += Number(r.montantTotal || 0);
    });

    const clicknboat = await fetchClicknboatSummary();
    if (clicknboat.data) {
      totals.clicknboat = {
        count: clicknboat.data.count,
        revenueCents: clicknboat.data.revenueCents,
        source: "clicknboat_api",
      };
    }

    return res.json({
      origins: totals,
      clicknboatIntegration: {
        enabled: clicknboat.enabled,
        usingLiveData: Boolean(clicknboat.data),
        warning: clicknboat.warning,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Erreur lors du calcul des origines" });
  }
});

// Récupérer une réservation par ID
router.get("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }
    const reservation = await listReservationsByIdSafe(db, parseInt(id));
    if (!reservation.length) {
      return res.status(404).json({ error: "Réservation non trouvée" });
    }
    res.json(reservation[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Modifier une réservation (admin)
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nomClient,
      prenomClient,
      emailClient,
      telClient,
      nbPersonnes,
      formule,
      destination,
      dateDebut,
      dateFin,
      montantTotal,
      typeReservation,
      nbCabines,
      message,
      disponibiliteId,
      bookingOrigin,
      statutPaiement,
      workflowStatut,
      requestStatus,
      internalComment,
      archivedAt,
    } = req.body;

    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }

    // Vérifier que la réservation existe
    const existing = await listReservationsByIdSafe(db, parseInt(id));
    if (!existing.length) {
      return res.status(404).json({ error: "Réservation non trouvée" });
    }

    // Mettre à jour la réservation
    const parsedNbPersonnes = nbPersonnes !== undefined ? Math.max(1, parseInt(nbPersonnes)) : existing[0].nbPersonnes;

    const resolvedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, {
      disponibiliteId:
        disponibiliteId !== undefined
          ? disponibiliteId !== null
            ? parseInt(disponibiliteId)
            : null
          : existing[0].disponibiliteId,
      dateDebut: dateDebut ? String(dateDebut) : new Date(existing[0].dateDebut).toISOString(),
      dateFin: dateFin ? String(dateFin) : new Date(existing[0].dateFin).toISOString(),
    });

    const selectedDispoForPolicy =
      resolvedDisponibiliteId && Number.isFinite(resolvedDisponibiliteId)
        ? await db.select().from(disponibilites).where(eq(disponibilites.id, resolvedDisponibiliteId)).limit(1)
        : [];
    const effectiveDateDebut = dateDebut ? String(dateDebut) : new Date(existing[0].dateDebut).toISOString();
    const effectiveDateFin = dateFin ? String(dateFin) : new Date(existing[0].dateFin).toISOString();
    const effectiveDestination = destination || selectedDispoForPolicy[0]?.destination || existing[0].destination || "";
    const selectedTypeReservation: "bateau_entier" | "cabine" | "place" =
      typeReservation === "cabine" || typeReservation === "place" || typeReservation === "bateau_entier"
        ? typeReservation
        : (existing[0].typeReservation as any);
    const selectedNbCabines =
      selectedTypeReservation === "cabine"
        ? Math.max(1, Math.ceil(parsedNbPersonnes / 2))
        : selectedTypeReservation === "place"
          ? Math.max(1, parsedNbPersonnes)
          : nbCabines !== undefined
            ? Math.max(1, parseInt(nbCabines))
            : Math.max(1, existing[0].nbCabines || 1);
    const policyCheck = validateReservationPolicy({
      dateDebut: effectiveDateDebut,
      dateFin: effectiveDateFin,
      destination: effectiveDestination,
      typeReservation: selectedTypeReservation,
      nbCabines: selectedTypeReservation === "cabine" ? selectedNbCabines : null,
    });
    if (!policyCheck.ok) {
      return res.status(400).json({ error: policyCheck.reason });
    }
    const normalizedSchedule = applyHighSeasonCheckinCheckout(effectiveDateDebut, effectiveDateFin);

    const updatePayload: any = {
      nomClient: nomClient || existing[0].nomClient,
      prenomClient: prenomClient !== undefined ? prenomClient : existing[0].prenomClient,
      emailClient: emailClient || existing[0].emailClient,
      telClient: telClient !== undefined ? telClient : existing[0].telClient,
      nbPersonnes: parsedNbPersonnes,
      formule: formule || existing[0].formule,
      destination: destination || existing[0].destination,
      dateDebut: dateDebut ? normalizedSchedule.startDate : existing[0].dateDebut,
      dateFin: dateFin ? normalizedSchedule.endDate : existing[0].dateFin,
      montantTotal: montantTotal !== undefined ? montantTotal : existing[0].montantTotal,
      typeReservation: typeReservation || existing[0].typeReservation,
      nbCabines: nbCabines !== undefined ? parseInt(nbCabines) : existing[0].nbCabines,
      message: message !== undefined ? message : existing[0].message,
      disponibiliteId: resolvedDisponibiliteId,
      statutPaiement: statutPaiement || existing[0].statutPaiement,
      workflowStatut: workflowStatut || existing[0].workflowStatut,
      requestStatus: requestStatus || existing[0].requestStatus,
      internalComment: internalComment !== undefined ? internalComment : existing[0].internalComment,
      archivedAt:
        archivedAt !== undefined
          ? archivedAt
            ? new Date(archivedAt)
            : null
          : (requestStatus || existing[0].requestStatus) === "archivee"
            ? existing[0].archivedAt || new Date()
            : existing[0].archivedAt,
      updatedAt: new Date(),
    };
    if (await supportsBookingOriginColumn(db)) {
      updatePayload.bookingOrigin =
        bookingOrigin !== undefined ? normalizeBookingOrigin(bookingOrigin) : (existing[0] as any).bookingOrigin || "direct";
    }
    await db.transaction(async (tx: any) => {
      const idsToLock = Array.from(new Set([existing[0].disponibiliteId, resolvedDisponibiliteId].filter((v): v is number => Boolean(v)))).sort((a, b) => a - b);
      for (const dispoId of idsToLock) {
        await lockDisponibiliteForCapacity(tx, dispoId);
      }

      if (resolvedDisponibiliteId) {
        const { totalUnits } = await getConfirmedBookingUsage(tx, resolvedDisponibiliteId);
        const selectedDispo = await tx.select().from(disponibilites).where(eq(disponibilites.id, resolvedDisponibiliteId)).limit(1);
        const isDayTrip = Boolean(selectedDispo[0] && new Date(selectedDispo[0].debut).toISOString().slice(0, 10) === new Date(selectedDispo[0].fin).toISOString().slice(0, 10));
        const isTransat = String(selectedDispo[0]?.destination || "").toLowerCase().includes("transat");
        const maxPeople = isTransat ? 4 : isDayTrip ? 12 : 8;
        if (parsedNbPersonnes > maxPeople) throw new Error(`Maximum ${maxPeople} personnes sur cette période.`);
        const sameSlotReservations = await listReservationsByDisponibiliteSafe(tx, resolvedDisponibiliteId);
        const otherActiveReservations = sameSlotReservations.filter((r: any) => r.id !== existing[0].id && isActiveReservationForCapacity(r));
        const hasPrivate = otherActiveReservations.some((r: any) => r.typeReservation === "bateau_entier");
        const reservedUnits = hasPrivate
          ? totalUnits
          : otherActiveReservations
              .filter((r: any) => r.typeReservation === "cabine" || r.typeReservation === "place")
              .reduce((sum: number, r: any) => sum + Math.max(1, r.nbCabines || 1), 0);
        if (hasPrivate && (selectedTypeReservation === "cabine" || selectedTypeReservation === "place")) {
          throw new Error("Cette période est déjà privatisée.");
        }
        if (selectedTypeReservation === "bateau_entier" && reservedUnits > 0) {
          throw new Error("Cette période a déjà des options/réservations en cours. Privatisation impossible.");
        }
        if (selectedTypeReservation === "cabine" || selectedTypeReservation === "place") {
          const nextReserved = reservedUnits + selectedNbCabines;
          if (nextReserved > totalUnits) {
            const remaining = Math.max(0, totalUnits - reservedUnits);
            throw new Error(`Il ne reste pas assez de cabines disponibles (${remaining} restante(s)).`);
          }
        }
      }

      try {
        await tx.update(reservations).set(updatePayload).where(eq(reservations.id, parseInt(id)));
      } catch (updateError: any) {
        if (!isMissingBookingOriginColumnError(updateError) || !("bookingOrigin" in updatePayload)) throw updateError;
        bookingOriginColumnAvailable = false;
        const { bookingOrigin: _ignored, ...fallbackPayload } = updatePayload;
        await tx.update(reservations).set(fallbackPayload).where(eq(reservations.id, parseInt(id)));
      }

      const disponibilitesToRefresh = new Set<number>();
      if (existing[0].disponibiliteId) disponibilitesToRefresh.add(existing[0].disponibiliteId);
      if (resolvedDisponibiliteId) disponibilitesToRefresh.add(resolvedDisponibiliteId);
      for (const dispoId of Array.from(disponibilitesToRefresh)) {
        await refreshDisponibiliteBookingState(tx, dispoId);
      }
    });

    res.json({ success: true, message: "Réservation mise à jour" });
  } catch (error: any) {
    if (String(error?.message || "").includes("période") || String(error?.message || "").includes("Maximum ")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("[Reservations] Erreur lors de la mise à jour:", error);
    res.status(500).json({ error: error.message || "Erreur lors de la mise à jour" });
  }
});

// Envoyer une confirmation au client
router.post("/send-confirmation", requireAdmin, async (req, res) => {
  try {
    const { reservationId } = req.body;
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }

    const reservation = await listReservationsByIdSafe(db, parseInt(reservationId));
    if (!reservation.length) {
      return res.status(404).json({ error: "Réservation non trouvée" });
    }

    const r = reservation[0];

    // En dev/local, le service de notification peut ne pas être configuré.
    // On ne bloque pas l'action de validation pour ce motif.
    try {
      await notifyOwner({
        title: `Confirmation envoyée à ${r.nomClient}`,
        content: `
Confirmation de réservation envoyée au client :

**Client:** ${r.nomClient}
**Email:** ${r.emailClient}
**Montant:** ${(r.montantTotal / 100).toLocaleString("fr-FR")} €
**Dates:** ${new Date(r.dateDebut).toLocaleDateString("fr-FR")} → ${new Date(r.dateFin).toLocaleDateString("fr-FR")}
        `,
      });
      res.json({ success: true, message: "Confirmation envoyée au client" });
    } catch (notifyError: any) {
      console.warn("[Reservations] Notification non envoyée:", notifyError?.message || notifyError);
      res.json({
        success: true,
        message: "Validation effectuée (notification non configurée).",
        warning: notifyError?.message || "Service notification indisponible",
      });
    }
  } catch (error: any) {
    console.error("[Reservations] Erreur lors de l'envoi de confirmation:", error);
    res.status(500).json({ error: error.message || "Erreur lors de l'envoi" });
  }
});

// Supprimer une réservation (admin)
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }

    // Vérifier que la réservation existe
    const existing = await listReservationsByIdSafe(db, parseInt(id));
    if (!existing.length) {
      return res.status(404).json({ error: "Réservation non trouvée" });
    }

    const reservationToDelete = existing[0];
    const linkedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, reservationToDelete);
    // Supprimer la réservation
    await db.delete(reservations).where(eq(reservations.id, parseInt(id)));
    if (linkedDisponibiliteId) {
      await refreshDisponibiliteBookingState(db, linkedDisponibiliteId);
    }

    res.json({ success: true, message: "Réservation supprimée" });
  } catch (error: any) {
    console.error("[Reservations] Erreur lors de la suppression:", error);
    res.status(500).json({ error: error.message || "Erreur lors de la suppression" });
  }
});

export default router;
