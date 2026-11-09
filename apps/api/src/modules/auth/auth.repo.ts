import { eq, sql } from "drizzle-orm";
import { users } from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";

const safeUserColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export const getUserByEmail = async (email: string) => {
  const [user] = await db.select({ ...safeUserColumns, passwordHash: users.passwordHash })
    .from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  return user;
};

export const getUserById = async (userId: string) => {
  const [user] = await db.select(safeUserColumns).from(users)
    .where(eq(users.id, userId)).limit(1);
  return user;
};

export const createUser = async (name: string, email: string, passwordHash: string) => {
  const [user] = await db.insert(users)
    .values({ name, email, passwordHash }).returning(safeUserColumns);
  if (!user) throw new Error("User creation failed");
  return user;
};
