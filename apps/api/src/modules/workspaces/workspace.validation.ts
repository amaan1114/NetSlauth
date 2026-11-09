import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
}).strict();

export const workspaceParamsSchema = z.object({
  workspaceId: z.string().uuid(),
});
