import type { RequestHandler } from "express";
import { z } from "zod";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { projectParamsSchema } from "../projects/project.validation.js";
import { getDashboardActivityService, getDashboardSummaryService } from "./dashboard.service.js";

const activityQuery = z.object({ range: z.enum(["1h", "24h", "7d"]).default("24h") }).strict();

export const getDashboardSummaryController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId } = projectParamsSchema.parse(req.params);
    const data = await getDashboardSummaryService(req.userId!, projectId);
    return res.json(new HttpResponse(200, "Dashboard summary retrieved", data));
  } catch (error) {
    next(error);
  }
};

export const getDashboardActivityController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId } = projectParamsSchema.parse(req.params);
    const { range } = activityQuery.parse(req.query);
    const data = await getDashboardActivityService(req.userId!, projectId, range);
    return res.json(new HttpResponse(200, "Dashboard activity retrieved", data));
  } catch (error) {
    next(error);
  }
};
