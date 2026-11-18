import type { ApiError } from '@online-exam/shared';

/** Public HTTP errors shared by Auth and business modules. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiError['details'],
  ) {
    super(message);
  }
}
