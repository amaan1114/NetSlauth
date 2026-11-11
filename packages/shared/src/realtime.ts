import type { AlertSeverity, AlertStatus } from "./alerts.js";

export const realtimeEventNames = {
  networkEventNew: "network_event:new",
  alertNew: "alert:new",
  alertUpdated: "alert:updated",
  agentStatus: "agent:status",
} as const;

export interface RealtimeNetworkEvent {
  id: string;
  projectId: string;
  agentId: string;
  eventId: string;
  eventType: string;
  sourceIp: string;
  sourcePort: number | null;
  destinationIp: string;
  destinationPort: number | null;
  protocol: string;
  occurredAt: string;
}

export interface RealtimeAlert {
  id: string;
  projectId: string;
  title: string;
  severity: AlertSeverity;
  status: AlertStatus;
  ruleId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RealtimeAgentStatus {
  projectId: string;
  agentId: string;
  status: "ONLINE" | "OFFLINE" | "INACTIVE";
  lastHeartbeatAt: string | null;
}
