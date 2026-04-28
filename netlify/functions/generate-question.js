// Netlify Function: generate-question (hardened)
//
// Goals:
// - Keep provider keys OFF the browser (server env only)
// - Require a real Supabase Auth session (prevents anonymous abuse)
// - Strong reliability: timeouts + retries + Anthropic → OpenAI fallback
// - Never leak provider keys; keep error bodies small
//
// Netlify environment variables (set via Netlify UI/CLI):
// - SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL       (e.g. https://xxxx.supabase.co)
// - SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//   (public key; used only to validate access tokens)
// - ANTHROPIC_KEY and/or OPENAI_KEY
//
// Endpoint: /.netlify/functions/generate-question
// Frontend sends: { body: <anthropic-like request> }
// Client MUST send header: Authorization: Bearer <supabase_access_token>
// Returns Anthropic-like response: { content: [{ type:'text', text:'...' }], _provider: 'anthropic'|'openai' }

const DEFAULT_SUPABASE_URL = 'https://vikgpdkxpmxclsepgclk.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xw_AzIB5wA2HopcFDdmMbQ_19NjGESo';

function firstValidHttpUrl(...values) {
  for (const value of values) {
    const s = String(value || '').trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol === 'https:' || u.protocol === 'http:') return s;
    } catch (_e) {}
  }
  return '';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const s = String(value || '').trim();
    if (s) return s;
  }
  return '';
}

function json(statusCode, obj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(obj),
  };
}

function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1]).trim() : '';
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function validateSupabaseUser(accessToken) {
  // This single-file app pins Supabase in index.html, so the serverless proxy must
  // validate tokens against the same project. A stale Netlify SUPABASE_URL from
  // another project would make logged-in users look unauthenticated in production.
  const SUPABASE_URL = firstValidHttpUrl(
    DEFAULT_SUPABASE_URL,
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  );
  const SUPABASE_ANON_KEY = firstNonEmpty(
    DEFAULT_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ''
  );
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Server missing SUPABASE_URL/SUPABASE_ANON_KEY');
  const r = await fetchWithTimeout(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  }, 8000);
  if (!r.ok) return null;
  return await r.json();
}

async function callAnthropic(body) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || '';
  if (!ANTHROPIC_KEY) throw new Error('Anthropic key missing on server');
  const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': ANTHROPIC_KEY,
    },
    body: JSON.stringify(body),
  }, 18000);
  const txt = await r.text();
  if (!r.ok) {
    const short = txt.slice(0, 240);
    const err = new Error(`Anthropic HTTP ${r.status}`);
    err._shortBody = short;
    throw err;
  }
  const data = JSON.parse(txt);
  data._provider = 'anthropic';
  return data;
}

async function callOpenAI(body) {
  const OPENAI_KEY = process.env.OPENAI_KEY || '';
  if (!OPENAI_KEY) throw new Error('OpenAI key missing on server');
  const openaiBody = {
    model: 'gpt-4o',
    max_tokens: body.max_tokens ?? 1100,
    temperature: body.temperature ?? 1.0,
    messages: body.messages,
  };
  const r = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify(openaiBody),
  }, 18000);
  const txt = await r.text();
  if (!r.ok) {
    const short = txt.slice(0, 240);
    const err = new Error(`OpenAI HTTP ${r.status}`);
    err._shortBody = short;
    throw err;
  }
  const data = JSON.parse(txt);
  const content = data?.choices?.[0]?.message?.content ?? '';
  return { _provider: 'openai', content: [{ type: 'text', text: String(content) }] };
}

async function retry(fn, attempts = 2) {
  let last = null;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      const msg = String(e?.message || e || '');
      // Retry only on transient-ish cases
      const transient = msg.includes('429') || msg.includes('503') || msg.includes('timeout') || msg.includes('AbortError');
      if (i === attempts || !transient) break;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

exports.handler = async (event) => {
  // Basic CORS (same-origin by default; allow if your frontend is on the same Netlify domain)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  // Require Supabase access token
  const token = getBearerToken(event);
  if (!token) return json(401, { error: 'Missing Authorization Bearer token' });

  let user = null;
  try {
    user = await validateSupabaseUser(token);
  } catch (e) {
    console.error('Supabase auth validation failed:', e?.message || e);
    return json(500, { error: 'Auth validation misconfigured on server' });
  }
  if (!user?.id) return json(401, { error: 'Invalid or expired session' });

  let payload = null;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_e) {
    return json(400, { error: 'Invalid JSON' });
  }

  const body = payload.body || payload;
  if (!body || !body.messages) {
    return json(400, { error: 'Missing body.messages' });
  }

  try {
    const haveAnth = !!String(process.env.ANTHROPIC_KEY || '').trim();
    const haveOai = !!String(process.env.OPENAI_KEY || '').trim();
    if (!haveAnth && !haveOai) return json(500, { error: 'No provider keys configured on server' });

    // Match frontend behaviour: try Anthropic first, then OpenAI if Anthropic fails
    // (not only when Anthropic key is absent — a bad/expired Anthropic key must not block OpenAI).
    let lastErr = null;
    if (haveAnth) {
      try {
        const out = await retry(() => callAnthropic(body), 2);
        return json(200, out, { 'access-control-allow-origin': '*' });
      } catch (e) {
        lastErr = e;
        if (!haveOai) throw e;
      }
    }
    const out = await retry(() => callOpenAI(body), 2);
    if (lastErr) out._fallbackFromAnthropic = true;
    return json(200, out, { 'access-control-allow-origin': '*' });
  } catch (e) {
    const msg = String(e?.message || e || 'Unknown error');
    const short = String(e?._shortBody || '');
    return json(502, { error: msg, detail: short ? short : undefined }, { 'access-control-allow-origin': '*' });
  }
};

