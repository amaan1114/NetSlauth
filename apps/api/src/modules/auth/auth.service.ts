import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Database } from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/HttpError.js";
import {
  getUserByEmail, getUserById, createUser, createRefreshSession,
  getActiveSession, rotateRefreshSession, revokeRefreshSession,
} from "./auth.repo.js";

const claimsSchema = z.object({
  sub: z.string().uuid(),
  sessionId: z.string().uuid(),
  type: z.enum(["access", "refresh"]),
  jti: z.string().uuid(),
  exp: z.number(),
});

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const signToken = (userId: string, sessionId: string, type: "access" | "refresh", lifetime: number) => {
  return jwt.sign({ sessionId, type }, type === "access" ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET, {
    algorithm: "HS256",
    subject: userId,
    jwtid: randomUUID(),
    issuer: "netsleuth-api",
    audience: `netsleuth-${type}`,
    expiresIn: lifetime,
  });
};

export const verifyToken = (token: string, type: "access" | "refresh") => {
  try {
    const payload = jwt.verify(token, type === "access" ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET, {
      algorithms: ["HS256"],
      issuer: "netsleuth-api",
      audience: `netsleuth-${type}`,
    });
    const claims = claimsSchema.parse(payload);
    if (claims.type !== type) throw new Error("Wrong token type");
    return claims;
  } catch {
    throw new HttpError(401, `Invalid or expired ${type} token`);
  }
};

const newSession = async (userId: string, transaction: Pick<Database, "insert"> = db) => {
  const sessionId = randomUUID();
  const refreshLifetime = env.JWT_REFRESH_TTL_SECONDS;
  const accessToken = signToken(userId, sessionId, "access", env.JWT_ACCESS_TTL_SECONDS);
  const refreshToken = signToken(userId, sessionId, "refresh", refreshLifetime);
  const claims = verifyToken(refreshToken, "refresh");
  await createRefreshSession({
    id: sessionId,
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(claims.exp * 1000),
  }, transaction);
  return { accessToken, refreshToken, refreshLifetime };
};

export const signUpService = async (name: string, email: string, password: string) => {
  const existing = await getUserByEmail(email);
  if (existing) throw new HttpError(409, "Email is already registered");
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    return await db.transaction(async (transaction) => {
      const user = await createUser(name, email, passwordHash, transaction);
      const tokens = await newSession(user.id, transaction);
      return { user, ...tokens };
    });
  } catch (error) {
    // Also handle two simultaneous signups passing the initial email check.
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
      throw new HttpError(409, "Email is already registered");
    }
    throw error;
  }
};

export const signInService = async (email: string, password: string) => {
  const user = await getUserByEmail(email);
  // Do the same bcrypt work for unknown users; don't reveal which emails exist.
  const fallbackHash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxXIRfHjZAFSgGJCU1gRr7LiAFe";
  const matches = await bcrypt.compare(password, user?.passwordHash ?? fallbackHash);
  if (!user || !matches) throw new HttpError(401, "Invalid email or password");
  const { id, name, createdAt, updatedAt } = user;
  return {
    user: { id, name, email: user.email, createdAt, updatedAt },
    ...await newSession(id),
  };
};

export const getMeService = async (userId: string) => {
  const user = await getUserById(userId);
  if (!user) throw new HttpError(401, "User is no longer available");
  return user;
};

export const validateAccessToken = async (token: string) => {
  const claims = verifyToken(token, "access");
  const session = await getActiveSession(claims.sessionId, claims.sub);
  if (!session) throw new HttpError(401, "Session is no longer active");
  return { userId: claims.sub, sessionId: claims.sessionId };
};

export const refreshSessionService = async (token: string) => {
  const claims = verifyToken(token, "refresh");
  const session = await getActiveSession(claims.sessionId, claims.sub);
  if (!session || session.tokenHash !== hashToken(token)) {
    throw new HttpError(401, "Refresh session is invalid or expired");
  }
  const user = await getMeService(claims.sub);
  // Rotation does not extend the original session's expiration.
  const refreshLifetime = Math.floor(session.expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000);
  if (refreshLifetime <= 0) throw new HttpError(401, "Refresh session has expired");
  const refreshToken = signToken(user.id, session.id, "refresh", refreshLifetime);
  const accessToken = signToken(user.id, session.id, "access", Math.min(env.JWT_ACCESS_TTL_SECONDS, refreshLifetime));
  const rotated = await rotateRefreshSession(session.id, hashToken(token), hashToken(refreshToken));
  if (!rotated) throw new HttpError(401, "Refresh token was already used");
  return { user, accessToken, refreshToken, refreshLifetime };
};

export const logoutService = async (refreshToken?: unknown, accessToken?: unknown) => {
  for (const [token, type] of [[refreshToken, "refresh"], [accessToken, "access"]] as const) {
    if (typeof token !== "string" || token.length > 8192) continue;
    let claims;
    try {
      claims = verifyToken(token, type);
    } catch {
      continue; // Logout is safe to repeat even when the cookies are invalid.
    }
    await revokeRefreshSession(claims.sessionId, claims.sub);
    return;
  }
};
