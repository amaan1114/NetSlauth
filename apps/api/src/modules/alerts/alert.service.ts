import type { SecurityAlert } from "@workspace/netsleuth-database";
import type { AlertDetail, AlertList, AlertRelatedEvents, AlertStatus, InvestigationAlert } from "@workspace/netsleuth-shared";
import type { z } from "zod";
import { getProjectService } from "../projects/project.service.js";
import { HttpError } from "../../utils/HttpError.js";
import { redactEventMetadata } from "../events/event-explorer.service.js";
import { findAlertAgent, findProjectAlert, listAlertRelatedEvents, listProjectAlerts, updateProjectAlertStatus } from "./alert.repo.js";
import type { alertQuerySchema } from "./alert.validation.js";

const publicAlert = (alert: SecurityAlert): InvestigationAlert => ({
  ...alert,
  evidence: redactEventMetadata(alert.evidence) as Record<string, unknown>,
  firstSeenAt: alert.firstSeenAt.toISOString(),
  lastSeenAt: alert.lastSeenAt.toISOString(),
  createdAt: alert.createdAt.toISOString(),
  updatedAt: alert.updatedAt.toISOString(),
});

export const getAlertsService = async (userId: string, projectId: string, query: z.infer<typeof alertQuerySchema>): Promise<AlertList> => {
  await getProjectService(userId, projectId);
  const { page, limit } = query;
  const rows = await listProjectAlerts(projectId, query);
  return { alerts: rows.slice(0, limit).map(publicAlert), pagination: { page, limit, hasMore: rows.length > limit } };
};

export const getAlertService = async (userId: string, projectId: string, alertId: string): Promise<AlertDetail> => {
  await getProjectService(userId, projectId);
  const alert = await findProjectAlert(projectId, alertId);
  if (!alert) throw new HttpError(404, "Alert not found");
  const agent = alert.agentId ? await findAlertAgent(projectId, alert.agentId) : null;
  return { alert: publicAlert(alert), agent };
};

export const setAlertStatusService = async (userId: string, projectId: string, alertId: string, status: AlertStatus): Promise<AlertDetail> => {
  await getProjectService(userId, projectId);
  const alert = await updateProjectAlertStatus(projectId, alertId, status);
  if (!alert) throw new HttpError(404, "Alert not found");
  const agent = alert.agentId ? await findAlertAgent(projectId, alert.agentId) : null;
  return { alert: publicAlert(alert), agent };
};

export const getRelatedEventsService = async (
  userId: string, projectId: string, alertId: string, page: number, limit: number,
): Promise<AlertRelatedEvents> => {
  await getProjectService(userId, projectId);
  if (!await findProjectAlert(projectId, alertId)) throw new HttpError(404, "Alert not found");
  const rows = await listAlertRelatedEvents(projectId, alertId, page, limit);
  return {
    events: rows.slice(0, limit).map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
    pagination: { page, limit, hasMore: rows.length > limit },
  };
};
