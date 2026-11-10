import type { DashboardActivity, DashboardRange, DashboardSummary } from "@workspace/netsleuth-shared";
import { getProjectService } from "../projects/project.service.js";
import { getActivityCounts, getDashboardRecords } from "./dashboard.repo.js";

export const getDashboardSummaryService = async (userId: string, projectId: string): Promise<DashboardSummary> => {
  await getProjectService(userId, projectId);
  const records = await getDashboardRecords(projectId);
  const severityDistribution: DashboardSummary["severityDistribution"] = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  let openAlerts = 0;
  for (const row of records.alertCounts) {
    severityDistribution[row.severity] += row.total;
    if (row.status === "OPEN") openAlerts += row.total;
  }
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    metrics: {
      totalAgents: records.agentCounts.total,
      onlineAgents: records.agentCounts.online,
      offlineAgents: records.agentCounts.offline,
      inactiveAgents: records.agentCounts.inactive,
      totalNetworkEvents: records.eventCounts.total,
      openAlerts,
      criticalAlerts: severityDistribution.CRITICAL,
    },
    severityDistribution,
    recentAlerts: records.recentAlerts.map((alert) => ({ ...alert, firstSeenAt: alert.firstSeenAt.toISOString() })),
    agentHealth: {
      items: records.agentHealth.slice(0, 10).map((agent) => ({
        ...agent,
        lastHeartbeatAt: agent.lastHeartbeatAt?.toISOString() ?? null,
        revokedAt: agent.revokedAt?.toISOString() ?? null,
      })),
      limit: 10,
      hasMore: records.agentHealth.length > 10,
    },
  };
};

const ranges = {
  "1h": { hours: 1, intervalMinutes: 5 },
  "24h": { hours: 24, intervalMinutes: 60 },
  "7d": { hours: 168, intervalMinutes: 360 },
} as const;

export const getDashboardActivityService = async (
  userId: string, projectId: string, range: DashboardRange, to = new Date(),
): Promise<DashboardActivity> => {
  await getProjectService(userId, projectId);
  const { hours, intervalMinutes } = ranges[range];
  const from = new Date(to.getTime() - hours * 3_600_000);
  const rows = await getActivityCounts(projectId, from, to, intervalMinutes);
  const counts = new Map(rows.map((row) => [row.bucket, row]));
  const buckets = Array.from({ length: hours * 60 / intervalMinutes }, (_, index) => {
    const row = counts.get(index);
    return {
      start: new Date(from.getTime() + index * intervalMinutes * 60_000).toISOString(),
      network: row?.network ?? 0,
      authentication: row?.authentication ?? 0,
      heartbeat: row?.heartbeat ?? 0,
      service: row?.service ?? 0,
    };
  });
  return { projectId, range, from: from.toISOString(), to: to.toISOString(), intervalMinutes, buckets };
};
