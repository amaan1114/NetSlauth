import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/HttpError.js";

const claimsSchema = z.object({
  sub: z.string().uuid(),
  sessionId: z.string().uuid(),
  type: z.enum(["access", "refresh"]),
  jti: z.string().uuid(),
  exp: z.number(),
});
export type AuthClaims = z.infer<typeof claimsSchema>;

export function signToken(userId: string, sessionId: string, type: "access" | "refresh", lifetime: number) {
  return jwt.sign({ sessionId, type }, type === "access" ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET, {
    algorithm: "HS256",
    subject: userId,
    jwtid: randomUUID(),
    issuer: "netsleuth-api",
    audience: `netsleuth-${type}`,
    expiresIn: lifetime,
  });
}

export function verifyToken(token: string, type: "access" | "refresh"): AuthClaims {
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
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
