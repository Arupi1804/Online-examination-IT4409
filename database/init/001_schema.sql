-- Initial schema for PostgreSQL 16.
-- This file is executed automatically by the postgres service on a new volume.
-- Times are stored as TIMESTAMPTZ; the API serializes them as UTC ISO 8601.

BEGIN;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'TEACHER', 'STUDENT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('SINGLE', 'MULTIPLE', 'TRUE_FALSE')),
  content TEXT NOT NULL,
  explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id),
  content TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (question_id, id)
);

CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  room_code TEXT NOT NULL UNIQUE
    CHECK (room_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  duration_sec INTEGER NOT NULL CHECK (duration_sec > 0),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SCHEDULED', 'RUNNING', 'ENDED')),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  shuffle_questions BOOLEAN NOT NULL DEFAULT false,
  shuffle_options BOOLEAN NOT NULL DEFAULT false,
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time IS NULL OR start_time IS NOT NULL),
  CHECK (end_time IS NULL OR end_time > start_time)
);

CREATE TABLE exam_questions (
  exam_id UUID NOT NULL REFERENCES exams(id),
  question_id UUID NOT NULL REFERENCES questions(id),
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  points NUMERIC(10, 2) NOT NULL CHECK (points > 0),
  PRIMARY KEY (exam_id, question_id),
  UNIQUE (exam_id, order_index)
);

CREATE TABLE attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'FORCE_SUBMITTED')),
  shuffle_seed TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  score NUMERIC(10, 2),
  max_score NUMERIC(10, 2),
  CHECK (score IS NULL OR score >= 0),
  CHECK (max_score IS NULL OR max_score >= 0),
  CHECK (score IS NULL OR max_score IS NULL OR score <= max_score),
  CHECK (
    (status = 'IN_PROGRESS' AND submitted_at IS NULL)
    OR (status <> 'IN_PROGRESS' AND submitted_at IS NOT NULL)
  ),
  UNIQUE (id, exam_id)
);

CREATE TABLE answers (
  attempt_id UUID NOT NULL,
  exam_id UUID NOT NULL,
  question_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id),
  FOREIGN KEY (attempt_id, exam_id) REFERENCES attempts(id, exam_id),
  FOREIGN KEY (exam_id, question_id)
    REFERENCES exam_questions(exam_id, question_id)
);

-- Separate selections allow zero, one or multiple choices and enforce that
-- each selected option belongs to the answer's question.
CREATE TABLE answer_selected_options (
  attempt_id UUID NOT NULL,
  question_id UUID NOT NULL,
  option_id UUID NOT NULL,
  PRIMARY KEY (attempt_id, question_id, option_id),
  FOREIGN KEY (attempt_id, question_id)
    REFERENCES answers(attempt_id, question_id) ON DELETE CASCADE,
  FOREIGN KEY (question_id, option_id)
    REFERENCES options(question_id, id)
);

-- "at" is the server receive time. client_at is untrusted event metadata.
CREATE TABLE proctor_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES attempts(id),
  type TEXT NOT NULL
    CHECK (type IN ('TAB_BLUR', 'FULLSCREEN_EXIT', 'COPY_PASTE', 'DISCONNECT')),
  "at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_at TIMESTAMPTZ
);

-- Room lookup and recovery of running exams after a server restart.
CREATE INDEX exams_owner_id_idx ON exams(owner_id);
CREATE INDEX exams_running_end_time_idx ON exams(end_time)
  WHERE status = 'RUNNING';

-- Rejoin, monitoring and automatic submission of unfinished attempts.
CREATE INDEX attempts_exam_user_idx ON attempts(exam_id, user_id);
CREATE INDEX attempts_exam_status_idx ON attempts(exam_id, status);
CREATE UNIQUE INDEX attempts_one_active_per_student_idx
  ON attempts(exam_id, user_id) WHERE status = 'IN_PROGRESS';

-- Foreign-key lookups and teacher monitoring history.
CREATE INDEX questions_owner_id_idx ON questions(owner_id);
CREATE INDEX options_question_id_idx ON options(question_id);
CREATE INDEX exam_questions_question_id_idx ON exam_questions(question_id);
CREATE INDEX answers_exam_question_idx ON answers(exam_id, question_id);
CREATE INDEX answer_selected_options_option_idx
  ON answer_selected_options(question_id, option_id);
CREATE INDEX proctor_logs_attempt_at_idx ON proctor_logs(attempt_id, "at" DESC);

COMMIT;
