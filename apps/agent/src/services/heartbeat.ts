import { randomUUID } from "node:crypto";
import type { AgentConfig, NetworkEventInput } from "../types/index.js";
import { publishEvents } from "./eventPublisher.js";

export const createHeartbeatEvent = (): NetworkEventInput => ({
  eventId: randomUUID(),
  eventType: "AGENT_HEARTBEAT",
  // Required schema addresses are local control-event markers, not observed traffic.
  sourceIp: "127.0.0.1",
  destinationIp: "127.0.0.1",
  protocol: "OTHER",
  occurredAt: new Date().toISOString(),
  metadata: { observation: "local_control_heartbeat_not_network_traffic" },
});

export const publishHeartbeat = (config: AgentConfig, signal?: AbortSignal) =>
  publishEvents(config, [createHeartbeatEvent()], signal);
