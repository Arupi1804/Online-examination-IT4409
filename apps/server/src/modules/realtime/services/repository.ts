/* TẦNG TRUY CẬP POSTGRESQL (NGUỒN DỮ LIỆU CHÍNH THỨC) */

import type { Pool, PoolClient } from 'pg';
import type {
  AttemptState,
  AttemptStatus,
  ExamClock,
  ExamStatus,
  Role,
  StudentUpdate,
  Submitted,
  ViolationType,
} from '../../../shared/realtime.js';
import { RealtimeError } from '../errors.js';

export type Principal = { userId: string; role: Role; sid: string };
export type Exam = {
  id: string;
  owner_id: string;
  room_code: string;
  status: ExamStatus;
  start_time: Date | null;
  end_time: Date | null;
  duration_sec: number;
};
type Attempt = {
  id: string;
  exam_id: string;
  user_id: string;
  status: AttemptStatus;
  submitted_at: Date | null;
};

// Chuyển một row Exam thành ExamClock mà client có thể nhận
function clock(exam: Exam): ExamClock {
  return {
    examId: exam.id,
    status: exam.status,
    startTime: exam.start_time?.toISOString() ?? null,
    endTime: exam.end_time?.toISOString() ?? null,
    serverTime: new Date().toISOString(),
  };
}

// Lớp đóng gói truy vấn SQL
export class RealtimeRepository {
  constructor(private readonly pool: Pool) {}

  // Tìm kỳ thi theo UUID
  async exam(examId: string): Promise<Exam> {
    const result = await this.pool.query<Exam>(
      'SELECT id, owner_id, room_code, status, start_time, end_time, duration_sec FROM exams WHERE id=$1',
      [examId],
    ); // $1 chống SQL injection
    if (!result.rows[0]) throw new RealtimeError('NOT_FOUND', 'Exam not found');
    return result.rows[0];
  }

  // Tra kỳ thi bằng mã phòng 6 ký tự
  async examByCode(code: string): Promise<Exam> {
    const result = await this.pool.query<Exam>(
      'SELECT id, owner_id, room_code, status, start_time, end_time, duration_sec FROM exams WHERE room_code=$1',
      [code],
    );
    if (!result.rows[0]) throw new RealtimeError('NOT_FOUND', 'Exam not found');
    return result.rows[0];
  }

  // Phân quyền vào phòng: ADMIN, chủ kỳ thi TEACHER, hoặc STUDENT có mã phòng/attempt tương ứng
  async canJoin(
    exam: Exam,
    principal: Principal,
    roomCode?: string,
  ): Promise<void> {
    if (
      principal.role === 'ADMIN' ||
      (principal.role === 'TEACHER' && exam.owner_id === principal.userId)
    )
      return;
    if (principal.role !== 'STUDENT')
      throw new RealtimeError('FORBIDDEN', 'Exam access denied');
    if (roomCode === exam.room_code) return;
    const result = await this.pool.query(
      'SELECT 1 FROM attempts WHERE exam_id=$1 AND user_id=$2 LIMIT 1',
      [exam.id, principal.userId],
    );
    if (!result.rowCount)
      throw new RealtimeError('FORBIDDEN', 'Exam access denied');
  }

  assertTeacher(exam: Exam, principal: Principal): void {
    if (principal.role !== 'TEACHER' || exam.owner_id !== principal.userId)
      throw new RealtimeError('FORBIDDEN', 'Teacher does not own exam');
  }

  // Bắt đầu thi bằng một UPDATE có điều kiện nguyên tử để tránh hai request cùng bắt đầu
  async start(examId: string, principal: Principal): Promise<Exam> {
    const result = await this.pool.query<Exam>(
      `UPDATE exams SET status='RUNNING', start_time=now(), end_time=now() + duration_sec * interval '1 second'
       WHERE id=$1 AND owner_id=$2 AND status IN ('DRAFT','SCHEDULED')
       AND EXISTS (SELECT 1 FROM exam_questions WHERE exam_id=$1)
       RETURNING id, owner_id, room_code, status, start_time, end_time, duration_sec`,
      [examId, principal.userId],
    );
    if (result.rows[0]) return result.rows[0];
    this.assertTeacher(await this.exam(examId), principal);
    throw new RealtimeError('INVALID_STATE', 'Exam cannot be started');
  }

