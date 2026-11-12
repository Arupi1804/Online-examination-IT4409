import { ApiError } from '../../services/api.ts';

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Không thể kết nối đến máy chủ. Bạn hãy kiểm tra mạng rồi thử lại.';
  }
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      AUTH_INVALID_CREDENTIALS:
        'Email hoặc mật khẩu chưa đúng. Bạn hãy thử lại.',
      AUTH_SESSION_EXPIRED:
        'Phiên đăng nhập đã hết hạn. Bạn hãy đăng nhập lại.',
      AUTH_SESSION_REPLACED:
        'Tài khoản đã được đăng nhập ở thiết bị khác. Bạn hãy đăng nhập lại.',
      FORBIDDEN: 'Tài khoản của bạn không có quyền thực hiện thao tác này.',
      VALIDATION_FAILED:
        'Thông tin chưa hợp lệ. Bạn hãy kiểm tra lại các trường bên dưới.',
      EMAIL_TAKEN:
        'Email này đã được sử dụng. Bạn có thể đăng nhập hoặc dùng email khác.',
      RATE_LIMITED:
        'Bạn đã thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.',
      SERVICE_UNAVAILABLE:
        'Dịch vụ đang tạm gián đoạn. Bạn hãy thử lại sau ít phút.',
    };
    const message = error.code ? messages[error.code] : undefined;
    if (message) return message;
    if (error.status === 429)
      return 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.';
    if (error.status === 409)
      return 'Email này đã được sử dụng. Bạn có thể đăng nhập hoặc dùng email khác.';
    if (error.status >= 500)
      return 'Máy chủ đang gặp sự cố. Bạn hãy thử lại sau ít phút.';
  }
  return 'Chưa thể hoàn tất thao tác. Bạn hãy thử lại.';
}
