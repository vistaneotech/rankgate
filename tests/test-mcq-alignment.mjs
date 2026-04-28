/**
 * Mirrors MCQ alignment logic from index.html (normalizeForMatch, inference, reconcile, shuffle).
 * Run: node tests/test-mcq-alignment.mjs
 */

function normalizeCorrectIndex(raw, n = 4) {
  const max = n - 1;
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const t = Math.trunc(raw);
    if (t >= 0 && t <= max) return t;
    if (t >= 1 && t <= n) return t - 1;
  }
  const s = String(raw).trim();
  if (!s) return 0;
  const u = s.toUpperCase();
  if (u.length === 1 && u >= 'A' && u.charCodeAt(0) < 65 + n) return u.charCodeAt(0) - 65;
  const p = parseInt(s.replace(/[^\d-]/g, ''), 10);
  if (!Number.isNaN(p)) {
    if (p >= 0 && p <= max) return p;
    if (p >= 1 && p <= n) return p - 1;
  }
  return 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleMCQ(q, salt32) {
  if (!q || !Array.isArray(q.options) || q.options.length !== 4) return q;
  const opts = q.options.slice(0, 4).map((t) => String(t || ''));
  const oldCorrect = normalizeCorrectIndex(q.correct, 4);
  const perm = [0, 1, 2, 3];
  const rand = mulberry32((salt32 >>> 0) ^ 0x9e3779b1);
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  q.options = perm.map((pi) => opts[pi]);
  q.correct = perm.indexOf(oldCorrect);
  return q;
}

function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^a-z0-9'+\-*/=().,\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferCorrectFromExplanation(expl) {
  if (!expl) return null;
  const s = String(expl).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const patterns = [
    /\b(correct|answer)\s*(option)?\s*(is|=|:|-)\s*\(?\s*([ABCD])\s*\)?\b/i,
    /\boption\s*\(?\s*([ABCD])\s*\)?\s*(is|:)\s*correct\b/i,
    /\btherefore\s*,?\s*(the\s*)?(correct|answer)\s*(is|=|:)\s*\(?\s*([ABCD])\s*\)?\b/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const letter = (m[4] || m[1] || m[5] || '').toUpperCase();
      const idx = letter.charCodeAt(0) - 65;
      if (idx >= 0 && idx <= 3) return idx;
    }
  }
  return null;
}

