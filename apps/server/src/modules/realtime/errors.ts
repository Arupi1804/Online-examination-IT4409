/* LỖI NGHIỆP VỤ VÀ KIỂM TRA PAYLOAD SOCKET.IO */

import type { RealtimeErrorCode } from '../../shared/realtime.js';

// Lỗi nghiệp vụ có mã xác định
export class RealtimeError extends Error {
  constructor(
    public readonly code: RealtimeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// Kiểm tra ID chưa tin cậy: tham số value là input bất kỳ, name dùng trong thông báo; trả UUID chuẩn chữ thường
export function assertUuid(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new RealtimeError('INVALID_PAYLOAD', `${name} must be a UUID`);
  }
  return value.toLowerCase();
}

// Bảo đảm payload là object thông thường, không phải null hoặc mảng
export function objectPayload(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RealtimeError('INVALID_PAYLOAD', 'Expected an object payload');
  }
  return value as Record<string, unknown>;
}

// Kiểm tra tham số số nguyên dương trong khoảng [1,max], dùng cho additionalSec
export function positiveInteger(
  value: unknown,
  name: string,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new RealtimeError(
      'INVALID_PAYLOAD',
      `${name} must be an integer from 1 to ${max}`,
    );
  }
  return value;
}
