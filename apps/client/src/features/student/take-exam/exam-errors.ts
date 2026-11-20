import { ZodError } from 'zod';
import { ApiError } from '../../../services/api.ts';
import {
  getRoomErrorMessage,
  isRoomAuthError,
  RoomError,
} from '../room/room-errors.ts';

export class ExamError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'ExamError';
  }
}
export function hasExamErrorCode(error: unknown, code: string) {
  return (
    (error instanceof ApiError ||
      error instanceof ExamError ||
      error instanceof RoomError) &&
    error.code === code
  );
}
export function isExamAuthError(error: unknown) {
  return isRoomAuthError(error);
}
export function getExamErrorMessage(error: unknown): string {
  if (isExamAuthError(error)) return getRoomErrorMessage(error);
  if (error instanceof ZodError)
    return 'Dữ liệu đề thi chưa hợp lệ. Bạn hãy thử lại hoặc báo giáo viên.';
  if (error instanceof TypeError)
    return 'Chưa thể gửi dữ liệu đến máy chủ. Bạn hãy kiểm tra kết nối rồi thử lại.';
  if (
    error instanceof ExamError ||
    error instanceof ApiError ||
    error instanceof RoomError
  ) {
    const messages: Record<string, string> = {
      ATTEMPT_LIMIT_REACHED:
        'Bạn đã sử dụng hết số lượt làm bài của kỳ thi này.',
      EXAM_NOT_STARTED: 'Kỳ thi chưa bắt đầu. Bạn hãy quay lại phòng chờ.',
      EXAM_ENDED:
        'Đã hết thời gian làm bài. Đang chờ máy chủ xác nhận trạng thái bài làm.',
      ATTEMPT_ALREADY_SUBMITTED: 'Bài làm này đã được nộp trên máy chủ.',
      SUBMIT_TOO_LATE:
        'Đã quá thời hạn nộp bài. Đang chờ máy chủ xác nhận trạng thái bài làm.',
      ANSWERS_NOT_SAVED:
        'Còn đáp án chưa lưu thành công. Bạn hãy thử lưu lại trước khi nộp bài.',
      RESPONSE_MISMATCH:
        'Phản hồi không khớp với bài làm. Bạn hãy thử lại hoặc báo giáo viên.',
      FORBIDDEN: 'Bạn không có quyền truy cập hoặc chỉnh sửa bài làm này.',
      NOT_FOUND: 'Không tìm thấy bài làm hoặc kỳ thi của bạn.',
      RATE_LIMITED:
        'Bạn thao tác quá nhanh. Vui lòng đợi một lúc rồi thử lưu lại.',
      VALIDATION_FAILED:
        'Đáp án chưa hợp lệ. Bạn hãy kiểm tra lựa chọn rồi thử lại.',
      INVALID_PAYLOAD:
        'Thông tin bài làm chưa hợp lệ. Bạn hãy thử kết nối lại.',
      REALTIME_TIMEOUT:
        'Máy chủ chưa phản hồi đồng bộ thời gian. Bạn có thể thử kết nối lại.',
    };
    const message = messages[error.code ?? ''];
    if (message) return message;
  }
  return 'Chưa thể hoàn tất thao tác. Bạn hãy thử lại hoặc liên hệ giáo viên.';
}
