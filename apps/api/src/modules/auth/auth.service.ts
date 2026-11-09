import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { refreshSessions, users, type Database } from "@workspace/netsleuth-database";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/HttpError.js";
import { hashToken, signToken, verifyToken } from "./auth.tokens.js";
import type { LoginInput, RegisterInput } from "./auth.validation.js";

const safeUserColumns = {
  id: users.id, name: users.name, email: users.email,
  createdAt: users.createdAt, updatedAt: users.updatedAt,
};

export function createAuthService(database: Database) {
  async function newSession(userId: string, target: Pick<Database, "insert"> = database) {
    const sessionId = randomUUID();
    const refreshLifetime = env.JWT_REFRESH_TTL_SECONDS;
    const accessToken = signToken(userId, sessionId, "access", env.JWT_ACCESS_TTL_SECONDS);
    const refreshToken = signToken(userId, sessionId, "refresh", refreshLifetime);
    const claims = verifyToken(refreshToken, "refresh");
    await target.insert(refreshSessions).values({
      id: sessionId, userId, tokenHash: hashToken(refreshToken), expiresAt: new Date(claims.exp * 1000),
    });
    return { accessToken, refreshToken, refreshLifetime };
  }

  async function register(input: RegisterInput) {
    const [existing] = await database.select({ id: users.id }).from(users)
      .where(sql`lower(${users.email}) = ${input.email}`).limit(1);
    if (existing) throw new HttpError(409, "Email is already registered");
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      return await database.transaction(async (transaction) => {
        const [user] = await transaction.insert(users).values({
          name: input.name, email: input.email, passwordHash,
        }).returning(safeUserColumns);
        if (!user) throw new Error("User creation failed");
        const tokens = await newSession(user.id, transaction);
        return { user, ...tokens };
      });
    } catch (error) {
      const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
        throw new HttpError(409, "Email is already registered");
      }
      throw error;
    }
  }

  async function login(input: LoginInput) {
    const [user] = await database.select({ ...safeUserColumns, passwordHash: users.passwordHash }).from(users)
      .where(sql`lower(${users.email}) = ${input.email}`).limit(1);
    // A valid fixed-cost hash prevents the nonexistent-user path from skipping bcrypt.
    const fallbackHash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxXIRfHjZAFSgGJCU1gRr7LiAFe";
    const matches = await bcrypt.compare(input.password, user?.passwordHash ?? fallbackHash);
    if (!user || !matches) throw new HttpError(401, "Invalid email or password");
    const { passwordHash: _passwordHash, ...safeUser } = user;
    void _passwordHash;
    return { user: safeUser, ...await newSession(user.id) };
  }

  async function validateAccess(token: string) {
    const claims = verifyToken(token, "access");
    const [session] = await database.select({ id: refreshSessions.id }).from(refreshSessions).where(and(
      eq(refreshSessions.id, claims.sessionId),
      eq(refreshSessions.userId, claims.sub),
      isNull(refreshSessions.revokedAt),
      gt(refreshSessions.expiresAt, new Date()),
    )).limit(1);
    if (!session) throw new HttpError(401, "Session is no longer active");
    return { userId: claims.sub, sessionId: claims.sessionId };
  }

  async function currentUser(userId: string) {
    const [user] = await database.select(safeUserColumns).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new HttpError(401, "User is no longer available");
    return user;
  }

  async function refresh(token: string) {
    const claims = verifyToken(token, "refresh");
    const [session] = await database.select().from(refreshSessions).where(and(
      eq(refreshSessions.id, claims.sessionId), eq(refreshSessions.userId, claims.sub),
      eq(refreshSessions.tokenHash, hashToken(token)), isNull(refreshSessions.revokedAt),
      gt(refreshSessions.expiresAt, new Date()),
    )).limit(1);
    if (!session) throw new HttpError(401, "Refresh session is invalid or expired");
    const user = await currentUser(claims.sub);
    // Sessions have an absolute lifetime; rotating cannot extend it indefinitely.
    const refreshLifetime = Math.floor(session.expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000);
    if (refreshLifetime <= 0) throw new HttpError(401, "Refresh session has expired");
    const refreshToken = signToken(user.id, session.id, "refresh", refreshLifetime);
    const accessToken = signToken(user.id, session.id, "access", Math.min(env.JWT_ACCESS_TTL_SECONDS, refreshLifetime));
    const [rotated] = await database.update(refreshSessions).set({
      tokenHash: hashToken(refreshToken), lastUsedAt: new Date(),
    }).where(and(
      eq(refreshSessions.id, session.id), eq(refreshSessions.tokenHash, hashToken(token)),
      isNull(refreshSessions.revokedAt), gt(refreshSessions.expiresAt, new Date()),
    )).returning({ id: refreshSessions.id });
    if (!rotated) throw new HttpError(401, "Refresh token was already used");
    return { user, accessToken, refreshToken, refreshLifetime };
  }

  async function logout(refreshToken?: string, accessToken?: string) {
    for (const [token, type] of [[refreshToken, "refresh"], [accessToken, "access"]] as const) {
      if (!token) continue;
      let claims;
      try { claims = verifyToken(token, type); } catch { continue; }
      await database.update(refreshSessions).set({ revokedAt: new Date() })
        .where(and(eq(refreshSessions.id, claims.sessionId), eq(refreshSessions.userId, claims.sub)));
      break;
    }
  }

  return { register, login, refresh, logout, validateAccess, currentUser };
}

export type AuthService = ReturnType<typeof createAuthService>;