  // Gia hạn thời lượng khi kỳ thi còn RUNNING và chưa hết hạn
  async extend(
    examId: string,
    seconds: number,
    principal: Principal,
  ): Promise<Exam> {
    const result = await this.pool.query<Exam>(
      `UPDATE exams SET end_time=end_time + $3 * interval '1 second'
       WHERE id=$1 AND owner_id=$2 AND status='RUNNING' AND end_time > now()
       RETURNING id, owner_id, room_code, status, start_time, end_time, duration_sec`,
      [examId, principal.userId, seconds],
    );
    if (result.rows[0]) return result.rows[0];
    this.assertTeacher(await this.exam(examId), principal);
    throw new RealtimeError('INVALID_STATE', 'Exam can no longer be extended');
  }

  // Khôi phục bài làm chỉ cho STUDENT sở hữu attempt
  async attemptState(
    attemptId: string,
    principal: Principal,
  ): Promise<AttemptState> {
    type StateRow = Omit<Exam, 'id'> & {
      id: string;
      exam_id: string;
      user_id: string;
      attempt_status: AttemptStatus;
      submitted_at: Date | null;
    };
    const result = await this.pool.query<StateRow>(
      `SELECT a.id, a.exam_id, a.user_id, a.status AS attempt_status, a.submitted_at,
        e.id AS exam_id, e.owner_id, e.room_code, e.status, e.start_time, e.end_time, e.duration_sec
       FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=$1`,
      [attemptId],
    );
    const row = result.rows[0];
    if (!row) throw new RealtimeError('NOT_FOUND', 'Attempt not found');
    if (principal.role !== 'STUDENT' || row.user_id !== principal.userId)
      throw new RealtimeError('FORBIDDEN', 'Attempt access denied');
    const answers = await this.pool.query<{
      question_id: string;
      option_ids: string[];
    }>(
      `SELECT a.question_id, COALESCE(array_agg(s.option_id ORDER BY s.option_id) FILTER (WHERE s.option_id IS NOT NULL), '{}') AS option_ids
       FROM answers a LEFT JOIN answer_selected_options s ON s.attempt_id=a.attempt_id AND s.question_id=a.question_id
       WHERE a.attempt_id=$1 GROUP BY a.question_id ORDER BY a.question_id`,
      [attemptId],
    );
    return {
      attemptId,
      examId: row.exam_id,
      status: row.attempt_status,
      submittedAt: row.submitted_at?.toISOString() ?? null,
      answers: answers.rows.map((a) => ({
        questionId: a.question_id,
        optionIds: a.option_ids,
      })),
      clock: clock({ ...row, id: row.exam_id }),
    };
  }

  // Ghi một vi phạm giám sát sau khi xác thực vai trò và trạng thái attempt
  async recordViolation(
    attemptId: string,
    principal: Principal,
    type: ViolationType,
    clientAt: Date | null,
  ): Promise<string> {
    if (principal.role !== 'STUDENT')
      throw new RealtimeError('FORBIDDEN', 'Student role required');
    const result = await this.pool.query<{ at: Date }>(
      `INSERT INTO proctor_logs(attempt_id,type,client_at)
       SELECT a.id,$3,$4 FROM attempts a JOIN exams e ON e.id=a.exam_id
       WHERE a.id=$1 AND a.user_id=$2 AND a.status='IN_PROGRESS' AND e.status='RUNNING' AND e.end_time>now()
       RETURNING "at"`,
      [attemptId, principal.userId, type, clientAt],
    );
    if (!result.rows[0])
      throw new RealtimeError('INVALID_STATE', 'Attempt is not active');
    return result.rows[0].at.toISOString();
  }

