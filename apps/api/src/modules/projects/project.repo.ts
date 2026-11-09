import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { projects, workspaceMembers, type DatabasePolicy } from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";

export const createProject = async (workspaceId: string, name: string, description?: string) => {
  const [project] = await db.insert(projects).values({ workspaceId, name, description }).returning();
  if (!project) throw new Error("Project creation failed");
  return project;
};

export const getWorkspaceProjects = async (userId: string, workspaceId: string) => {
  return db.select(getTableColumns(projects)).from(projects)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, projects.workspaceId))
    .where(and(eq(projects.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .orderBy(desc(projects.createdAt), projects.id);
};

export const getUserProject = async (userId: string, projectId: string) => {
  const [project] = await db.select(getTableColumns(projects)).from(projects)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, projects.workspaceId))
    .where(and(eq(projects.id, projectId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return project;
};

export const updateProjectDatabasePolicy = async (projectId: string, databasePolicy: DatabasePolicy | null) => {
  const [project] = await db.update(projects).set({ databasePolicy }).where(eq(projects.id, projectId)).returning();
  return project;
};
