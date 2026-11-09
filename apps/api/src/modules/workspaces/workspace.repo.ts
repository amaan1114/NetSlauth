import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { workspaces, workspaceMembers } from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";

export const createWorkspaceWithOwner = async (userId: string, name: string) => {
  return db.transaction(async (transaction) => {
    const [workspace] = await transaction.insert(workspaces).values({ name }).returning();
    if (!workspace) throw new Error("Workspace creation failed");
    await transaction.insert(workspaceMembers).values({
      userId, workspaceId: workspace.id, role: "OWNER",
    });
    return workspace;
  });
};

export const getUserWorkspaces = async (userId: string) => {
  return db.select(getTableColumns(workspaces)).from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(desc(workspaces.createdAt), workspaces.id);
};

export const getUserWorkspace = async (userId: string, workspaceId: string) => {
  const [result] = await db.select({
    workspace: getTableColumns(workspaces),
    role: workspaceMembers.role,
  }).from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaces.id, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return result;
};
