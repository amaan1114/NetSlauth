import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { projectParamsSchema } from "../projects/project.validation.js";
import { eventDetailParamsSchema, eventQuerySchema } from "./event-explorer.validation.js";
import { getProjectEventService, getProjectEventsService } from "./event-explorer.service.js";

export const getProjectEventsController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId } = projectParamsSchema.parse(req.params);
    const query = eventQuerySchema.parse(req.query);
    const data = await getProjectEventsService(req.userId!, projectId, query);
    return res.json(new HttpResponse(200, "Events retrieved successfully", data));
  } catch (error) {
    next(error);
  }
};

export const getProjectEventController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId, eventRecordId } = eventDetailParamsSchema.parse(req.params);
    const data = await getProjectEventService(req.userId!, projectId, eventRecordId);
    return res.json(new HttpResponse(200, "Event retrieved successfully", data));
  } catch (error) {
    next(error);
  }
};
