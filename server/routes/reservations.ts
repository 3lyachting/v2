import { Router } from "express";
import { eq } from "drizzle-orm";
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

const router = Router();
const CUSTOMER_COOKIE = "customer_session_id";

function isActiveReservationForCapacity(r: any) {
  const requestStatus = String(r?.requestStatus || "nouvelle");
  return requestStatus !== "refusee" && requestStatus !== "archivee";
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
    } = req.body;

    if (!nomClient || !emailClient || !montantTotal || !formule || !destination) {
      return res.status(400).json({ error: "Données manquantes" });
    }

    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Base de données non disponible" });
    }

    const normalizedEmail = String(emailClient).trim().toLowerCase();
    const parsedNbPersonnes = Math.max(1, parseInt(nbPersonnes) || 1);
    if (parsedNbPersonnes > 8) {
      return res.status(400).json({ error: "Maximum 8 personnes par semaine." });
    }
    const normalizedTypeReservation: "bateau_entier" | "cabine" | "place" =
      typeReservation === "cabine" || typeReservation === "place" ? typeReservation : "bateau_entier";
    const computedNbCabines =
      normalizedTypeReservation === "cabine"
        ? Math.max(1, Math.ceil(parsedNbPersonnes / 2))
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
    const parsedDisponibiliteId = await resolveDisponibiliteIdForReservation(db, {
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

    if (parsedDisponibiliteId) {
      const { totalUnits } = await getConfirmedBookingUsage(db, parsedDisponibiliteId);
      const sameSlotReservations = await db
        .select()
        .from(reservations)
        .where(eq(reservations.disponibiliteId, parsedDisponibiliteId));
      const activeReservations = isAdminRequester
        ? sameSlotReservations.filter((r: any) => isActiveReservationForCapacity(r))
        : sameSlotReservations.filter((r: any) =>
            ["validee_owner", "contrat_envoye", "contrat_signe", "acompte_confirme", "solde_confirme"].includes(String(r.workflowStatut || ""))
          );
      const hasPrivate = activeReservations.some((r: any) => r.typeReservation === "bateau_entier");
      const reservedUnits = hasPrivate
        ? totalUnits
        : activeReservations
            .filter((r: any) => r.typeReservation === "cabine" || r.typeReservation === "place")
            .reduce((sum: number, r: any) => sum + Math.max(1, r.nbCabines || 1), 0);

      if (hasPrivate && (normalizedTypeReservation === "cabine" || normalizedTypeReservation === "place")) {
        return res.status(400).json({ error: "Ce créneau est déjà privatisé." });
      }
      if (normalizedTypeReservation === "bateau_entier" && reservedUnits > 0) {
        return res
          .status(400)
          .json({ error: "Ce créneau a déjà des options/réservations en cours. Privatisation impossible." });
      }
      if (normalizedTypeReservation === "cabine" || normalizedTypeReservation === "place") {
        const nextReserved = reservedUnits + computedNbCabines;
        if (nextReserved > totalUnits) {
          const remaining = Math.max(0, totalUnits - reservedUnits);
          return res
            .status(400)
            .json({ error: `Il ne reste pas assez de cabines disponibles (${remaining} restante(s)).` });
        }
      }
    }

    // Créer la réservation en base (en attente de devis)
    const inserted = await db.insert(reservations).values({
      nomClient,
      prenomClient: prenomClient || null,
      emailClient,
      customerId: customerId || null,
      telClient: telClient || null,
      nbPersonnes: parsedNbPersonnes,
      formule,
      destination,
      dateDebut: new Date(dateDebut),
      dateFin: new Date(dateFin),
      montantTotal,
      typePaiement: "acompte", // Par défaut acompte
      montantPaye: 0, // Sera défini lors du devis
      typeReservation: normalizedTypeReservation,
      nbCabines: computedNbCabines,
      message: message || null,
      requestStatus: isAdminRequester ? "validee" : "nouvelle",
      disponibiliteId: parsedDisponibiliteId || null,
      statutPaiement: "en_attente", // En attente de devis
    }).returning({ id: reservations.id });

    const reservationId = inserted[0]?.id;

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
- Destination: ${destination}
- Formule: ${formuleLabels[formule] || formule}
- Type: ${typeResLabel}
- Dates: ${new Date(dateDebut).toLocaleDateString("fr-FR")} → ${new Date(dateFin).toLocaleDateString("fr-FR")}
- Montant estimé: ${(montantTotal / 100).toLocaleString("fr-FR")} €

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
    const all = await db.select().from(reservations).orderBy(reservations.createdAt);
    res.json(all);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
    const reservation = await db.select().from(reservations).where(
      eq(reservations.id, parseInt(id))
    );
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
    const existing = await db.select().from(reservations).where(
      eq(reservations.id, parseInt(id))
    );
    if (!existing.length) {
      return res.status(404).json({ error: "Réservation non trouvée" });
    }

    // Mettre à jour la réservation
    const parsedNbPersonnes = nbPersonnes !== undefined ? Math.max(1, parseInt(nbPersonnes)) : existing[0].nbPersonnes;
    if (parsedNbPersonnes > 8) {
      return res.status(400).json({ error: "Maximum 8 personnes par semaine." });
    }

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

    const selectedTypeReservation: "bateau_entier" | "cabine" | "place" =
      typeReservation === "cabine" || typeReservation === "place" || typeReservation === "bateau_entier"
        ? typeReservation
        : (existing[0].typeReservation as any);
    const selectedNbCabines = nbCabines !== undefined ? Math.max(1, parseInt(nbCabines)) : Math.max(1, existing[0].nbCabines || 1);

    if (resolvedDisponibiliteId) {
      const { totalUnits } = await getConfirmedBookingUsage(db, resolvedDisponibiliteId);
      const sameSlotReservations = await db
        .select()
        .from(reservations)
        .where(eq(reservations.disponibiliteId, resolvedDisponibiliteId));
      const otherActiveReservations = sameSlotReservations.filter(
        (r: any) => r.id !== existing[0].id && isActiveReservationForCapacity(r)
      );
      const hasPrivate = otherActiveReservations.some((r: any) => r.typeReservation === "bateau_entier");
      const reservedUnits = hasPrivate
        ? totalUnits
        : otherActiveReservations
            .filter((r: any) => r.typeReservation === "cabine" || r.typeReservation === "place")
            .reduce((sum: number, r: any) => sum + Math.max(1, r.nbCabines || 1), 0);

      if (hasPrivate && (selectedTypeReservation === "cabine" || selectedTypeReservation === "place")) {
        return res.status(400).json({ error: "Ce créneau est déjà privatisé." });
      }
      if (selectedTypeReservation === "bateau_entier" && reservedUnits > 0) {
        return res
          .status(400)
          .json({ error: "Ce créneau a déjà des options/réservations en cours. Privatisation impossible." });
      }
      if (selectedTypeReservation === "cabine" || selectedTypeReservation === "place") {
        const nextReserved = reservedUnits + selectedNbCabines;
        if (nextReserved > totalUnits) {
          const remaining = Math.max(0, totalUnits - reservedUnits);
          return res
            .status(400)
            .json({ error: `Il ne reste pas assez de cabines disponibles (${remaining} restante(s)).` });
        }
      }
    }

    await db.update(reservations).set({
      nomClient: nomClient || existing[0].nomClient,
      prenomClient: prenomClient !== undefined ? prenomClient : existing[0].prenomClient,
      emailClient: emailClient || existing[0].emailClient,
      telClient: telClient !== undefined ? telClient : existing[0].telClient,
      nbPersonnes: parsedNbPersonnes,
      formule: formule || existing[0].formule,
      destination: destination || existing[0].destination,
      dateDebut: dateDebut ? new Date(dateDebut) : existing[0].dateDebut,
      dateFin: dateFin ? new Date(dateFin) : existing[0].dateFin,
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
    }).where(eq(reservations.id, parseInt(id)));

    // Recalculer les 2 créneaux (ancien + nouveau) après déplacement de réservation.
    // Sinon l'ancien créneau peut rester bloqué visuellement.
    const disponibilitesToRefresh = new Set<number>();
    if (existing[0].disponibiliteId) disponibilitesToRefresh.add(existing[0].disponibiliteId);
    if (resolvedDisponibiliteId) disponibilitesToRefresh.add(resolvedDisponibiliteId);
    for (const dispoId of Array.from(disponibilitesToRefresh)) {
      await refreshDisponibiliteBookingState(db, dispoId);
    }

    res.json({ success: true, message: "Réservation mise à jour" });
  } catch (error: any) {
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

    const reservation = await db.select().from(reservations).where(
      eq(reservations.id, parseInt(reservationId))
    );
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
    const existing = await db.select().from(reservations).where(
      eq(reservations.id, parseInt(id))
    );
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
