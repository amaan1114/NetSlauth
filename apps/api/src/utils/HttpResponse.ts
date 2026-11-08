import type { SuccessResponse } from "@workspace/netsleuth-shared";

export class HttpResponse<T = unknown> implements SuccessResponse<T> {
  readonly success = true as const;

  constructor(
    public readonly statusCode: number,
    public readonly message: string,
    public readonly data?: T,
  ) {}
}
