import { z } from "zod";
import { alertSeverity, alertStatus } from "@workspace/netsleuth-database";

export const alertQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  severity: z.enum(alertSeverity.enumValues).optional(),
  status: z.enum(alertStatus.enumValues).optional(),
  ruleId: z.string().trim().min(1).max(100).optional(),
  sourceIp: z.string().ip().refine((ip) => !ip.includes("%"), "Use an IP without an interface zone").optional(),
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
}).strict().refine((query) => !query.start || !query.end || Date.parse(query.start) < Date.parse(query.end), {
  message: "End must be after start", path: ["end"],
});

export const alertParamsSchema = z.object({ projectId: z.string().uuid(), alertId: z.string().uuid() });
export const alertStatusSchema = z.object({ status: z.enum(alertStatus.enumValues) }).strict();
export const relatedEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