function inferCorrectFromExplanationText(expl, options) {
  if (!expl || !Array.isArray(options) || options.length < 2) return null;
  const e = normalizeForMatch(expl);
  if (!e) return null;
  const opts = options.slice(0, 4).map((o) => normalizeForMatch(o));

  const parts = e.split(/[.!?;\n]+/).map((x) => x.trim()).filter(Boolean);
  const keyParts = parts.filter((p) => /\b(correct|therefore|hence|thus|so)\b/.test(p));
  const scan = keyParts.length ? keyParts : parts.slice(-6);

  function matchesIn(p) {
    const hits = [];
    opts.forEach((o, idx) => {
      if (!o) return;
      if (o.length <= 4) {
        const re = new RegExp(`\\b${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (re.test(p)) hits.push(idx);
      } else if (p.includes(o)) hits.push(idx);
    });
    return hits;
  }

  for (const p of scan) {
    if (/\bcorrect\b/.test(p)) {
      const hits = matchesIn(p);
      if (hits.length === 1) return hits[0];
    }
    if (/\banswer\b/.test(p)) {
      const hits = matchesIn(p);
      if (hits.length === 1) return hits[0];
    }
  }

  const globalHits = [];
  opts.forEach((o, idx) => {
    if (!o) return;
    if (o.length <= 4) {
      const re = new RegExp(`\\b${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(e)) globalHits.push(idx);
    } else if (e.includes(o)) globalHits.push(idx);
  });
  const uniq = [...new Set(globalHits)];
  if (uniq.length === 1) return uniq[0];
  return null;
}

function optionKeysForQuoteMatch(raw) {
  const o = normalizeForMatch(raw);
  if (o.length < 16) return [];
  const keys = new Set([o]);
  const noTrail = o.replace(/[.?!]+$/, '').trim();
  if (noTrail.length >= 16) keys.add(noTrail);
  return [...keys];
}

function sentimentAtQuotedKey(e, key, pos) {
  const before = e.slice(Math.max(0, pos - 220), pos);
  const after = e.slice(pos, Math.min(e.length, pos + key.length + 160));
  const mid = e.slice(Math.max(0, pos - 220), Math.min(e.length, pos + 40));
  let s = 0;
  if (/\bdemonstrates\s+correct\b/i.test(after)) s += 6;
  if (/\bcorrect\s+subject[\s-]?verb\b/i.test(after)) s += 5;
  if (/\bcorrectly\s+pairs\b/i.test(after)) s += 4;
  if (/\b(is\s+wrong|wrong\s+because|is\s+incorrect|not\s+grammatical)\b/i.test(after)) s -= 5;
  if (/\b(fail(s|ed|ing)?)\b/i.test(before)) s -= 5;
  if (/\b(wrong|incorrect)\b/i.test(before) && /\bbecause\b/i.test(before + after.slice(0, 40))) s -= 3;
  if (/\boption\s*[1-4a-d]\b[^.]{0,120}\b(fail(s|ed|ing)?|wrong|incorrect)\b/i.test(mid)) s -= 5;
  if (/\b(the sentence|the choice|correct\s+sentence)\b/i.test(before)) s += 3;
  if (/\b(pairs|agrees)\b/i.test(after) && !/\b(not|never|fails?)\b/i.test(after.slice(0, 60))) s += 2;
  return s;
}

function maxSentimentForQuotedOption(e, raw) {
  const keys = optionKeysForQuoteMatch(raw);
  let best = -Infinity;
  for (const key of keys) {
    if (!key || !e.includes(key)) continue;
    let p = 0;
    while ((p = e.indexOf(key, p)) !== -1) {
      const sc = sentimentAtQuotedKey(e, key, p);
      if (sc > best) best = sc;
      p += 1;
    }
  }
  return best;
}

function inferCorrectFromQuotedOptionText(expl, options) {
  if (!expl || !Array.isArray(options) || options.length < 2) return null;
  const e = normalizeForMatch(expl);
  if (!e) return null;
  const hits = [];
  for (let i = 0; i < Math.min(4, options.length); i++) {
    const raw = String(options[i] || '').trim();
    if (raw.length < 16) continue;
    const keys = optionKeysForQuoteMatch(raw);
    if (!keys.length) continue;
    if (keys.some((k) => e.includes(k))) hits.push(i);
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    let bestI = hits[0];
    let bestS = -Infinity;
    for (const i of hits) {
      const raw = String(options[i] || '').trim();
      const s = maxSentimentForQuotedOption(e, raw);
      if (s > bestS) {
        bestS = s;
        bestI = i;
      }
    }
    if (bestS >= 2) return bestI;
    const scored = hits.map((i) => ({
      i,
      len: normalizeForMatch(String(options[i] || '')).length,
    }));
    scored.sort((a, b) => b.len - a.len);
    const maxL = scored[0].len;
    const tops = scored.filter((x) => x.len === maxL);
    if (tops.length === 1) return tops[0].i;
  }
  return null;
}

function reconcileCorrect(q) {
  if (!q || typeof q !== 'object') return q;
  q.type = String(q.type || 'MCQ').toUpperCase();
  if (Array.isArray(q.options)) q.options = q.options.slice(0, 4).map((o) => String(o).trim() || 'Option');

  // AI answer is ground truth; only override on strict, high-confidence signals.
  const aiCorrect = normalizeCorrectIndex(q.correct, 4);
  q.correct = aiCorrect;
  q.explanation = q.explanation || q.solution || '';

  if (q.type === 'NAT') return q;

  const isNumeric = ['Physics', 'Chemistry', 'Math'].includes(String(q.subject || '').trim());
  const inferredByLetter = inferCorrectFromExplanation(q.explanation);
  if (inferredByLetter !== null && !isNumeric) q.correct = inferredByLetter;
  return q;
}

// ——— Test data (same structure as live app) ———
const sarahOptions = [
  "Sarah said that she will complete her assignment by tomorrow evening.",
  "Sarah said that she would complete her assignment by the following evening.",
  "Sarah said that she will complete her assignment by the following evening.",
  "Sarah said that she would complete her assignment by tomorrow evening.",
];

const sarahExplanation =
  "When converting direct speech to indirect speech, we need to make two key changes: the tense and the time reference. " +
  "The modal verb 'will' changes to 'would' in reported speech. Additionally, since the reporting is happening 'the next day,' " +
  "the time reference 'tomorrow evening' from the original statement must change to 'the following evening' to maintain the correct temporal relationship. " +
  "The option 'Sarah said that she would complete her assignment by the following evening' correctly applies both the tense change and the appropriate time reference adjustment.";

function assert(name, cond, detail = '') {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`ok  — ${name}`);
  return true;
}

assert('normalizeCorrectIndex treats JSON 0..3 as 0-based (2 stays 2)', normalizeCorrectIndex(2, 4) === 2);
assert('normalizeCorrectIndex still maps legacy 4 → index 3', normalizeCorrectIndex(4, 4) === 3);

// 1) Quoted-option inference must pick B (index 1) when explanation embeds B verbatim
const quoted = inferCorrectFromQuotedOptionText(sarahExplanation, sarahOptions);
assert('inferCorrectFromQuotedOptionText returns index of option B', quoted === 1, `got ${quoted}`);

// 2) reconcileCorrect must NOT override the AI keyed answer based on quoted text
const qWrong = {
  correct: 2,
  options: [...sarahOptions],
  explanation: sarahExplanation,
};
reconcileCorrect(qWrong);
assert('reconcileCorrect keeps keyed answer (index 2) as ground truth', qWrong.correct === 2, `got ${qWrong.correct}`);

// 3) After shuffle, the option at q.correct must still be the “would + following evening” sentence
const qShuffle = { correct: 1, options: [...sarahOptions], explanation: sarahExplanation };
reconcileCorrect(qShuffle);
const rightText = normalizeForMatch(sarahOptions[1]);
shuffleMCQ(qShuffle, 0xdeadbeef);
const atKey = normalizeForMatch(qShuffle.options[qShuffle.correct] || '');
assert('after shuffleMCQ, options[correct] is still the reconciled answer text', atKey === rightText, `got "${atKey}"`);

// 4) Paraphrase-only explanation: no full option embedded → quoted returns null; keyed value unchanged by quoted path
const paraphraseOnly =
  'Indirect speech requires backshifting will to would and shifting tomorrow to the following day relative to the reporting time.';
const qPara = { correct: 2, options: [...sarahOptions], explanation: paraphraseOnly };
reconcileCorrect(qPara);
assert('paraphrase-only does not force quoted match; correct may stay from normalize', qPara.correct === 2, `got ${qPara.correct}`);

// 5) Explanation letter cues should not override unless they are explicit "correct is X" statements.
const letterTrap =
  'Answer is C for bookkeeping. ' +
  "The option 'Sarah said that she would complete her assignment by the following evening' correctly applies both changes.";
const qLetter = { correct: 2, options: [...sarahOptions], explanation: letterTrap };
reconcileCorrect(qLetter);
assert('reconcileCorrect keeps keyed answer despite quoted text', qLetter.correct === 2, `got ${qLetter.correct}`);

// 6) Verb agreement: even if explanation praises D, reconcileCorrect keeps keyed answer
const committeeOpts = [
  'The bouquet of flowers were beautiful in the sunlight.',
  'Each of the participants have received their tickets.',
  'Neither the teacher nor the students was ready for the seminar.',
  'The committee members are meeting to finalize the plan.',
];
const committeeExpl =
  "The sentence 'The committee members are meeting to finalize the plan' demonstrates correct subject-verb agreement. " +
  "The plural subject 'committee members' correctly pairs with the plural verb 'are meeting'. " +
  "Option 1 is incorrect because 'bouquet' is singular and should take 'was'. " +
  "Option 2 is wrong because 'each' is singular and requires 'has received'. " +
  'Option 3 fails: Neither the teacher nor the students was ready for the seminar.';
const qVerb = { correct: 2, options: [...committeeOpts], explanation: committeeExpl };
reconcileCorrect(qVerb);
assert('reconcileCorrect keeps keyed answer despite praise for D', qVerb.correct === 2, `got ${qVerb.correct}`);

console.log(process.exitCode ? '\nSome tests failed.' : '\nAll tests passed.');
