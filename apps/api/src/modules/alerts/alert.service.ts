import { listSecurityAlertsInProject } from "@workspace/netsleuth-database";
import type { z } from "zod";
import { db } from "../../services/database.js";
import { getProjectService } from "../projects/project.service.js";
import type { alertQuerySchema } from "./alert.validation.js";

export const getAlertsService = async (userId: string, projectId: string, query: z.infer<typeof alertQuerySchema>) => {
  const project = await getProjectService(userId, projectId);
  const scope = { workspaceId: project.workspaceId, projectId: project.id };
  const { page, limit, severity, status } = query;
  const alerts = await listSecurityAlertsInProject(db, scope, { limit, offset: (page - 1) * limit, severity, status });
  const next = await listSecurityAlertsInProject(db, scope, { limit: 1, offset: page * limit, severity, status });
  return { alerts, pagination: { page, limit, hasMore: next.length > 0 } };
};
