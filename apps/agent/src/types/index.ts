import type { NetworkEventInput } from "@workspace/netsleuth-shared";

export type { NetworkEventInput } from "@workspace/netsleuth-shared";
export type NetworkObservation = Omit<NetworkEventInput, "eventId">;

export type AgentConfig = {
  apiUrl: string;
  agentKey: string;
  collectionIntervalMs: number;
  heartbeatIntervalMs: number;
};

export type IngestionCounts = { insertedCount: number; duplicateCount: number };
