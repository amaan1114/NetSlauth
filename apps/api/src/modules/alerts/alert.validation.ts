import { z } from "zod";
import { alertSeverity, alertStatus } from "@workspace/netsleuth-database";

export const alertQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  severity: z.enum(alertSeverity.enumValues).optional(),
  status: z.enum(alertStatus.enumValues).optional(),
}).strict();
