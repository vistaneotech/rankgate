-- RPC: public.get_leaderboard_rank
-- Returns the caller's global rank based on best `scaled_390` score per student.
--
-- Why this exists:
-- - Under typical RLS, students can only read their own `test_sessions`,
--   so client-side leaderboard ranking incorrectly shows everyone as #1.
-- - This function runs as SECURITY DEFINER so it can compute ranks across all rows,
--   while still only returning the caller's rank (no leaderboard leakage).
--
-- Usage from the app:
--   sb.rpc('get_leaderboard_rank', { student_id: USER.id, exam_id: 'BITSAT' })
--
-- Assumptions:
-- - Table: public.test_sessions
-- - Columns used: student_id (uuid), scaled_390 (numeric/int), created_at (timestamptz)
--
-- Paste into Supabase SQL editor and run.

create or replace function public.get_leaderboard_rank(
  student_id uuid default auth.uid(),
  exam_id text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid := coalesce(student_id, auth.uid());
  ex text := nullif(trim(coalesce(exam_id,'')), '');
  r integer;
begin
  -- Do not allow querying other users' ranks from the client.
  -- If you need this for admin UI later, add a secure admin check here.
  if target_id is null or target_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with per_student as (
    select
      ts.student_id,
      max(coalesce(ts.scaled_390, 0)) as best_score
    from public.test_sessions ts
    where ts.student_id is not null
      and (ex is null or coalesce(ts.exam,'BITSAT') = ex)
    group by ts.student_id
  ),
  per_student_best_time as (
    -- Tie-breaker: earliest time the best_score was achieved.
    select
      ts.student_id,
      ps.best_score,
      min(ts.created_at) filter (where coalesce(ts.scaled_390, 0) = ps.best_score) as best_time
    from public.test_sessions ts
    join per_student ps on ps.student_id = ts.student_id
    where (ex is null or coalesce(ts.exam,'BITSAT') = ex)
    group by ts.student_id, ps.best_score
  ),
  ranked as (
    select
      student_id,
      row_number() over (
        order by best_score desc, best_time asc nulls last, student_id asc
      ) as rk
    from per_student_best_time
  )
  select rk into r
  from ranked
  where student_id = target_id;

  return r; -- null if student has no sessions yet
end;
$$;

-- Recommended: lock down who can execute it.
revoke all on function public.get_leaderboard_rank(uuid, text) from public;
grant execute on function public.get_leaderboard_rank(uuid, text) to authenticated;

