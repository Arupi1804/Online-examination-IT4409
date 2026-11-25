import type { AttemptPaper } from '../../src/features/student/take-exam/exam-model.ts';
import type { AttemptResult } from '../../src/features/student/results/result-model.ts';

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

export function buildResult(
  paper: AttemptPaper,
  answers: Map<string, { selectedOptionIds: string[] }>,
  published = false,
): AttemptResult {
  const questions = paper.questions.map((question, index) => {
    const correct =
      index === 1 ? [oid(21), oid(22)] : index === 2 ? [oid(31)] : [oid(11)];
    const selectedOptionIds =
      answers.get(question.questionId)?.selectedOptionIds ?? [];
    const full =
      correct.length === selectedOptionIds.length &&
      correct.every((id) => selectedOptionIds.includes(id));
    return {
      ...question,
      explanation: `Lời giải từ server cho câu ${index + 1}.`,
      selectedOptionIds,
      earnedPoints: full
        ? question.points
        : question.type === 'MULTIPLE' &&
            selectedOptionIds.length > 0 &&
            selectedOptionIds.every((id) => correct.includes(id))
          ? 0.5
          : 0,
      options: question.options.map((option) => ({
        ...option,
        isCorrect: correct.includes(option.id),
      })),
    };
  });
  return {
    attemptId: paper.attemptId,
    examId: paper.examId,
    examTitle: 'Kiểm tra Công nghệ Web',
    status: paper.status === 'IN_PROGRESS' ? 'SUBMITTED' : paper.status,
    startedAt: paper.startedAt,
    submittedAt: paper.serverTime,
    score: questions.reduce((sum, question) => sum + question.earnedPoints, 0),
    maxScore: questions.reduce((sum, question) => sum + question.points, 0),
    questions: published ? questions : null,
  };
}
