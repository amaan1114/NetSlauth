import { z } from "zod";

export const registerAgentSchema = z.object({
  name: z.string().trim().min(1).max(100),
}).strict();

export const agentParamsSchema = z.object({
  agentId: z.string().uuid(),
});