  // Đảm bảo heartbeat/violation chỉ được thực hiện khi kỳ thi và attempt đang mở
  async activeAttempt(
    attemptId: string,
    principal: Principal,
  ): Promise<Attempt> {
    const result = await this.pool.query<
      Attempt & { exam_status: ExamStatus; before_deadline: boolean }
    >(
      `SELECT a.id,a.exam_id,a.user_id,a.status,a.submitted_at,e.status AS exam_status,e.end_time>now() AS before_deadline
       FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=$1`,
      [attemptId],
    );
    const row = result.rows[0];
    if (!row) throw new RealtimeError('NOT_FOUND', 'Attempt not found');
    if (principal.role !== 'STUDENT' || row.user_id !== principal.userId)
      throw new RealtimeError('FORBIDDEN', 'Attempt access denied');
    if (
      row.status !== 'IN_PROGRESS' ||
      row.exam_status !== 'RUNNING' ||
      !row.before_deadline
    ) {
      throw new RealtimeError('INVALID_STATE', 'Attempt is not active');
    }
    return row;
  }

  // Tạo dữ liệu dashboard giám sát từ số câu trả lời và log vi phạm thực tế
  async studentUpdate(
    attemptId: string,
  ): Promise<Omit<StudentUpdate, 'online' | 'lastHeartbeat'>> {
    const result = await this.pool.query<{
      exam_id: string;
      user_id: string;
      status: AttemptStatus;
      answered_count: string;
      violation_count: string;
      last_type: ViolationType | null;
      last_at: Date | null;
    }>(
      `SELECT a.exam_id,a.user_id,a.status,
      (SELECT count(*) FROM answers an WHERE an.attempt_id=a.id)::text AS answered_count,
      (SELECT count(*) FROM proctor_logs p WHERE p.attempt_id=a.id)::text AS violation_count,
      (SELECT p.type FROM proctor_logs p WHERE p.attempt_id=a.id ORDER BY p."at" DESC LIMIT 1) AS last_type,
      (SELECT p."at" FROM proctor_logs p WHERE p.attempt_id=a.id ORDER BY p."at" DESC LIMIT 1) AS last_at
      FROM attempts a WHERE a.id=$1`,
      [attemptId],
    );
    const row = result.rows[0];
    if (!row) throw new RealtimeError('NOT_FOUND', 'Attempt not found');
    return {
      examId: row.exam_id,
      attemptId,
      userId: row.user_id,
      status: row.status,
      answeredCount: Number(row.answered_count),
      violationCount: Number(row.violation_count),
      lastViolation:
        row.last_type && row.last_at
          ? { type: row.last_type, at: row.last_at.toISOString() }
          : null,
    };
  }

