import type { ApiError } from '@online-exam/shared';

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiError['details'],
  ) {
    super(message);
  }
}
