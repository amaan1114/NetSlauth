import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { projectParamsSchema } from "../projects/project.validation.js";
import { alertQuerySchema } from "./alert.validation.js";
import { getAlertsService } from "./alert.service.js";

export const getAlertsController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId } = projectParamsSchema.parse(req.params);
    const query = alertQuerySchema.parse(req.query);
    const data = await getAlertsService(req.userId!, projectId, query);
    return res.json(new HttpResponse(200, "Alerts retrieved successfully", data));
  } catch (error) {
    next(error);
  }
};
