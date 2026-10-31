/* SHARED CONTRACT: gom tên sự kiện Socket.IO và kiểu dữ liệu trao đổi giữa client/server */

// Nhóm event phía client yêu cầu server thực hiện nghiệp vụ; các key JS thân thiện được ánh xạ sang tên sự kiện truyền trên wire.
export const clientEvents = {
  join: 'room:join', // client xin tham gia phòng thi bằng examId hoặc roomCode
  start: 'exam:start', // giáo viên yêu cầu bắt đầu kỳ thi
  extend: 'exam:extend', // giáo viên yêu cầu gia hạn đồng hồ
  rejoin: 'attempt:rejoin', // học sinh khôi phục bài làm sau mất kết nối
  forceSubmit: 'attempt:force_submit', // giáo viên buộc nộp bài
  heartbeat: 'proctor:heartbeat', // học sinh xác nhận còn hoạt động
  violation: 'proctor:violation', // học sinh báo sự kiện cần ghi log giám sát
} as const;

// Nhóm event phía server gửi ra; dùng hằng thay vì gõ chuỗi ở nhiều file để giảm lỗi chính tả
export const serverEvents = {
  roomState: 'room:state', // Trạng thái phòng vừa join: đồng hồ, mã phòng và người đang kết nối
  participantJoined: 'participant:joined', // Thông báo một socket mới xuất hiện trong phòng
  participantLeft: 'participant:left', // Thông báo socket ngắt kết nối; không đồng nghĩa học sinh offline ngay
  examStarted: 'exam:started', // Thông báo trạng thái kỳ thi đã RUNNING
  examExtended: 'exam:extended', // Thông báo endTime mới sau khi gia hạn
  timerSync: 'timer:sync', // Thông tin serverTime/endTime dùng đồng bộ đồng hồ client
  examEnded: 'exam:ended', // Kỳ thi đã được xác nhận kết thúc và commit vào DB
  attemptState: 'attempt:state', // Gửi lại nội dung bài làm đã lưu cho chủ sở hữu attempt
  attemptSubmitted: 'attempt:submitted', // Thông báo một attempt được chốt/nộp thành công
  studentUpdate: 'monitor:student_update', // Thông tin cập nhật dashboard giám sát của giáo viên
  sessionReplaced: 'session:replaced', // Phiên cũ bị thay thế; client phải đăng nhập lại
} as const;

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';
export type ExamStatus = 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'ENDED';
export type AttemptStatus =
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'AUTO_SUBMITTED'
  | 'FORCE_SUBMITTED';
export type ViolationType =
  | 'TAB_BLUR'
  | 'FULLSCREEN_EXIT'
  | 'COPY_PASTE'
  | 'DISCONNECT';
export type RealtimeErrorCode =
  | 'UNAUTHENTICATED'
  | 'SESSION_REPLACED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_PAYLOAD'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: RealtimeErrorCode; message: string } };

// DTO thời gian: ID, trạng thái và hai mốc start/end theo ISO UTC; null khi chưa bắt đầu
export type ExamClock = {
  examId: string;
  status: ExamStatus;
  startTime: string | null;
  endTime: string | null;
  serverTime: string;
};

// Mở rộng ExamClock với mã phòng, số socket; monitor chỉ có với role giám sát
export type RoomState = ExamClock & {
  roomCode: string;
  participantCount: number;
  monitor?: StudentUpdate[];
};

// Bài làm phục hồi: đáp án đã chọn và đồng hồ hiện tại
export type AttemptState = {
  attemptId: string;
  examId: string;
  status: AttemptStatus;
  submittedAt: string | null;
  answers: { questionId: string; optionIds: string[] }[]; // Tập optionId đã chọn cho từng câu, không chứa cờ is_correct
  clock: ExamClock; // Snapshot ExamClock đi kèm trạng thái bài làm
};

// Dữ liệu giám sát từng học sinh: presence, tiến độ, số vi phạm và trạng thái
export type StudentUpdate = {
  examId: string;
  attemptId: string;
  userId: string;
  online: boolean; // Cờ tính từ heartbeat 30 giây gần đây và trạng thái IN_PROGRESS
  lastHeartbeat: string | null; // ISO UTC thời điểm heartbeat gần nhất hoặc null
  answeredCount: number; // Tổng số câu đã có answer trong DB
  violationCount: number; // Tổng số log vi phạm trong DB
  lastViolation: { type: ViolationType; at: string } | null; // Vi phạm gần nhất gồm type và timestamp DB, hoặc null
  status: AttemptStatus; // Trạng thái bài làm
};

// Kết quả tối thiểu sau khi chốt attempt, để thông báo mà không lộ điểm/đáp án
export type Submitted = {
  examId: string;
  attemptId: string;
  userId: string;
  status: AttemptStatus;
  submittedAt: string; // Timestamp nộp chính thức ISO UTC từ DB
};
