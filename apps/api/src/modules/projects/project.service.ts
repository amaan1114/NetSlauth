import { HttpError } from "../../utils/HttpError.js";
import type { DatabasePolicy } from "@workspace/netsleuth-database";
import { requireWorkspaceMember } from "../workspaces/workspace.service.js";
import { createProject, getUserProject, getWorkspaceProjects, updateProjectDatabasePolicy } from "./project.repo.js";

export const createProjectService = async (userId: string, workspaceId: string, name: string, description?: string) => {
  await requireWorkspaceMember(userId, workspaceId, ["OWNER", "ADMIN"]);
  return createProject(workspaceId, name, description);
};

export const getProjectsService = async (userId: string, workspaceId: string) => {
  await requireWorkspaceMember(userId, workspaceId);
  return getWorkspaceProjects(userId, workspaceId);
};

export const getProjectService = async (userId: string, projectId: string) => {
  const project = await getUserProject(userId, projectId);
  if (!project) throw new HttpError(404, "Project not found");
  return project;
};

export const updateDatabasePolicyService = async (userId: string, projectId: string, databasePolicy: DatabasePolicy | null) => {
  const project = await getProjectService(userId, projectId);
  await requireWorkspaceMember(userId, project.workspaceId, ["OWNER", "ADMIN"]);
  const updated = await updateProjectDatabasePolicy(project.id, databasePolicy);
  if (!updated) throw new HttpError(404, "Project not found");
  return updated.databasePolicy;
};
