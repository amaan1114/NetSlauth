import { z } from "zod";

export const networkEventTypeSchema = z.enum([
  "NETWORK_CONNECTION_ATTEMPT",
  "NETWORK_CONNECTION_ESTABLISHED",
  "AUTHENTICATION_FAILURE",
  "AUTHENTICATION_SUCCESS",
  "SERVICE_DISCOVERED",
  "AGENT_HEARTBEAT",
]);

export const networkProtocolSchema = z.enum(["TCP", "UDP", "OTHER"]);

// Reusable by the API and agent without accepting non-JSON values in metadata.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(jsonValueSchema), z.record(jsonValueSchema),
]));

export const networkEventSchema = z.object({
  eventId: z.string().uuid().toLowerCase(),
  eventType: networkEventTypeSchema,
  sourceIp: z.string().ip(),
  sourcePort: z.number().int().min(0).max(65535).optional(),
  destinationIp: z.string().ip(),
  destinationPort: z.number().int().min(0).max(65535).optional(),
  protocol: networkProtocolSchema,
  metadata: z.record(jsonValueSchema).optional(),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

export const eventIngestionSchema = z.union([
  networkEventSchema,
  z.array(networkEventSchema).min(1).max(100),
]);

export type NetworkEventInput = z.infer<typeof networkEventSchema>;
export type NetworkEventType = z.infer<typeof networkEventTypeSchema>;
export type NetworkProtocol = z.infer<typeof networkProtocolSchema>;
