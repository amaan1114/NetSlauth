import { z } from "zod";
import { networkEventTypeSchema, networkProtocolSchema } from "@workspace/netsleuth-shared";

// PostgreSQL inet does not accept interface-zone suffixes such as %eth0.
const exactIpSchema = z.string().ip().refine((ip) => !ip.includes("%"), "Use an IP without an interface zone");

export const eventQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  eventType: networkEventTypeSchema.optional(),
  protocol: networkProtocolSchema.optional(),
  sourceIp: exactIpSchema.optional(),
  destinationIp: exactIpSchema.optional(),
  agentId: z.string().uuid().optional(),
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
}).strict().refine((query) => !query.start || !query.end || Date.parse(query.start) < Date.parse(query.end), {
  message: "End must be after start", path: ["end"],
});

export const eventDetailParamsSchema = z.object({
  projectId: z.string().uuid(),
  eventRecordId: z.string().uuid(),
});

export type EventQuery = z.infer<typeof eventQuerySchema>;
