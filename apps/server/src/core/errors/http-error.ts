import type { ApiError } from '@online-exam/shared';

/** Thrown by services; the error handler turns it into `{ error }`. */
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
