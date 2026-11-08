import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { ErrorResponse } from "@workspace/netsleuth-shared";
import { HttpError } from "../utils/HttpError.js";

export const globalErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  let statusCode = 500;
  let message = "Internal server error";
  let errors: unknown;

  if (error instanceof HttpError) {
    statusCode = error.statusCode;
    message = error.message;
    errors = error.errors;
  } else if (error instanceof ZodError) {
    statusCode = 400;
    message = "Validation failed";
    errors = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  } else if (error && typeof error === "object" && "type" in error) {
    if (error.type === "entity.parse.failed") {
      statusCode = 400;
      message = "Invalid JSON body";
    } else if (error.type === "entity.too.large") {
      statusCode = 413;
      message = "Request body is too large";
    }
  }

  if (statusCode === 500) {
    // Do not log error objects that may contain request bodies or connection URLs.
    console.error("Unexpected API error");
  }

  const body: ErrorResponse = { success: false, statusCode, message };
  if (errors !== undefined) body.errors = errors;
  res.status(statusCode).json(body);
};
