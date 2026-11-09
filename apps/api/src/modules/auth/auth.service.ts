import bcrypt from "bcrypt";
import { HttpError } from "../../utils/HttpError.js";
import { generateTokens, verifyToken } from "../../utils/token.js";
import { getUserByEmail, getUserById, createUser } from "./auth.repo.js";

export const signUpService = async (name: string, email: string, password: string) => {
  const existing = await getUserByEmail(email);
  if (existing) throw new HttpError(409, "Email is already registered");
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await createUser(name, email, passwordHash);
    return { user, ...generateTokens(user.id) };
  } catch (error) {
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
      throw new HttpError(409, "Email is already registered");
    }
    throw error;
  }
};

export const signInService = async (email: string, password: string) => {
  const user = await getUserByEmail(email);
  // Match the bcrypt cost for unknown users without exposing registered emails.
  const fallbackHash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxXIRfHjZAFSgGJCU1gRr7LiAFe";
  const matches = await bcrypt.compare(password, user?.passwordHash ?? fallbackHash);
  if (!user || !matches) throw new HttpError(401, "Invalid email or password");
  const { id, name, createdAt, updatedAt } = user;
  return {
    user: { id, name, email: user.email, createdAt, updatedAt },
    ...generateTokens(id),
  };
};

export const getMeService = async (userId: string) => {
  const user = await getUserById(userId);
  if (!user) throw new HttpError(401, "User is no longer available");
  return user;
};

export const refreshTokenService = async (token: string) => {
  const { userId } = verifyToken(token, "refresh");
  const user = await getMeService(userId);
  return { user, ...generateTokens(user.id) };
};
