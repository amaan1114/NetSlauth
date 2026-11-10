export type DashboardRange = "1h" | "24h" | "7d";
export type DashboardSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface DashboardAlert {
  id: string;
  projectId: string;
  title: string;
  severity: DashboardSeverity;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  ruleId: string;
  sourceIp: string | null;
  firstSeenAt: string;
}

export interface DashboardAgent {
  id: string;
  projectId: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "INACTIVE";
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
}

export interface DashboardSummary {
  projectId: string;
  generatedAt: string;
  metrics: {
    totalAgents: number;
    onlineAgents: number;
    offlineAgents: number;
    inactiveAgents: number;
    totalNetworkEvents: number;
    openAlerts: number;
    criticalAlerts: number;
  };
  severityDistribution: Record<DashboardSeverity, number>;
  recentAlerts: DashboardAlert[];
  agentHealth: { items: DashboardAgent[]; limit: number; hasMore: boolean };
}

export interface DashboardActivity {
  projectId: string;
  range: DashboardRange;
  from: string;
  to: string;
  intervalMinutes: number;
  buckets: {
    start: string;
    network: number;
    authentication: number;
    heartbeat: number;
    service: number;
  }[];
}
