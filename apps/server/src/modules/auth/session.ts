import { createHmac, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import session, { type SessionData } from 'express-session';
import type { Request, RequestHandler, Response } from 'express';
import type { Namespace, Socket } from 'socket.io';
import { AUTH, AuthRole, WS } from '@online-exam/shared';
import { AuthError } from './errors.js';
import { AuthSessionStore } from './services/session-store.js';
import type { Principal } from './types.js';

export type SessionOptions = {
  store: AuthSessionStore;
  secret: string;
  clientOrigin: string;
  secureCookie: boolean;
};

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class AuthSessions {
  readonly sessionStore: AuthSessionStore;
  readonly sessionMiddleware: RequestHandler;
  readonly socketSessionMiddleware: RequestHandler;
  private readonly events = new EventEmitter();
  private readonly cookieOptions;

  constructor(private readonly options: SessionOptions) {
    this.events.setMaxListeners(0);
    this.sessionStore = options.store;
    this.cookieOptions = {
      httpOnly: true,
      secure: options.secureCookie,
      sameSite: 'lax' as const,
      path: '/',
    };
    const middleware = session({
      name: AUTH.COOKIE_NAME,
      secret: options.secret,
      store: options.store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        ...this.cookieOptions,
        maxAge: AUTH.SESSION_IDLE_TTL_SEC * 1000,
      },
    });
    this.sessionMiddleware = (req, res, next) =>
      middleware(req, res, (error?: unknown) => {
        if (error) {
          next(error);
          return;
        }
        void this.prepareHttp(req)
          .then(() => next())
          .catch(async (error: unknown) => {
            if (error instanceof AuthError && error.status === 401) {
              try {
                await this.logout(req, res);
              } catch (cleanupError) {
                next(cleanupError);
                return;
              }
            }
            next(error);
          });
      });
    // Read signed express-session cookies without writing cookies or extending TTL.
    this.socketSessionMiddleware = (req, _res, next) => {
      const sid = this.signedSid(req.headers.cookie);
      if (!sid) {
        next();
        return;
      }
      void this.readSession(sid)
        .then((data) => {
          req.sessionID = sid;
          if (data) Object.assign(req, { session: data });
          next();
        })
        .catch(next);
    };
  }

  private signedSid(header?: string): string | null {
    const item = header
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${AUTH.COOKIE_NAME}=`));
    if (!item) return null;
    let value: string;
    try {
      value = decodeURIComponent(item.slice(AUTH.COOKIE_NAME.length + 1));
    } catch {
      return null;
    }
    if (!value.startsWith('s:')) return null;
    const raw = value.slice(2);
    const dot = raw.lastIndexOf('.');
    if (dot < 1) return null;
    const sid = raw.slice(0, dot);
    const signature = createHmac('sha256', this.options.secret)
      .update(sid)
      .digest('base64')
      .replace(/=+$/, '');
    return equal(raw.slice(dot + 1), signature) ? sid : null;
  }

  readSession(sid: string): Promise<SessionData | null> {
    return new Promise((resolve, reject) =>
      this.sessionStore.get(sid, (error: unknown, data: SessionData | null) =>
        error ? reject(error) : resolve(data ?? null),
      ),
    );
  }

  async getPrincipal(sid?: string): Promise<Principal> {
    if (!sid)
      throw new AuthError(401, 'AUTH_SESSION_EXPIRED', 'Login required');
    const data = await this.readSession(sid);
    if (
      !data?.userId ||
      !AuthRole.safeParse(data.role).success ||
      !data.cookie.expires ||
      new Date(data.cookie.expires).getTime() <= Date.now()
    ) {
      throw new AuthError(401, 'AUTH_SESSION_EXPIRED', 'Session expired');
    }
    const active = await this.sessionStore.redis.get(
      this.sessionStore.activeKey(data.userId),
    );
    if (active !== sid)
      throw new AuthError(
        401,
        active ? 'AUTH_SESSION_REPLACED' : 'AUTH_SESSION_EXPIRED',
        'Session is no longer active',
      );
    return {
      id: data.userId,
      userId: data.userId,
      role: AuthRole.parse(data.role),
      sid,
    };
  }

  private async prepareHttp(req: Request): Promise<void> {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const referer = req.get('referer');
      let source = origin;
      if (!source && referer) {
        try {
          source = new URL(referer).origin;
        } catch {
          throw new AuthError(403, 'FORBIDDEN', 'Untrusted request source');
        }
      }
      const fetchSite = req.get('sec-fetch-site');
      if (
        (source !== undefined && source !== this.options.clientOrigin) ||
        fetchSite === 'cross-site' ||
        (fetchSite !== undefined && source === undefined)
      ) {
        throw new AuthError(403, 'FORBIDDEN', 'Untrusted request source');
      }
    }
    if (req.session.userId) {
      req.principal = await this.getPrincipal(req.sessionID);
      req.session.touch();
      await this.save(req);
    }
  }

  save(req: Request): Promise<void> {
    return new Promise((resolve, reject) =>
      req.session.save((error) => (error ? reject(error) : resolve())),
    );
  }

  async establish(
    req: Request,
    user: { id: string; role: Principal['role'] },
  ): Promise<void> {
    const previous = req.session.userId
      ? { sid: req.sessionID, userId: req.session.userId }
      : undefined;
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.touch();
    const oldSid = await this.sessionStore.activate(req.sessionID, req.session);
    // Prevent express-session from recreating a session replaced concurrently.
    await this.save(req);
    if (oldSid && oldSid !== req.sessionID) this.revoke(oldSid, true);
    if (previous && previous.sid !== oldSid) this.revoke(previous.sid, true);
  }

  async logout(req: Request, res: Response): Promise<void> {
    const sid = req.sessionID;
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    res.clearCookie(AUTH.COOKIE_NAME, this.cookieOptions);
    this.revoke(sid, false);
  }

  requireUser: RequestHandler = (req, _res, next) => {
    if (!req.principal) {
      next(new AuthError(401, 'AUTH_SESSION_EXPIRED', 'Login required'));
      return;
    }
    next();
  };

  requireRoles(...roles: Principal['role'][]): RequestHandler {
    return (req, _res, next) => {
      if (!req.principal) {
        next(new AuthError(401, 'AUTH_SESSION_EXPIRED', 'Login required'));
        return;
      }
      if (!roles.includes(req.principal.role)) {
        next(new AuthError(403, 'FORBIDDEN', 'Insufficient permissions'));
        return;
      }
      next();
    };
  }

  private revoke(sid: string, replaced: boolean) {
    this.events.emit(sid, replaced);
  }

  // Call once on the existing /exam namespace; this never creates a second Server.
  attachSocketAuthentication(namespace: Namespace): void {
    namespace.use((socket, next) => {
      if (
        socket.handshake.headers.origin &&
        socket.handshake.headers.origin !== this.options.clientOrigin
      ) {
        next(
          Object.assign(new Error('Untrusted socket Origin'), {
            data: { code: 'FORBIDDEN' },
          }),
        );
        return;
      }
      void this.getPrincipal(
        (socket.request as typeof socket.request & { sessionID?: string })
          .sessionID,
      )
        .then((principal) => {
          socket.data.principal = principal;
          next();
        })
        .catch((error: unknown) => {
          const reason =
            error instanceof AuthError
              ? error
              : new AuthError(
                  503,
                  'SERVICE_UNAVAILABLE',
                  'Authentication unavailable',
                );
          next(
            Object.assign(new Error(reason.message), {
              data: { code: reason.code },
            }),
          );
        });
    });
    namespace.on('connection', (socket) => this.watchSocket(socket));
  }

  private watchSocket(socket: Socket): void {
    const principal = socket.data.principal as Principal;
    void socket.join(`user:${principal.userId}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disconnect = (replaced = false) => {
      if (replaced) socket.emit(WS.SESSION_REPLACED, {});
      socket.disconnect(true);
    };
    this.events.on(principal.sid, disconnect);
    socket.use((packet, next) => {
      void this.getPrincipal(principal.sid)
        .then(() => next())
        .catch((error: unknown) => {
          const reason =
            error instanceof AuthError
              ? error
              : new AuthError(
                  503,
                  'SERVICE_UNAVAILABLE',
                  'Authentication unavailable',
                );
          const ack: unknown = packet.at(-1);
          if (typeof ack === 'function')
            ack({
              ok: false,
              error: { code: reason.code, message: reason.message },
            });
          disconnect(reason.code === 'AUTH_SESSION_REPLACED');
        });
    });
    const scheduleExpiry = async () => {
      try {
        await this.getPrincipal(principal.sid);
        const data = await this.readSession(principal.sid);
        if (!socket.connected) return;
        const remaining =
          new Date(data!.cookie.expires!).getTime() - Date.now();
        timer = setTimeout(
          () => void scheduleExpiry(),
          Math.max(1, Math.min(remaining, 2_147_483_647)),
        );
        timer.unref();
      } catch {
        disconnect();
      }
    };
    void scheduleExpiry();
    socket.once('disconnect', () => {
      if (timer) clearTimeout(timer);
      this.events.off(principal.sid, disconnect);
    });
  }
}
