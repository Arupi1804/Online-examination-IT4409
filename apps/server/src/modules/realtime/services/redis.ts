/* TẦNG LƯU TRẠNG THÁI TẠM THỜI TRÊN REDIS */

import type { Redis } from 'ioredis';
import type { Exam } from './repository.js';
import { RealtimeError } from '../errors.js';

// Lua: INCR counter cho user/event; chỉ đặt TTL 60 giây ở lần tăng từ 0 lên 1
const RATE_SCRIPT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n`;

// Lua: cập nhật timestamp vào sorted set presence, xóa cờ offline và đặt TTL đồng bộ
const HEARTBEAT_SCRIPT = `
local old=redis.call('ZSCORE',KEYS[1],ARGV[1]);
redis.call('ZADD',KEYS[1],'GT',ARGV[2],ARGV[1]);
if not old then redis.call('ZADD',KEYS[1],ARGV[2],ARGV[1]); end;
local offline=redis.call('SREM',KEYS[2],ARGV[1]);
redis.call('PEXPIREAT',KEYS[1],ARGV[3]); redis.call('PEXPIREAT',KEYS[2],ARGV[3]);
return {old and 0 or 1,offline}`;

// Lua: chỉ đánh dấu offline khi heartbeat cũ hơn ngưỡng 30 giây
const OFFLINE_SCRIPT = `
local score=redis.call('ZSCORE',KEYS[1],ARGV[1]);
if not score or tonumber(score)>tonumber(ARGV[2]) then return 0; end;
local added=redis.call('SADD',KEYS[2],ARGV[1]);
local ttl=redis.call('PTTL',KEYS[1]);
if ttl>0 then redis.call('PEXPIRE',KEYS[2],ttl); end;
return added;`;

// Lua: cập nhật cache runtime có phòng vệ chống ghi lùi trạng thái/giờ kết thúc
const RUNTIME_SCRIPT = `
local oldStatus=redis.call('HGET',KEYS[1],'status');
local oldEnd=tonumber(redis.call('HGET',KEYS[1],'endTimeMs') or '0');
local ranks={DRAFT=1,SCHEDULED=2,RUNNING=3,ENDED=4};
if oldStatus and (ranks[oldStatus] or 0)>(ranks[ARGV[1]] or 0) then return 0; end;
if oldStatus==ARGV[1] and oldEnd>tonumber(ARGV[3]) then return 0; end;
redis.call('HSET',KEYS[1],'status',ARGV[1],'startTimeMs',ARGV[2],'endTimeMs',ARGV[3]);
redis.call('PEXPIREAT',KEYS[1],ARGV[4]); return 1;`;

export class RealtimeRedis {
    constructor(private readonly redis: Redis, private readonly prefix = 'oe:dev:v1') { }

    private key(...parts: string[]): string { return `${this.prefix}:${parts.join(':')}`; }

    // Kiểm tra phiên hiện tại của user từ key do Auth quản lý
    async assertActiveSession(userId: string, sid: string): Promise<void> {
        const active = await this.redis.get(this.key('auth', 'user', userId, 'active_session'));
        if (active !== sid) throw new RealtimeError(active ? 'SESSION_REPLACED' : 'UNAUTHENTICATED', 'Session is no longer active');
    }

    // Giới hạn số event của mỗi user/event trong một cửa sổ 60 giây
    async rateLimit(userId: string, event: string, limit: number): Promise<void> {
        const slug = event.replaceAll(':', '_');
        const n = Number(await this.redis.eval(RATE_SCRIPT, 1, this.key('rl', 'ws', userId, slug), '60'));
        if (n > limit) throw new RealtimeError('RATE_LIMITED', 'Too many events; retry later');
    }

    // Lưu bản sao status và thời gian kỳ thi để phục vụ đồng bộ nhanh
    async cacheRuntime(exam: Exam): Promise<void> {
        const start = exam.start_time?.getTime() ?? 0;
        const end = exam.end_time?.getTime() ?? 0;
        const expiry = exam.status === 'RUNNING' ? end + 86400_000 : Date.now() + 3600_000;
        await this.redis.eval(RUNTIME_SCRIPT, 1, this.key('exam', exam.id, 'runtime'), exam.status,
            String(start), String(end), String(Math.max(expiry, Date.now() + 1000)));
    }

    // Ghi nhận học sinh đang online; trả true nếu mới online hoặc vừa trở lại
    async heartbeat(exam: Exam, attemptId: string): Promise<boolean> {
        if (!exam.end_time) throw new RealtimeError('INVALID_STATE', 'Exam has no deadline');
        const expiry = exam.end_time.getTime() + 3600_000;
        const result = await this.redis.eval(HEARTBEAT_SCRIPT, 2,
            this.key('exam', exam.id, 'presence'), this.key('exam', exam.id, 'offline_notified'),
            attemptId, String(Date.now()), String(Math.max(expiry, Date.now() + 1000))) as number[];
        return Number(result[0]) === 1 || Number(result[1]) === 1;
    }

    // Lấy timestamp heartbeat cuối từ score Redis sorted set
    async lastHeartbeat(examId: string, attemptId: string): Promise<number | null> {
        const score = await this.redis.zscore(this.key('exam', examId, 'presence'), attemptId);
        return score === null ? null : Number(score);
    }

    // Liệt kê những attempt có heartbeat nhỏ hơn ngưỡng offline
    async offlineCandidates(examId: string, beforeMs: number): Promise<string[]> {
        return this.redis.zrangebyscore(this.key('exam', examId, 'presence'), '-inf', String(beforeMs));
    }

    // Ghi đánh dấu offline nguyên tử, chống trùng thông báo
    async markOffline(examId: string, attemptId: string, beforeMs: number): Promise<boolean> {
        return Number(await this.redis.eval(OFFLINE_SCRIPT, 2,
            this.key('exam', examId, 'presence'), this.key('exam', examId, 'offline_notified'),
            attemptId, String(beforeMs))) === 1;
    }

    // Xóa trạng thái tạm khi attempt đã nộp
    async removePresence(examId: string, attemptId: string): Promise<void> {
        await this.redis.multi()
            .zrem(this.key('exam', examId, 'presence'), attemptId)
            .srem(this.key('exam', examId, 'offline_notified'), attemptId).exec();
    }
}
