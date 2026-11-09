import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "./HttpError.js";

export const signToken = (userId: string, type: "access" | "refresh", lifetime: number) => {
  const secret = type === "access" ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  return jwt.sign({ type }, secret, {
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
    const secret = type === "access" ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: "netsleuth-api",
      audience: `netsleuth-${type}`,
    });
    if (typeof payload === "string" || typeof payload.sub !== "string" ||
        typeof payload.exp !== "number" || payload.type !== type) {
      throw new Error("Invalid token");
    }
    return { userId: payload.sub };
  } catch {
    throw new HttpError(401, `Invalid or expired ${type} token`);
  }
};

export const generateTokens = (userId: string) => ({
  accessToken: signToken(userId, "access", env.JWT_ACCESS_TTL_SECONDS),
  refreshToken: signToken(userId, "refresh", env.JWT_REFRESH_TTL_SECONDS),
  refreshLifetime: env.JWT_REFRESH_TTL_SECONDS,
});
