import type { ExplorerEvent } from "./event-explorer.js";

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
export interface InvestigationAlert {
  id: string;
  projectId: string;
  agentId: string | null;
  title: string;
  description: string;
  severity: AlertSeverity;
  status: AlertStatus;
  ruleId: string;
  fingerprint: string;
  evidence: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface AlertList {
  alerts: InvestigationAlert[];
  pagination: { page: number; limit: number; hasMore: boolean };
}
export interface AlertDetail {
  alert: InvestigationAlert;
  agent: { id: string; name: string } | null;
}
export interface AlertRelatedEvents {
  events: ExplorerEvent[];
  pagination: { page: number; limit: number; hasMore: boolean };
}
