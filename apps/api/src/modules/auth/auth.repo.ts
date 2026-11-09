import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { users, refreshSessions, type Database } from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";

const safeUserColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export const getUserByEmail = async (email: string) => {
  const [user] = await db
    .select({ ...safeUserColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return user;
};

export const getUserById = async (userId: string) => {
  const [user] = await db.select(safeUserColumns).from(users)
    .where(eq(users.id, userId)).limit(1);
  return user;
};

// Only creation accepts a transaction so signup creates user + session atomically.
export const createUser = async (
  name: string,
  email: string,
  passwordHash: string,
  transaction: Pick<Database, "insert"> = db,
) => {
  const [user] = await transaction.insert(users)
    .values({ name, email, passwordHash }).returning(safeUserColumns);
  if (!user) throw new Error("User creation failed");
  return user;
};

export const createRefreshSession = async (
  session: typeof refreshSessions.$inferInsert,
  transaction: Pick<Database, "insert"> = db,
) => {
  await transaction.insert(refreshSessions).values(session);
};

export const getActiveSession = async (sessionId: string, userId: string) => {
  const [session] = await db.select().from(refreshSessions).where(and(
    eq(refreshSessions.id, sessionId),
    eq(refreshSessions.userId, userId),
    isNull(refreshSessions.revokedAt),
    gt(refreshSessions.expiresAt, new Date()),
  )).limit(1);
  return session;
};

export const rotateRefreshSession = async (sessionId: string, oldHash: string, newHash: string) => {
  const [session] = await db.update(refreshSessions)
    .set({ tokenHash: newHash, lastUsedAt: new Date() })
    .where(and(
      eq(refreshSessions.id, sessionId),
      eq(refreshSessions.tokenHash, oldHash),
      isNull(refreshSessions.revokedAt),
      gt(refreshSessions.expiresAt, new Date()),
    ))
    .returning({ id: refreshSessions.id });
  return session;
};

export const revokeRefreshSession = async (sessionId: string, userId: string) => {
  await db.update(refreshSessions).set({ revokedAt: new Date() })
    .where(and(eq(refreshSessions.id, sessionId), eq(refreshSessions.userId, userId)));
};
