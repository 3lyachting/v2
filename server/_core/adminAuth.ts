import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { backofficeLocalAccounts } from "../../drizzle/schema";
import { getDb } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

const scrypt = promisify(_scrypt);

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export async function verifyScryptPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = (storedHash || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export function registerAdminAuthRoutes(app: Express) {
  const isDevAdminBypass =
    process.env.NODE_ENV === "development" &&
    process.env.ADMIN_AUTH_BYPASS === "true";

  app.post("/api/admin-auth/local-login", async (req: Request, res: Response) => {
    try {
      const configuredEmail = normalizeEmail(process.env.ADMIN_EMAIL);
      const configuredHash = String(process.env.ADMIN_PASSWORD_HASH || "").trim();
      const configuredPlain = String(process.env.ADMIN_PASSWORD_PLAIN || "");
      const viewerEmail = normalizeEmail(process.env.BACKOFFICE_VIEWER_EMAIL);
      const viewerHash = String(process.env.BACKOFFICE_VIEWER_PASSWORD_HASH || "").trim();
      const viewerPlain = String(process.env.BACKOFFICE_VIEWER_PASSWORD_PLAIN || "");
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");

      if (
        (!configuredEmail || (!configuredHash && !configuredPlain)) &&
        (!viewerEmail || (!viewerHash && !viewerPlain))
      ) {
        return res.status(500).json({
          error:
            "Configurez un compte admin ou viewer: ADMIN_EMAIL + mot de passe, ou BACKOFFICE_VIEWER_EMAIL + mot de passe.",
        });
      }

      if (!email || !password) {
        return res.status(400).json({ error: "Email et mot de passe requis." });
      }

      let sessionOpenId: string | null = null;
      let sessionName = "Backoffice";

      if (email === configuredEmail && (configuredPlain || configuredHash)) {
        const ok = configuredPlain
          ? password === configuredPlain
          : await verifyScryptPassword(password, configuredHash);
        if (ok) {
          sessionOpenId = "local-admin";
          sessionName = "Admin Local";
        }
      } else if (email === viewerEmail && (viewerPlain || viewerHash)) {
        const ok = viewerPlain
          ? password === viewerPlain
          : await verifyScryptPassword(password, viewerHash);
        if (ok) {
          sessionOpenId = "local-viewer";
          sessionName = "Backoffice Consultation";
        }
      }

      if (!sessionOpenId) {
        const db = await getDb();
        if (db) {
          const rows = await db
            .select()
            .from(backofficeLocalAccounts)
            .where(eq(backofficeLocalAccounts.email, email))
            .limit(1);
          const acc = rows[0];
          if (acc?.passwordHash) {
            const ok = await verifyScryptPassword(password, acc.passwordHash);
            if (ok) {
              sessionOpenId = `backoffice-local:${acc.id}`;
              sessionName = acc.email;
            }
          }
        }
      }

      if (!sessionOpenId) {
        return res.status(401).json({ error: "Identifiants invalides." });
      }

      const sessionToken = await sdk.createSessionToken(sessionOpenId, {
        name: sessionName,
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Erreur login local" });
    }
  });

  app.post("/api/admin-auth/logout", async (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return res.json({ success: true });
  });

  app.get("/api/admin-auth/me", async (req: Request, res: Response) => {
    if (isDevAdminBypass) {
      return res.json({
        id: "local-admin",
        openId: "local-admin",
        name: "Admin Local",
        email: String(process.env.ADMIN_EMAIL || "admin@local.test"),
        role: "admin",
      });
    }
    try {
      const user = await sdk.authenticateRequest(req);
      if (user.role !== "admin" && (user as any).role !== "viewer") {
        return res.status(403).json({ error: "Accès backoffice requis" });
      }
      return res.json({
        id: user.id,
        openId: user.openId,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch {
      return res.status(401).json({ error: "Authentification requise" });
    }
  });
}
