import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { promisify } from "node:util";
import type { NetworkEventInput, NetworkObservation } from "../types/index.js";
import { logger } from "../utils/logger.js";

const runFile = promisify(execFile);
export const MAX_TRACKED_CONNECTIONS = 5000;

const parseEndpoint = (value: string) => {
  const colon = value.lastIndexOf(":");
  if (colon < 0) return null;
  const host = value.slice(0, colon).replace(/^\[|\]$/g, "").replace(/%[^%]+$/, "");
  const portText = value.slice(colon + 1);
  const port = portText === "*" ? undefined : /^\d+$/.test(portText) ? Number(portText) : NaN;
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) return null;
  if (host !== "*" && !isIP(host)) return null;
  return { ip: host === "*" ? undefined : host, port };
};

export const parseSsOutput = (output: string, occurredAt = new Date().toISOString()): NetworkObservation[] => {
  const observations: NetworkObservation[] = [];
  for (const line of output.split("\n")) {
    const [netid, state, receiveQueue, sendQueue, localText, peerText] = line.trim().split(/\s+/);
    if (!netid || !state || !localText || !peerText || !/^\d+$/.test(receiveQueue ?? "") || !/^\d+$/.test(sendQueue ?? "")) continue;
    if (!["tcp", "tcp6", "udp", "udp6"].includes(netid)) continue;
    const protocol = netid.startsWith("tcp") ? "TCP" : "UDP";
    const local = parseEndpoint(localText);
    const peer = parseEndpoint(peerText);
    if (!local?.ip || !peer) continue;
    const metadata = { collector: "ss", transportState: state, endpointOrientation: "local_to_peer", direction: "unknown" };

    if ((protocol === "TCP" && state === "LISTEN") || (protocol === "UDP" && state === "UNCONN" && (!peer.ip || ["0.0.0.0", "::"].includes(peer.ip)))) {
      if (!local.port) continue;
      observations.push({
        eventType: "SERVICE_DISCOVERED", protocol, occurredAt,
        sourceIp: local.ip, sourcePort: local.port, destinationIp: local.ip, destinationPort: local.port,
        metadata: { ...metadata, endpointOrientation: "local_binding", observation: "bound_socket_not_verified_service" },
      });
    } else {
      if (!peer.ip || !peer.port || ["0.0.0.0", "::"].includes(peer.ip)) continue;
      const attempt = protocol === "TCP" && ["SYN-SENT", "SYN-RECV"].includes(state);
      if (!attempt && state !== "ESTAB") continue;
      const inbound = state === "SYN-RECV";
      observations.push({
        eventType: attempt ? "NETWORK_CONNECTION_ATTEMPT" : "NETWORK_CONNECTION_ESTABLISHED",
        protocol, occurredAt,
        sourceIp: inbound ? peer.ip : local.ip, sourcePort: inbound ? peer.port : local.port,
        destinationIp: inbound ? local.ip : peer.ip, destinationPort: inbound ? local.port : peer.port,
        metadata: {
          ...metadata,
          endpointOrientation: inbound ? "peer_to_local" : "local_to_peer",
          direction: attempt ? inbound ? "inbound" : "outbound" : "unknown",
          observation: protocol === "UDP" ? "udp_peer_association_not_handshake" : "tcp_socket_state",
        },
      });
    }
    if (observations.length >= MAX_TRACKED_CONNECTIONS) {
      logger.error("Connection snapshot reached the 5000-observation limit; remaining rows were skipped");
      break;
    }
  }
  return observations;
};

export const collectNetworkObservations = async (signal?: AbortSignal, run = runFile): Promise<NetworkObservation[] | null> => {
  if (process.platform !== "linux") {
    logger.error("Network collection requires Linux and ss; this platform is unsupported");
    return null;
  }
  try {
    // Fixed executable/arguments, no shell, no process details, and no credential-bearing environment.
    const { stdout } = await run("ss", ["-H", "-n", "-t", "-u", "-a"], {
      timeout: 5000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", signal,
      env: { PATH: process.env.PATH ?? "", LC_ALL: "C" },
    });
    return parseSsOutput(String(stdout));
  } catch (error) {
    if (signal?.aborted) return null;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") logger.error("ss is unavailable; install iproute2 on the Linux host");
    else if (code === "EACCES" || code === "EPERM") logger.error("Permission denied while reading socket metadata");
    else logger.error("Socket collection failed or exceeded its timeout/output limit");
    return null; // A failed snapshot must not erase the previous connection set.
  }
};

export const getNewConnectionEvents = (observations: NetworkObservation[], previous: Set<string>) => {
  const connections = new Set<string>();
  const events: NetworkEventInput[] = [];
  for (const observation of observations.slice(0, MAX_TRACKED_CONNECTIONS)) {
    const key = JSON.stringify([
      observation.protocol, observation.sourceIp, observation.sourcePort,
      observation.destinationIp, observation.destinationPort, observation.eventType,
    ]);
    if (!connections.has(key) && !previous.has(key)) events.push({ ...observation, eventId: randomUUID() });
    connections.add(key);
  }
  return { connections, events };
};
