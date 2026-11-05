import { RedisStore } from 'connect-redis';
import type { SessionData } from 'express-session';
import type { createClient } from 'redis';
import { AUTH } from '@online-exam/shared';
import { AuthError } from '../errors.js';
import '../types.js';

export type AuthRedis = ReturnType<typeof createClient>;
const ACTIVATE = `
local old=redis.call('GET',KEYS[2])
redis.call('SET',KEYS[1],ARGV[2],'PXAT',ARGV[3])
redis.call('SET',KEYS[2],ARGV[1],'PXAT',ARGV[3])
if old and old~=ARGV[1] then redis.call('DEL',ARGV[4]..old) end
return old`;
const SAVE = `
if redis.call('GET',KEYS[2])~=ARGV[1] then return 0 end
if redis.call('EXISTS',KEYS[1])==0 then return 0 end
redis.call('SET',KEYS[1],ARGV[2],'PXAT',ARGV[3])
redis.call('PEXPIREAT',KEYS[2],ARGV[3])
return 1`;
const DESTROY = `
local data=redis.call('GET',KEYS[1])
if data then
 local session=cjson.decode(data)
 if session.userId then
  local active=ARGV[2]..session.userId..':active_session'
  if redis.call('GET',active)==ARGV[1] then redis.call('DEL',active) end
 end
end
return redis.call('DEL',KEYS[1])`;
const LIMIT = `
local blocked=0
for i,key in ipairs(KEYS) do
 local count=redis.call('INCR',key)
 if count==1 then redis.call('EXPIRE',key,ARGV[1]) end
 if count>tonumber(ARGV[i+1]) then blocked=1 end
end
return blocked`;

export class AuthSessionStore extends RedisStore {
  readonly sessionPrefix: string;
  constructor(
    readonly redis: AuthRedis,
    readonly keyPrefix: string,
  ) {
    super({
      client: redis,
      prefix: `${keyPrefix}:sess:`,
      ttl: AUTH.SESSION_IDLE_TTL_SEC,
      disableTouch: true,
    });
    this.sessionPrefix = `${keyPrefix}:sess:`;
  }

  activeKey(userId: string) {
    return `${this.keyPrefix}:auth:user:${userId}:active_session`;
  }

  async activate(sid: string, data: SessionData): Promise<string | null> {
    if (!data.userId) throw new Error('Authenticated session required');
    return (await this.redis.eval(ACTIVATE, {
      keys: [this.sessionPrefix + sid, this.activeKey(data.userId)],
      arguments: [
        sid,
        JSON.stringify(data),
        String(this.expiry(data)),
        this.sessionPrefix,
      ],
    })) as string | null;
  }

  private expiry(data: SessionData): number {
    return Math.min(
      new Date(
        data.cookie.expires ?? Date.now() + AUTH.SESSION_IDLE_TTL_SEC * 1000,
      ).getTime(),
      Date.now() + AUTH.SESSION_IDLE_TTL_SEC * 1000,
    );
  }

  override async set(
    sid: string,
    data: SessionData,
    callback?: (error?: unknown) => void,
  ): Promise<void> {
    if (!data.userId) return super.set(sid, data, callback);
    try {
      const saved = await this.redis.eval(SAVE, {
        keys: [this.sessionPrefix + sid, this.activeKey(data.userId)],
        arguments: [sid, JSON.stringify(data), String(this.expiry(data))],
      });
      if (Number(saved) !== 1)
        throw new AuthError(
          401,
          'AUTH_SESSION_REPLACED',
          'Session is no longer active',
        );
      callback?.();
    } catch (error) {
      if (callback) callback(error);
      else throw error;
    }
  }

  override async destroy(
    sid: string,
    callback?: (error?: unknown) => void,
  ): Promise<void> {
    try {
      await this.redis.eval(DESTROY, {
        keys: [this.sessionPrefix + sid],
        arguments: [sid, `${this.keyPrefix}:auth:user:`],
      });
      callback?.();
    } catch (error) {
      if (callback) callback(error);
      else throw error;
    }
  }

  async consumeLimit(
    keys: string[],
    limits: number[],
    windowSec = 900,
  ): Promise<void> {
    const blocked = await this.redis.eval(LIMIT, {
      keys,
      arguments: [String(windowSec), ...limits.map(String)],
    });
    if (Number(blocked))
      throw new AuthError(
        429,
        'RATE_LIMITED',
        'Too many attempts; try again later',
      );
  }
}
