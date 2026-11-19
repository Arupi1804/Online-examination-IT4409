-- Exam Core adjustments on top of 001_schema.sql (TV2).
-- Runs automatically after 001 on a new volume; see database/README.md for
-- applying it to an existing local database.

BEGIN;

-- Display order of options when an exam does not shuffle them. Existing
-- options are numbered 0..n-1 per question before the unique constraint;
-- there is no default, so every insert must state its position.
ALTER TABLE options ADD COLUMN order_index INTEGER;
UPDATE options o
SET order_index = n.position
FROM (
  SELECT id, row_number() OVER (PARTITION BY question_id ORDER BY id) - 1 AS position
  FROM options
) n
WHERE o.id = n.id;
ALTER TABLE options
  ALTER COLUMN order_index SET NOT NULL,
  ADD CONSTRAINT options_order_index_check CHECK (order_index >= 0),
  ADD CONSTRAINT options_question_order_key UNIQUE (question_id, order_index);

-- Editing a question replaces its options; deleting a draft exam removes its
-- question list. Questions themselves stay protected by exam_questions.
ALTER TABLE options
  DROP CONSTRAINT options_question_id_fkey,
  ADD CONSTRAINT options_question_id_fkey
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE;
ALTER TABLE exam_questions
  DROP CONSTRAINT exam_questions_exam_id_fkey,
  ADD CONSTRAINT exam_questions_exam_id_fkey
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE;

ALTER TABLE questions
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE exams
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMIT;
