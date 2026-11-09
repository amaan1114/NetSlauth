import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentEnv, readConfig } from "./config/index.js";
import { collectNetworkObservations, getNewConnectionEvents } from "./collectors/networkCollector.js";
import { publishEvents } from "./services/eventPublisher.js";
import { publishHeartbeat } from "./services/heartbeat.js";
import { logger } from "./utils/logger.js";
import type { AgentConfig } from "./types/index.js";

export const startAgent = (config: AgentConfig, shutdownTimeoutMs = 10000) => {
  const shutdown = new AbortController();
  const pending = new Set<Promise<void>>();
  let connections = new Set<string>();
  let stopping = false;
  let collecting = false;
  let heartbeating = false;

  const collect = async () => {
    if (collecting || stopping) return;
    collecting = true;
    try {
      const observations = await collectNetworkObservations(shutdown.signal);
      if (observations === null || stopping) return;
      const snapshot = getNewConnectionEvents(observations, connections);
      connections = snapshot.connections;
      if (snapshot.events.length) {
        const result = await publishEvents(config, snapshot.events, shutdown.signal);
        logger.info(`Connections published: ${result.insertedCount} inserted, ${result.duplicateCount} duplicates`);
      }
    } catch {
      if (!shutdown.signal.aborted) logger.error("Connection events were not fully delivered; no offline buffer is retained");
    } finally {
      collecting = false;
    }
  };
  const heartbeat = async () => {
    if (heartbeating || stopping) return;
    heartbeating = true;
    try {
      await publishHeartbeat(config, shutdown.signal);
    } catch {
      if (!shutdown.signal.aborted) logger.error("Heartbeat publishing failed; collection will continue");
    } finally {
      heartbeating = false;
    }
  };
  const track = (work: Promise<void>) => {
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  const collectionTimer = setInterval(() => track(collect()), config.collectionIntervalMs);
  const heartbeatTimer = setInterval(() => track(heartbeat()), config.heartbeatIntervalMs);

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(collectionTimer);
    clearInterval(heartbeatTimer);
    logger.info("Stopping agent; allowing pending requests to finish");
    const deadline = setTimeout(() => {
      logger.error("Shutdown deadline reached; cancelling pending work");
      shutdown.abort();
    }, shutdownTimeoutMs);
    await Promise.allSettled([...pending]);
    clearTimeout(deadline);
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    logger.info("Agent stopped");
  };
  const handleSignal = () => { void stop(); };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  logger.info("Starting Linux socket-table polling and heartbeat reporting");
  track(collect());
  track(heartbeat());
  return { stop };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    loadAgentEnv();
    startAgent(readConfig());
  } catch (error) {
    logger.error(error instanceof Error ? error.message : "Agent startup failed");
    process.exitCode = 1;
  }
}
