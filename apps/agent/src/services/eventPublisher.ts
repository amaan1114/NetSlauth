import { setTimeout as delay } from "node:timers/promises";
import { networkEventSchema, type SuccessResponse } from "@workspace/netsleuth-shared";
import type { AgentConfig, IngestionCounts, NetworkEventInput } from "../types/index.js";
import { logger } from "../utils/logger.js";

type PublisherOptions = { timeoutMs?: number; maxAttempts?: number; retryDelayMs?: number };

export const publishEvents = async (
  config: AgentConfig, events: NetworkEventInput[], signal?: AbortSignal, options: PublisherOptions = {},
): Promise<IngestionCounts> => {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const total = { insertedCount: 0, duplicateCount: 0 };
  for (let offset = 0; offset < events.length; offset += 100) {
    const batch = events.slice(offset, offset + 100).map((event) => networkEventSchema.parse(event));
    // Reuse this exact body/UUIDs for every retry, including retries after a lost response.
    const body = JSON.stringify(batch);
    let delivered = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      signal?.throwIfAborted();
      const requestSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
      let response: Response | undefined;
      try {
        response = await fetch(`${config.apiUrl}/api/v1/ingest/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Agent-Key": config.agentKey },
          credentials: "omit", redirect: "error", body, signal: requestSignal,
        });
        if (response.ok) {
          const result = await response.json() as SuccessResponse<IngestionCounts>;
          const counts = result?.data;
          if (result.success !== true || result.statusCode !== 200 || !counts ||
              !Number.isInteger(counts.insertedCount) || !Number.isInteger(counts.duplicateCount) ||
              counts.insertedCount < 0 || counts.duplicateCount < 0 ||
              counts.insertedCount + counts.duplicateCount !== batch.length) {
            throw new Error("Invalid ingestion response");
          }
          total.insertedCount += counts.insertedCount;
          total.duplicateCount += counts.duplicateCount;
          delivered = true;
          break;
        }
        await response.body?.cancel();
      } catch {
        if (signal?.aborted) throw new Error("Publishing cancelled during shutdown");
        // A received successful response with malformed content is a contract error, not a retryable rejection.
        if (response?.ok && !requestSignal.aborted) throw new Error("Invalid ingestion response");
      }
      if (response && !response.ok && ![408, 425, 429].includes(response.status) && response.status < 500) {
        throw new Error(`Ingestion rejected the batch (HTTP ${response.status})`);
      }
      if (attempt + 1 < maxAttempts) {
        logger.error(`Temporary publish failure; retrying batch (${attempt + 2}/${maxAttempts})`);
        const jitter = Math.floor(Math.random() * Math.max(1, retryDelayMs / 2));
        await delay(retryDelayMs * 2 ** attempt + jitter, undefined, { signal });
      }
    }
    if (!delivered) throw new Error("Event publishing failed after bounded retries");
  }
  return total;
};
