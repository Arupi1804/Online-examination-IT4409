import { ZodError } from 'zod';
import { ApiError } from '../../../services/api.ts';

export class RoomError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'RoomError';
  }
}

export function isRoomAuthError(error: unknown) {
  return (
    (error instanceof ApiError && error.status === 401) ||
    ((error instanceof RoomError || error instanceof ApiError) &&
      [
        'UNAUTHENTICATED',
        'SESSION_REPLACED',
        'AUTH_SESSION_EXPIRED',
        'AUTH_SESSION_REPLACED',
      ].includes(error.code ?? ''))
  );
}

export function getRoomErrorMessage(error: unknown): string {
  if (isRoomAuthError(error))
    return 'Phiên đăng nhập đã hết hạn hoặc được thay thế. Bạn hãy đăng nhập lại.';
  if (error instanceof ZodError)
    return 'Dữ liệu phòng thi chưa hợp lệ. Bạn hãy thử lại hoặc báo giáo viên.';
  if (error instanceof TypeError)
    return 'Không thể kết nối đến máy chủ. Bạn hãy kiểm tra mạng rồi thử lại.';
  if (error instanceof RoomError || error instanceof ApiError) {
    const messages: Record<string, string> = {
      ROOM_NOT_FOUND:
        'Không tìm thấy phòng thi. Bạn hãy kiểm tra mã với giáo viên.',
      NOT_FOUND: 'Không tìm thấy phòng thi hoặc bạn chưa được phép vào phòng.',
      EXAM_ENDED:
        'Kỳ thi đã kết thúc. Bạn hãy liên hệ giáo viên nếu cần hỗ trợ.',
      FORBIDDEN: 'Tài khoản của bạn không có quyền vào phòng thi này.',
      INVALID_STATE:
        'Phòng thi chưa mở hoặc đã kết thúc. Bạn hãy kiểm tra với giáo viên.',
      INVALID_PAYLOAD:
        'Thông tin phòng thi chưa hợp lệ. Bạn hãy nhập lại mã phòng.',
      VALIDATION_FAILED: 'Mã phòng chưa hợp lệ. Bạn hãy kiểm tra lại.',
      RATE_LIMITED:
        'Bạn đã thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.',
      ROOM_TIMEOUT:
        'Máy chủ chưa phản hồi yêu cầu vào phòng. Bạn hãy thử kết nối lại.',
      ROOM_DISCONNECTED:
        'Kết nối phòng thi đã bị ngắt. Bạn hãy thử kết nối lại.',
      ROOM_MISMATCH:
        'Thông tin phòng trả về không khớp. Bạn hãy nhập lại mã phòng.',
      ROOM_NOT_SAVED:
        'Bạn chưa vào phòng này hoặc thông tin phòng đã hết hạn. Hãy nhập lại mã phòng.',
    };
    const message = messages[error.code ?? ''];
    if (message) return message;
    if (error instanceof ApiError) {
      if (error.status === 404) return messages.ROOM_NOT_FOUND!;
      if (error.status === 429) return messages.RATE_LIMITED!;
    }
  }
  return 'Chưa thể kết nối phòng thi. Bạn hãy thử lại sau ít phút.';
}
