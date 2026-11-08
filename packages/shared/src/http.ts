export interface SuccessResponse<T = unknown> {
  success: true;
  statusCode: number;
  message: string;
  data?: T;
}

export interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  errors?: unknown;
}
