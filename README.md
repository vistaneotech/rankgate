# Rank Gate 2026 — Mock Test Platform

Single-file HTML app for a BITSAT and other examination mock test platform to help students prepare effectively, with:
- Supabase auth + profiles (student/parent/admin)
- Session saving + analytics
- AI-generated questions with fallback bank
- Dual AI API support (Anthropic first, OpenAI fallback)

## Files
- `index.html`: the entire app (UI + logic) in one HTML file (recommended for Netlify).
- `README.md`: this guide.

## How to run (local)
This is a static app.

- **Option A (quickest)**: open `index.html` in your browser.
- **Option B (recommended)**: serve it locally to avoid some browser restrictions.

Example (PowerShell):

```powershell
cd d:\Cursor_Development\rankdhruv
python -m http.server 5173
```

Then open:
- `http://localhost:5173/index.html`

## Configuration
All configuration is inside `index.html` within the `<script>` tag.

### Supabase
Search for:
- `SUPA_URL` (same as `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPA_KEY` (same as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)

These are used to create the client:
- `sb = supabase.createClient(SUPA_URL, SUPA_KEY)` (where `supabase` is the **global namespace object** exported by the Supabase UMD bundle)

The app pins `@supabase/supabase-js` to a recent UMD build so **publishable keys** (`sb_publishable_...`) work reliably.

Important: the UMD bundle already declares a global identifier named `supabase`, so the app stores the **client instance** in `sb` to avoid a `SyntaxError: Identifier 'supabase' has already been declared`.

### Troubleshooting: “profile could not be loaded” (RLS)

If Auth login works but `profiles` queries fail, it’s almost always **RLS** (sometimes **policy recursion**).

A common footgun is a `profiles` SELECT policy that does:

- `(SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'`

because evaluating that subquery can recurse on `public.profiles` itself.

Safer pattern (example — adjust to your real admin signal):

```sql
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
FOR SELECT USING (
  auth.uid() = id
  OR ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.parent_student ps
    WHERE ps.parent_id = auth.uid()
      AND ps.student_id = public.profiles.id
  )
);
```

If your admin role is not in JWT `app_metadata.role`, use the claim you actually set (for example `raw_user_meta_data.role`).

### Password reset (“Forgot password?”)

The Sign In screen uses `sb.auth.resetPasswordForEmail(email, { redirectTo })`.

In Supabase Dashboard → **Authentication → URL Configuration**, ensure your local/site URLs are allowed in **Redirect URLs** (otherwise the email link may not return users to your app cleanly).

### AI providers (Anthropic + OpenAI fallback)
Search for:
- `const ANTHROPIC_KEY`
- `const OPENAI_KEY`
- `async function callAPI(...)`

The app expects an Anthropic-style response shape:
- `data.content[0].text`

When OpenAI is used as fallback, the code normalizes OpenAI’s response back to the Anthropic shape so the rest of the app works unchanged.

## Notes / gotchas
### Browser key exposure (important)
This app calls model APIs directly from the browser using:
- `anthropic-dangerous-direct-browser-access: 'true'`

That means **any API key placed in the HTML is exposed to anyone who can load the page**.

If this will be shared publicly, the safe approach is:
- Move API calls to a backend (server / serverless function)
- Keep keys on the server
- Add auth + rate limiting

## Next step: store AI questions + prevent repeats (scalable)
Right now, the database saves **session metadata** (subjects/topics/marks) but not the **full generated question payload**.  
To make Rank Gate 2026 scalable and guarantee **never asking the same question to the same student**, use a shared question bank and a per-student assignment table:

- **`questions_bank`**: stores every generated question (question text, options, correct index, explanation, subject/topic/difficulty, model/prompt/seed, etc.)
- **`student_question_history`**: links `student_id` → `question_id` with a `UNIQUE(student_id, question_id)` constraint to guarantee no repeats for that student
- (Optional) add `question_id` to `session_questions` so a session references the exact stored question

If you want, I can generate the exact SQL (tables + indexes + RLS policies) and update the app logic to:
1) fetch an unused question from `questions_bank` for that student, else
2) generate a new one via API, insert into `questions_bank`, then assign it to the student.

### Models
The app’s question generation uses:
- Anthropic model constant `MDL` (currently set in the HTML)
- OpenAI fallback uses model `'gpt-4o'` (inside `callAPI`)

Adjust those values if you want different models.

## Quick sanity check
- Sign up / sign in works
- Dashboard loads and shows role-specific UI
- Starting an exam generates Q1
- Ending an exam saves results (if Supabase tables exist)

