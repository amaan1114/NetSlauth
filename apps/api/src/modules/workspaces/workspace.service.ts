import type { WorkspaceMember } from "@workspace/netsleuth-database";
import { HttpError } from "../../utils/HttpError.js";
import { createWorkspaceWithOwner, getUserWorkspace, getUserWorkspaces } from "./workspace.repo.js";

export const createWorkspaceService = async (userId: string, name: string) => {
  return createWorkspaceWithOwner(userId, name);
};

export const getWorkspacesService = async (userId: string) => {
  return getUserWorkspaces(userId);
};

export const requireWorkspaceMember = async (
  userId: string,
  workspaceId: string,
  roles: WorkspaceMember["role"][] = [],
) => {
  const result = await getUserWorkspace(userId, workspaceId);
  if (!result) throw new HttpError(404, "Workspace not found");
  if (roles.length && !roles.includes(result.role)) {
    throw new HttpError(403, "Only workspace owners and admins can create projects");
  }
  return result.workspace;
};
