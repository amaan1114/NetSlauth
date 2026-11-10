export interface ExplorerEvent {
  id: string;
  projectId: string;
  agentId: string;
  agentName: string;
  eventType: string;
  sourceIp: string;
  sourcePort: number | null;
  destinationIp: string;
  destinationPort: number | null;
  protocol: string;
  occurredAt: string;
}

export interface ExplorerEventDetail extends ExplorerEvent {
  eventId: string;
  receivedAt: string;
  metadata: Record<string, unknown>;
}

export interface ExplorerEventList {
  events: ExplorerEvent[];
  pagination: { limit: number; offset: number; hasMore: boolean };
}
