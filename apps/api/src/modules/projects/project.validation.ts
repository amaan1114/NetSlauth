import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional(),
}).strict();

export const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});
