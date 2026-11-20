import { ApiError } from '../../../services/api.ts';
import {
  attemptPaperSchema,
  validSelection,
  type AttemptPaper,
  type ExamService,
  type PaperQuestion,
  type Submission,
  sameSelection,
  isoTime,
} from './exam-model.ts';
import type { AttemptResult } from '../results/result-model.ts';

function sampleQuestions(): PaperQuestion[] {
  const content = [
    {
      type: 'SINGLE' as const,
      text: 'Phương thức HTTP nào thường dùng để lấy dữ liệu từ máy chủ?',
      options: ['GET', 'POST', 'DELETE', 'PATCH'],
    },
    {
      type: 'MULTIPLE' as const,
      text: 'Những mã trạng thái HTTP nào thuộc nhóm phản hồi thành công?',
      options: [
        '200 OK',
        '201 Created',
        '404 Not Found',
        '500 Internal Server Error',
      ],
    },
    {
      type: 'TRUE_FALSE' as const,
      text: 'HTTPS mã hóa dữ liệu truyền giữa trình duyệt và máy chủ.',
      options: ['Đúng', 'Sai'],
    },
    {
      type: 'SINGLE' as const,
      text: 'Trong React, thuộc tính nào giúp nhận diện ổn định các phần tử khi hiển thị một danh sách?',
      options: ['key', 'className', 'title', 'style'],
    },
    {
      type: 'MULTIPLE' as const,
      text: 'Những thao tác nào giúp biểu mẫu dễ sử dụng với bàn phím và trình đọc màn hình?',
      options: [
        'Liên kết label với ô nhập',
        'Hiển thị thông báo lỗi rõ ràng',
        'Chỉ dùng màu để báo lỗi',
        'Giữ thứ tự focus hợp lý',
      ],
    },
    {
      type: 'SINGLE' as const,
      text: 'Cookie session thường được gửi kèm request fetch đến backend như thế nào?',
      options: [
        'Đặt credentials: "include"',
        'Gửi mật khẩu trong URL',
        'Lưu role vào nội dung trang',
        'Tắt kiểm tra quyền ở server',
      ],
    },
  ];
  return content.map((question, index) => ({
    questionId: `a1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    type: question.type,
    content: question.text,
    points: 1,
    options: question.options.map((text, optionIndex) => ({
      id: `b1000000-0000-4000-8000-${String((index + 1) * 10 + optionIndex).padStart(12, '0')}`,
      content: text,
    })),
  }));
}

// This is a development-only backend simulation. Production never selects it.
export function createMockExamService(): ExamService {
  type Record = {
    userId: string;
    paper: AttemptPaper;
    submittedAt: string | null;
  };
  const records = new Map<string, Record>();
  const keyFor = (userId: string, examId: string) =>
    `oe:dev:attempt:${userId}:${examId}`;
  function persist(record: Record) {
    try {
      sessionStorage.setItem(
        keyFor(record.userId, record.paper.examId),
        JSON.stringify({ ...record.paper, devSubmittedAt: record.submittedAt }),
      );
    } catch {
      /* Memory still works. */
    }
  }
  function load(userId: string, examId: string): Record | undefined {
    const key = keyFor(userId, examId);
    let record = records.get(key);
    if (record) return record;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        const paper = attemptPaperSchema.parse(value);
        if (paper.examId === examId) {
          const at =
            value && typeof value === 'object' && 'devSubmittedAt' in value
              ? isoTime.safeParse(value.devSubmittedAt)
              : null;
          record = {
            userId,
            paper,
            submittedAt: at?.success
              ? at.data
              : paper.status !== 'IN_PROGRESS'
                ? paper.serverTime
                : null,
          };
          records.set(key, record);
        }
      }
    } catch {
      /* No valid development record. */
    }
    return record;
  }
  async function wait() {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!navigator.onLine) throw new TypeError('Offline');
  }
  function find(attemptId: string) {
    const record = [...records.values()].find(
      (record) => record.paper.attemptId === attemptId,
    );
    if (!record) throw new ApiError(404, 'Not found', 'NOT_FOUND');
    return record;
  }
  return {
    async start(userId, examId) {
      await wait();
      if (
        ![
          'c9ec68a2-0000-4000-8000-000000000001',
          'c9ec68a2-0000-4000-8000-000000000002',
        ].includes(examId)
      )
        throw new ApiError(404, 'Not found', 'NOT_FOUND');
      if (examId.endsWith('000001'))
        throw new ApiError(422, 'Not started', 'EXAM_NOT_STARTED');
      const key = keyFor(userId, examId);
      let record = load(userId, examId);
      if (!record) {
        if (!record)
          record = {
            userId,
            submittedAt: null,
            paper: {
              attemptId: crypto.randomUUID(),
              examId,
              status: 'IN_PROGRESS',
              startedAt: new Date().toISOString(),
              endTime: new Date(Date.now() + 2700000).toISOString(),
              serverTime: new Date().toISOString(),
              questions: sampleQuestions(),
              answers: [],
            },
          };
        records.set(key, record);
      }
      record.paper.serverTime = new Date().toISOString();
      persist(record);
      return {
        paper: structuredClone(record.paper),
        clock: {
          examId,
          status: 'RUNNING',
          endTime: record.paper.endTime,
          serverTime: record.paper.serverTime,
          receivedAt: performance.now(),
          roundTripMs: 0,
        },
      };
    },
    async save(attemptId, questionId, selectedOptionIds) {
      await wait();
      const record = find(attemptId);
      if (record.paper.status !== 'IN_PROGRESS')
        throw new ApiError(409, 'Submitted', 'ATTEMPT_ALREADY_SUBMITTED');
      if (Date.now() >= Date.parse(record.paper.endTime))
        throw new ApiError(422, 'Ended', 'EXAM_ENDED');
      const question = record.paper.questions.find(
        (question) => question.questionId === questionId,
      );
      if (!question || !validSelection(question, selectedOptionIds))
        throw new ApiError(400, 'Invalid selection', 'VALIDATION_FAILED');
      const answer = {
        questionId,
        selectedOptionIds: [...selectedOptionIds],
        updatedAt: new Date().toISOString(),
      };
      record.paper.answers = [
        ...record.paper.answers.filter(
          (saved) => saved.questionId !== questionId,
        ),
        answer,
      ];
      persist(record);
      return structuredClone(answer);
    },
    async submit(attemptId) {
      await wait();
      const record = find(attemptId);
      if (record.paper.status !== 'IN_PROGRESS')
        throw new ApiError(409, 'Submitted', 'ATTEMPT_ALREADY_SUBMITTED');
      if (Date.now() > Date.parse(record.paper.endTime) + 5000)
        throw new ApiError(422, 'Late', 'SUBMIT_TOO_LATE');
      record.paper.status = 'SUBMITTED';
      record.submittedAt = new Date().toISOString();
      persist(record);
      return {
        examId: record.paper.examId,
        attemptId,
        status: 'SUBMITTED',
        submittedAt: record.submittedAt,
      };
    },
    watch(paper, callbacks) {
      const record = find(paper.attemptId);
      let active = true;
      function recover() {
        if (!active || !navigator.onLine) {
          if (active) callbacks.onConnection(false);
          return;
        }
        if (record.paper.status !== 'IN_PROGRESS') {
          callbacks.onSubmitted({
            attemptId: paper.attemptId,
            examId: paper.examId,
            status: record.paper.status,
            submittedAt: record.submittedAt ?? record.paper.serverTime,
          });
          return;
        }
        callbacks.onClock({
          examId: paper.examId,
          status: 'RUNNING',
          endTime: record.paper.endTime,
          serverTime: new Date().toISOString(),
          receivedAt: performance.now(),
          roundTripMs: 0,
        });
        callbacks.onRecovered({
          examId: paper.examId,
          attemptId: paper.attemptId,
          status: record.paper.status,
          submittedAt: record.submittedAt,
          answers: record.paper.answers.map((answer) => ({
            questionId: answer.questionId,
            optionIds: answer.selectedOptionIds,
          })),
          clock: {
            examId: paper.examId,
            status: 'RUNNING',
            startTime: record.paper.startedAt,
            endTime: record.paper.endTime,
            serverTime: new Date().toISOString(),
          },
        });
        callbacks.onConnection(true);
      }
      queueMicrotask(recover);
      const timer = setInterval(() => {
        if (!navigator.onLine) {
          callbacks.onConnection(false);
          return;
        }
        callbacks.onConnection(true);
        if (
          Date.now() > Date.parse(record.paper.endTime) + 5000 &&
          record.paper.status === 'IN_PROGRESS'
        ) {
          record.paper.status = 'AUTO_SUBMITTED';
          record.submittedAt = new Date().toISOString();
          persist(record);
          const submission: Submission = {
            examId: paper.examId,
            attemptId: paper.attemptId,
            status: 'AUTO_SUBMITTED',
            submittedAt: record.submittedAt,
          };
          callbacks.onSubmitted(submission);
        } else
          callbacks.onClock({
            examId: paper.examId,
            status: 'RUNNING',
            endTime: record.paper.endTime,
            serverTime: new Date().toISOString(),
            receivedAt: performance.now(),
            roundTripMs: 0,
          });
      }, 1000);
      return {
        disconnect() {
          active = false;
          clearInterval(timer);
        },
        async report(_type, _clientAt) {
          await wait();
          if (
            !active ||
            record.paper.status !== 'IN_PROGRESS' ||
            Date.now() >= Date.parse(record.paper.endTime)
          )
            throw new ApiError(409, 'Closed', 'INVALID_STATE');
        },
      };
    },
    async result(userId, examId, attemptId): Promise<AttemptResult> {
      await wait();
      const record = load(userId, examId);
      if (!record || record.paper.attemptId !== attemptId)
        throw new ApiError(404, 'Not found', 'NOT_FOUND');
      if (record.paper.status === 'IN_PROGRESS') {
        if (Date.now() <= Date.parse(record.paper.endTime) + 5000)
          throw new ApiError(409, 'Not submitted', 'ATTEMPT_NOT_SUBMITTED');
        record.paper.status = 'AUTO_SUBMITTED';
        record.submittedAt = new Date().toISOString();
        persist(record);
      }
      // Answer keys exist exclusively in this development-only backend mock.
      const questions = record.paper.questions.map((question, index) => {
        const correctIndexes =
          index === 1 ? [0, 1] : index === 4 ? [0, 1, 3] : [0];
        const selectedOptionIds =
          record.paper.answers.find(
            (answer) => answer.questionId === question.questionId,
          )?.selectedOptionIds ?? [];
        const correctIds = correctIndexes.map(
          (optionIndex) => question.options[optionIndex]!.id,
        );
        return {
          ...question,
          explanation: 'Lời giải mô phỏng cho bài thi mẫu.',
          selectedOptionIds,
          earnedPoints: sameSelection(selectedOptionIds, correctIds)
            ? question.points
            : 0,
          options: question.options.map((option, optionIndex) => ({
            ...option,
            isCorrect: correctIndexes.includes(optionIndex),
          })),
        };
      });
      return {
        attemptId,
        examId,
        examTitle: 'Kiểm tra kiến thức Công nghệ Web',
        status: record.paper.status,
        startedAt: record.paper.startedAt,
        submittedAt: record.submittedAt ?? record.paper.serverTime,
        score: questions.reduce(
          (sum, question) => sum + question.earnedPoints,
          0,
        ),
        maxScore: questions.reduce((sum, question) => sum + question.points, 0),
        questions:
          Date.now() >= Date.parse(record.paper.endTime) ? questions : null,
      };
    },
  };
}
