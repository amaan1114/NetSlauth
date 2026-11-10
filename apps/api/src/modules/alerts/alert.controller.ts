import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { projectParamsSchema } from "../projects/project.validation.js";
import { alertParamsSchema, alertQuerySchema, alertStatusSchema, relatedEventsQuerySchema } from "./alert.validation.js";
import { getAlertService, getAlertsService, getRelatedEventsService, setAlertStatusService } from "./alert.service.js";

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

export const getAlertController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId, alertId } = alertParamsSchema.parse(req.params);
    const data = await getAlertService(req.userId!, projectId, alertId);
    return res.json(new HttpResponse(200, "Alert retrieved successfully", data));
  } catch (error) {
    next(error);
  }
};

export const setAlertStatusController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId, alertId } = alertParamsSchema.parse(req.params);
    const { status } = alertStatusSchema.parse(req.body);
    const data = await setAlertStatusService(req.userId!, projectId, alertId, status);
    return res.json(new HttpResponse(200, "Alert status updated successfully", data));
  } catch (error) {
    next(error);
  }
};

export const getRelatedEventsController: RequestHandler = async (req, res, next) => {
  try {
    const { projectId, alertId } = alertParamsSchema.parse(req.params);
    const { page, limit } = relatedEventsQuerySchema.parse(req.query);
    const data = await getRelatedEventsService(req.userId!, projectId, alertId, page, limit);
    return res.json(new HttpResponse(200, "Related events retrieved successfully", data));
  } catch (error) {
    next(error);
  }
};
