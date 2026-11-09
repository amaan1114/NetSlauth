import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { eventIngestionSchema } from "./event.validation.js";
import { ingestEventsService } from "./event.service.js";

export const ingestEventsController: RequestHandler = async (req, res, next) => {
  try {
    const input = eventIngestionSchema.parse(req.body);
    const events = Array.isArray(input) ? input : [input];
    const result = await ingestEventsService(req.agentId!, req.projectId!, events);
    return res.json(new HttpResponse(200, "Events ingested successfully", result));
  } catch (error) {
    next(error);
  }
};
