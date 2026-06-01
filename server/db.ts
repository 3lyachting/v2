import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { InsertUser, users, cabinesReservees } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
      });
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

/**
 * Si la table n’existe pas sur la base pointée par DATABASE_URL (migrations oubliées, mauvais shell, etc.),
 * on la crée au démarrage pour que le backoffice « Comptes » fonctionne sans intervention manuelle.
 */
export async function ensureBackofficeLocalAccountsTable(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "backoffice_local_accounts" (
        "id" serial PRIMARY KEY NOT NULL,
        "email" varchar(320) NOT NULL,
        "passwordHash" text NOT NULL,
        "role" varchar(20) NOT NULL,
        "createdAt" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "backoffice_local_accounts_email_unique" UNIQUE("email")
      )
    `);
    await db.execute(sql`
      ALTER TABLE IF EXISTS "backoffice_local_accounts" DISABLE ROW LEVEL SECURITY
    `);
    console.log("[Database] Table backoffice_local_accounts vérifiée / créée si besoin.");
  } catch (e) {
    console.warn("[Database] ensureBackofficeLocalAccountsTable:", (e as Error)?.message || e);
  }
}

/** Valeur enum prod (Render) si la migration 0009 n’a pas encore été appliquée. */
export async function ensureBoataroundBookingOrigin(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(
      sql`ALTER TYPE "public"."booking_origin" ADD VALUE IF NOT EXISTS 'boataround'`
    );
    console.log("[Database] booking_origin « boataround » vérifié.");
  } catch (e) {
    console.warn(
      "[Database] ensureBoataroundBookingOrigin:",
      (e as Error)?.message || e
    );
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Récupère ou crée un enregistrement de cabines réservées pour une disponibilité
 */
export async function getOrCreateCabinesReservees(
  db: any,
  disponibiliteId: number,
  nbTotal: number = 4
) {
  let result = await db
    .select()
    .from(cabinesReservees)
    .where(eq(cabinesReservees.disponibiliteId, disponibiliteId))
    .limit(1);

  if (result.length === 0) {
    await db.insert(cabinesReservees).values({
      disponibiliteId,
      nbReservees: 0,
      nbTotal,
    });
    result = await db
      .select()
      .from(cabinesReservees)
      .where(eq(cabinesReservees.disponibiliteId, disponibiliteId))
      .limit(1);
  }

  return result[0];
}

/**
 * Met à jour le nombre de cabines réservées
 */
export async function updateCabinesReservees(
  db: any,
  disponibiliteId: number,
  nbReservees: number,
  notes?: string
) {
  return db
    .update(cabinesReservees)
    .set({
      nbReservees,
      notes,
      updatedAt: new Date(),
    })
    .where(eq(cabinesReservees.disponibiliteId, disponibiliteId));
}

/**
 * Récupère les cabines réservées pour une disponibilité
 */
export async function getCabinesReservees(db: any, disponibiliteId: number) {
  const result = await db
    .select()
    .from(cabinesReservees)
    .where(eq(cabinesReservees.disponibiliteId, disponibiliteId))
    .limit(1);
  return result[0] || null;
}
