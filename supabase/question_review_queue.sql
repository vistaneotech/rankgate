-- Human review queue for MCQs when automated checks are uncertain.
-- Run in Supabase SQL Editor after adjusting admin RLS to match how you store admin role (JWT vs profiles).

CREATE TABLE IF NOT EXISTS public.question_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_fingerprint TEXT NOT NULL,
  subject TEXT,
  topic TEXT,
  difficulty TEXT,
  payload JSONB NOT NULL,
  doubt_reasons TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  session_seed BIGINT,
  session_num INT,
  q_index INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  admin_note TEXT
);

CREATE INDEX IF NOT EXISTS question_review_queue_status_created_idx
  ON public.question_review_queue (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS question_review_queue_one_pending_per_fp
  ON public.question_review_queue (question_fingerprint)
  WHERE status = 'pending';

COMMENT ON TABLE public.question_review_queue IS 'MCQs flagged as doubtful by client heuristics; admins approve or reject.';

ALTER TABLE public.question_review_queue ENABLE ROW LEVEL SECURITY;

-- Students: insert own rows only
DROP POLICY IF EXISTS "question_review_queue_insert_own" ON public.question_review_queue;
CREATE POLICY "question_review_queue_insert_own" ON public.question_review_queue
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Admins: read/update all rows (uses own profile row only — avoids RLS recursion on profiles)
DROP POLICY IF EXISTS "question_review_queue_select_admin" ON public.question_review_queue;
CREATE POLICY "question_review_queue_select_admin" ON public.question_review_queue
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin'
    OR COALESCE((auth.jwt() -> 'raw_user_meta_data' ->> 'role'), '') = 'admin'
  );

DROP POLICY IF EXISTS "question_review_queue_update_admin" ON public.question_review_queue;
CREATE POLICY "question_review_queue_update_admin" ON public.question_review_queue
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin'
    OR COALESCE((auth.jwt() -> 'raw_user_meta_data' ->> 'role'), '') = 'admin'
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin'
    OR COALESCE((auth.jwt() -> 'raw_user_meta_data' ->> 'role'), '') = 'admin'
  );
