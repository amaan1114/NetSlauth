import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import type { AgentConfig } from "../types/index.js";

export const loadAgentEnv = () => {
  const file = fileURLToPath(new URL("../../.env", import.meta.url));
  if (!existsSync(file)) return;
  try {
    loadEnvFile(file);
  } catch {
    throw new Error("Could not load agent .env configuration");
  }
};

export const readConfig = (env: NodeJS.ProcessEnv = process.env): AgentConfig => {
  let url: URL;
  try {
    url = new URL(env.NETSLEUTH_API_URL ?? "");
  } catch {
    throw new Error("NETSLEUTH_API_URL must be an HTTP or HTTPS API base URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("NETSLEUTH_API_URL must not contain credentials, query parameters, or fragments");
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NETSLEUTH_API_URL must use HTTPS in production");
  }
  const agentKey = env.NETSLEUTH_AGENT_KEY ?? "";
  if (!/^ns_agent_[a-f0-9]{64}$/.test(agentKey)) throw new Error("NETSLEUTH_AGENT_KEY is missing or invalid");
  const interval = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1000 || value > 3600000) {
      throw new Error(`${name} must be an integer between 1000 and 3600000`);
    }
    return value;
  };
  return {
    apiUrl: url.toString().replace(/\/+$/, ""),
    agentKey,
    collectionIntervalMs: interval("COLLECTION_INTERVAL_MS", 10000),
    heartbeatIntervalMs: interval("HEARTBEAT_INTERVAL_MS", 30000),
  };
};
