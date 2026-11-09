import { z } from "zod";

// URL normalizes equivalent IPv6 spellings; validation runs before this transform.
export const normalizeIp = (ip: string) => ip.includes(":") ? new URL(`http://[${ip}]`).hostname.slice(1, -1) : ip;

export const databaseDestinationSchema = z.object({
  ip: z.string().ip().transform(normalizeIp),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["TCP", "UDP"]),
}).strict();

export const databasePolicySchema = z.object({
  databasePorts: z.array(z.number().int().min(1).max(65535)).min(1).max(32),
  allowedDestinations: z.array(databaseDestinationSchema).max(100),
}).strict().refine((policy) => policy.allowedDestinations.every((destination) => policy.databasePorts.includes(destination.port)), {
  message: "Allowed destination ports must be included in databasePorts",
});

export const updateDatabasePolicySchema = z.object({
  databasePolicy: databasePolicySchema.nullable(),
}).strict();

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional(),
}).strict();

export const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});
