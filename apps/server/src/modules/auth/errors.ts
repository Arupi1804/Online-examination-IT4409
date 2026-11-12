import { HttpError } from '../../core/errors/http-error.js';

// Retain Auth-specific instanceof checks for session cleanup and Socket.IO.
export class AuthError extends HttpError {}