  // Lấy danh sách attempt của kỳ thi để gateway/service tổng hợp bảng giám sát
  async monitor(examId: string): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      'SELECT id FROM attempts WHERE exam_id=$1 ORDER BY started_at,id',
      [examId],
    );
    return result.rows.map((row) => row.id);
  }

  // Worker dùng khi khởi động/tick để phục hồi các lịch thi còn hoạt động
  async runningExams(): Promise<Exam[]> {
    const result = await this.pool.query<Exam>(
      `SELECT id,owner_id,room_code,status,start_time,end_time,duration_sec FROM exams WHERE status='RUNNING'`,
    );
    return result.rows;
  }

  // Tìm kỳ thi ENDED vẫn còn attempt IN_PROGRESS (hệ thống có thể bị gián đoạn)
  async unfinishedEndedExams(): Promise<Exam[]> {
    const result = await this.pool
      .query<Exam>(`SELECT e.id,e.owner_id,e.room_code,e.status,e.start_time,e.end_time,e.duration_sec
      FROM exams e WHERE e.status='ENDED' AND EXISTS (SELECT 1 FROM attempts a WHERE a.exam_id=e.id AND a.status='IN_PROGRESS')`);
    return result.rows;
  }

  // Chấm điểm một attempt ngay trên client của transaction đang khóa dữ liệu
  private async grade(
    client: PoolClient,
    attemptId: string,
    examId: string,
  ): Promise<{ score: number; maxScore: number }> {
    const result = await client.query<{
      points: string;
      correct: string[];
      selected: string[];
    }>(
      `SELECT eq.points::text,
        COALESCE(array_agg(DISTINCT o.id::text) FILTER (WHERE o.is_correct), '{}') AS correct,
        COALESCE(array_agg(DISTINCT s.option_id::text) FILTER (WHERE s.option_id IS NOT NULL), '{}') AS selected
       FROM exam_questions eq LEFT JOIN options o ON o.question_id=eq.question_id
       LEFT JOIN answer_selected_options s ON s.question_id=eq.question_id AND s.attempt_id=$1
       WHERE eq.exam_id=$2 GROUP BY eq.question_id,eq.points`,
      [attemptId, examId],
    );
    let score = 0;
    let maxScore = 0;
    for (const row of result.rows) {
      const points = Number(row.points);
      maxScore += points;
      if (
        row.correct.length > 0 &&
        row.correct.length === row.selected.length &&
        row.correct.every((id) => row.selected.includes(id))
      )
        score += points;
    }
    return {
      score: Math.round(score * 100) / 100,
      maxScore: Math.round(maxScore * 100) / 100,
    };
  }

  // Chốt bài trong transaction; caller phải khóa row attempt trước khi gọi
  private async submitLocked(
    client: PoolClient,
    attempt: Attempt,
    status: Exclude<AttemptStatus, 'IN_PROGRESS'>,
  ): Promise<Submitted | null> {
    if (attempt.status !== 'IN_PROGRESS') return null;
    const { score, maxScore } = await this.grade(
      client,
      attempt.id,
      attempt.exam_id,
    );
    const result = await client.query<{ submitted_at: Date }>(
      `UPDATE attempts SET status=$2,submitted_at=now(),score=$3,max_score=$4 WHERE id=$1 AND status='IN_PROGRESS' RETURNING submitted_at`,
      [attempt.id, status, score, maxScore],
    );
    if (!result.rows[0]) return null;
    return {
      attemptId: attempt.id,
      examId: attempt.exam_id,
      userId: attempt.user_id,
      status,
      submittedAt: result.rows[0].submitted_at.toISOString(),
    };
  }

  // Giáo viên buộc nộp bài qua transaction và khóa attempt
  async forceSubmit(
    attemptId: string,
    principal: Principal,
  ): Promise<Submitted | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<
        Attempt & { owner_id: string; exam_status: ExamStatus }
      >(
        `SELECT a.id,a.exam_id,a.user_id,a.status,a.submitted_at,e.owner_id,e.status AS exam_status
         FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=$1 FOR UPDATE OF a`,
        [attemptId],
      );
      const row = result.rows[0];
      if (!row) throw new RealtimeError('NOT_FOUND', 'Attempt not found');
      if (principal.role !== 'TEACHER' || row.owner_id !== principal.userId)
        throw new RealtimeError('FORBIDDEN', 'Teacher does not own exam');
      if (row.status === 'IN_PROGRESS' && row.exam_status !== 'RUNNING')
        throw new RealtimeError('INVALID_STATE', 'Exam is not running');
      const submitted = await this.submitLocked(client, row, 'FORCE_SUBMITTED');
      await client.query('COMMIT');
      return submitted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Worker dùng để chốt tất cả bài quá hạn và chuyển kỳ thi thành ENDED
  async finishExpired(
    examId: string,
  ): Promise<{ exam: Exam; submissions: Submitted[]; ended: boolean } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const examResult = await client.query<Exam>(
        `SELECT id,owner_id,room_code,status,start_time,end_time,duration_sec FROM exams
         WHERE id=$1 AND end_time + interval '5 seconds' < now() FOR UPDATE`,
        [examId],
      );
      const exam = examResult.rows[0];
      if (!exam || !['RUNNING', 'ENDED'].includes(exam.status)) {
        await client.query('COMMIT');
        return null;
      }
      const attempts = await client.query<Attempt>(
        `SELECT id,exam_id,user_id,status,submitted_at FROM attempts WHERE exam_id=$1 AND status='IN_PROGRESS' FOR UPDATE`,
        [examId],
      );
      const submissions: Submitted[] = [];
      for (const attempt of attempts.rows) {
        const submitted = await this.submitLocked(
          client,
          attempt,
          'AUTO_SUBMITTED',
        );
        if (submitted) submissions.push(submitted);
      }
      const ended = exam.status === 'RUNNING';
      if (ended) {
        await client.query(`UPDATE exams SET status='ENDED' WHERE id=$1`, [
          examId,
        ]);
        exam.status = 'ENDED';
      }
      await client.query('COMMIT');
      return { exam, submissions, ended };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export { clock };
