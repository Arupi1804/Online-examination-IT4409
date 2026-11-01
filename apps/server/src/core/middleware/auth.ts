import type { RequestHandler } from 'express';
import type {} from 'express-session';
import { ERROR_CODES, type Role } from '@online-exam/shared';
import { HttpError } from '../errors/http-error.js';

// Session shape proposed to TV1: login stores `req.session.user`. Until the
// Auth module mounts express-session, `req.session` is undefined and every
// protected route answers 401.
declare module 'express-session' {
  interface SessionData {
    user: { id: string; role: Role };
  }
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.session?.user;
    if (!user) {
      next(
        new HttpError(401, ERROR_CODES.AUTH_SESSION_EXPIRED, 'Login required'),
      );
    } else if (!roles.includes(user.role)) {
      next(new HttpError(403, ERROR_CODES.FORBIDDEN, 'Forbidden'));
    } else {
      next();
    }
  };
}

/** For handlers behind requireRole, where the user is guaranteed. */
export function currentUser(req: Parameters<RequestHandler>[0]) {
  return req.session.user!;
}
