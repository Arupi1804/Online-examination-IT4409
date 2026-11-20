import type { AttemptPaper } from '../../src/features/student/take-exam/exam-model.ts';

export const examId = 'c9ec68a2-0000-4000-8000-000000000001';
export const attemptId = 'd1000000-0000-4000-8000-000000000001';
export const profile = {
  id: '96ed2849-40c0-4e85-85d4-a85f3aff1f01',
  email: 'student1@test.com',
  name: 'Thí sinh kiểm thử',
  role: 'STUDENT',
};
export const qid = (index: number) =>
  `a1000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export const oid = (index: number) =>
  `b1000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

export function buildPaper(
  remainingSec = 1200,
  serverOffsetMs = 0,
): AttemptPaper {
  const now = Date.now() + serverOffsetMs;
  return {
    attemptId,
    examId,
    status: 'IN_PROGRESS',
    startedAt: new Date(now - 300000).toISOString(),
    endTime: new Date(now + remainingSec * 1000).toISOString(),
    serverTime: new Date(now).toISOString(),
    answers: [],
    questions: [
      {
        questionId: qid(1),
        type: 'SINGLE',
        content: 'Phương thức HTTP nào thường dùng để lấy dữ liệu?',
        points: 1,
        options: [
          { id: oid(11), content: 'GET' },
          { id: oid(12), content: 'POST' },
          { id: oid(13), content: 'DELETE' },
        ],
      },
      {
        questionId: qid(2),
        type: 'MULTIPLE',
        content: 'Những mã trạng thái nào thuộc nhóm thành công?',
        points: 1,
        options: [
          { id: oid(21), content: '200 OK' },
          { id: oid(22), content: '201 Created' },
          { id: oid(23), content: '404 Not Found' },
        ],
      },
      {
        questionId: qid(3),
        type: 'TRUE_FALSE',
        content: 'HTTPS mã hóa dữ liệu truyền giữa trình duyệt và máy chủ.',
        points: 1,
        options: [
          { id: oid(31), content: 'Đúng' },
          { id: oid(32), content: 'Sai' },
        ],
      },
    ],
  };
}
