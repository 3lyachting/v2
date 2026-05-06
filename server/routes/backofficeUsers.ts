import { Router } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  backofficeLocalAccounts,
  customers,
  users,
} from "../../drizzle/schema";
import { requireAdminExclusive } from "../_core/authz";
import { hashAdminPassword } from "../_core/adminAuth";
import { hashCustomerPassword } from "../_core/customerPassword";

const router = Router();

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function unwrapPgError(error: unknown): { code?: string; message: string; detail?: string } {
  const e: any = (error as any)?.cause ?? error;
  return {
    code: typeof e?.code === "string" ? e.code : undefined,
    message: String(e?.message || (error as any)?.message || error || "Erreur SQL"),
    detail: typeof e?.detail === "string" ? e.detail : undefined,
  };
}

router.get("/overview", requireAdminExclusive, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const viewerEmail = normalizeEmail(process.env.BACKOFFICE_VIEWER_EMAIL);

    const oauthAdmins = await db.select().from(users).where(eq(users.role, "admin"));

    let localRows: (typeof backofficeLocalAccounts.$inferSelect)[] = [];
    let backofficeLocalAccountsReady = false;
    try {
      localRows = await db.select().from(backofficeLocalAccounts);
      backofficeLocalAccountsReady = true;
    } catch (e) {
      console.warn(
        "[backoffice-users] backoffice_local_accounts :",
        (e as Error)?.message || e,
      );
    }

    const customerRows = await db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        phone: customers.phone,
        authMethod: customers.authMethod,
        passwordHash: customers.passwordHash,
        createdAt: customers.createdAt,
      })
      .from(customers);

    const admins: Array<Record<string, unknown>> = [];

    if (adminEmail && (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_PLAIN)) {
      admins.push({
        source: "environment",
        kind: "admin",
        email: adminEmail,
        label: "Compte principal (fichier .env)",
      });
    }
    if (
      viewerEmail &&
      (process.env.BACKOFFICE_VIEWER_PASSWORD_HASH || process.env.BACKOFFICE_VIEWER_PASSWORD_PLAIN)
    ) {
      admins.push({
        source: "environment",
        kind: "viewer",
        email: viewerEmail,
        label: "Consultation (fichier .env)",
      });
    }

    for (const row of oauthAdmins) {
      admins.push({
        source: "oauth",
        id: row.id,
        openId: row.openId,
        email: row.email,
        name: row.name,
        loginMethod: row.loginMethod,
        createdAt: row.createdAt,
        label: "OAuth / Manus (rôle admin en base)",
      });
    }

    for (const row of localRows) {
      admins.push({
        source: "database",
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt,
        label: "Compte créé depuis le backoffice",
      });
    }

    const customersOut = customerRows.map((c) => ({
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      authMethod: c.authMethod,
      hasPassword: Boolean(c.passwordHash),
      createdAt: c.createdAt,
    }));

    return res.json({
      admins,
      customers: customersOut,
      backofficeLocalAccountsReady,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur chargement des comptes" });
  }
});

router.post("/local-backoffice-account", requireAdminExclusive, async (req, res) => {
  try {
    const { email: rawEmail, password, role: rawRole } = req.body as {
      email?: string;
      password?: string;
      role?: string;
    };
    const email = normalizeEmail(rawEmail);
    const passwordStr = String(password || "");
    const role = String(rawRole || "").trim();

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Email invalide" });
    }
    if (passwordStr.length < 8) {
      return res.status(400).json({ error: "Mot de passe : minimum 8 caractères" });
    }
    if (role !== "admin" && role !== "viewer") {
      return res.status(400).json({ error: "Rôle invalide (admin ou viewer)" });
    }

    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const adminEnv = normalizeEmail(process.env.ADMIN_EMAIL);
    const viewerEnv = normalizeEmail(process.env.BACKOFFICE_VIEWER_EMAIL);
    if (adminEnv && email === adminEnv) {
      return res.status(409).json({
        error:
          "Cet email est celui du compte principal (.env). Utilisez un autre email pour un compte créé en base, ou connectez-vous avec ce compte .env.",
      });
    }
    if (viewerEnv && email === viewerEnv) {
      return res.status(409).json({
        error:
          "Cet email est celui du compte consultation (.env). Utilisez un autre email pour un compte créé en base.",
      });
    }

    const existingLocal = await db
      .select({ id: backofficeLocalAccounts.id })
      .from(backofficeLocalAccounts)
      .where(eq(backofficeLocalAccounts.email, email))
      .limit(1);
    if (existingLocal.length) {
      return res.status(409).json({ error: "Un compte backoffice avec cet email existe déjà en base." });
    }

    const hash = await hashAdminPassword(passwordStr);
    const inserted = await db
      .insert(backofficeLocalAccounts)
      .values({ email, passwordHash: hash, role })
      .returning({ id: backofficeLocalAccounts.id });

    return res.json({ success: true, id: inserted[0]?.id });
  } catch (error: any) {
    const pg = unwrapPgError(error);
    const msg = `${pg.message} ${pg.detail || ""}`.toLowerCase();
    if (pg.code === "23505" || msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ error: "Un compte avec cet email existe déjà" });
    }
    if (pg.code === "42P01" || msg.includes("does not exist")) {
      return res.status(503).json({
        error: "Table SQL manquante : sur le serveur, exécutez npm run db:migrate puis redémarrez.",
      });
    }
    if (pg.code === "42501" || msg.includes("permission denied")) {
      return res.status(503).json({
        error:
          "Permission PostgreSQL refusée (table ou séquence). Vérifiez que DATABASE_URL utilise le rôle « postgres » / service du projet, puis exécutez npm run db:migrate.",
        detail: pg.detail || pg.message,
      });
    }
    console.error("[backoffice-users] insert local account:", pg.code, pg.message, pg.detail || "");
    return res.status(500).json({
      error: pg.detail ? `${pg.message} (${pg.detail})` : pg.message,
    });
  }
});

router.post("/customer", requireAdminExclusive, async (req, res) => {
  try {
    const { email: rawEmail, password, firstName, lastName, phone } = req.body as {
      email?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
    };
    const email = normalizeEmail(rawEmail);
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Email invalide" });
    }

    const passwordStr = String(password || "").trim();
    if (passwordStr && passwordStr.length < 8) {
      return res.status(400).json({ error: "Mot de passe : minimum 8 caractères" });
    }

    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Base de données non disponible" });

    const existing = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
    if (existing.length) {
      return res.status(409).json({ error: "Un client avec cet email existe déjà" });
    }

    if (passwordStr) {
      const passwordHash = await hashCustomerPassword(passwordStr);
      const inserted = await db
        .insert(customers)
        .values({
          email,
          firstName: firstName?.trim() || null,
          lastName: lastName?.trim() || null,
          phone: phone?.trim() || null,
          authMethod: "password",
          passwordHash,
        })
        .returning({ id: customers.id });
      return res.json({
        success: true,
        id: inserted[0]?.id,
        authMethod: "password",
      });
    }

    const inserted = await db
      .insert(customers)
      .values({
        email,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        phone: phone?.trim() || null,
        authMethod: "magic_link",
      })
      .returning({ id: customers.id });

    return res.json({
      success: true,
      id: inserted[0]?.id,
      authMethod: "magic_link",
      hint: "Le client pourra se connecter via « lien magique » depuis la page espace client.",
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Erreur création client" });
  }
});

export default router;
