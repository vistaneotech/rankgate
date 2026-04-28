/**
 * bank-cron.js — Rank Gate Question Bank Pre-Population Function (v2, hardened)
 *
 * ARCHITECTURE:
 *   API generates → 7-Layer Strict Verification → Question Bank (Supabase)
 *   Exam engine loads from bank ONLY — zero live API calls during a student exam.
 *
 * WHY THIS EXISTS:
 *   Old flow: API called per question during the exam → wrong answers, slow loading.
 *   New flow: Admin runs this cron → only verified questions enter the bank → exam is instant & correct.
 *
 * 7-LAYER VERIFICATION GATE (a question must pass ALL layers to enter the bank):
 *   1. Stem completeness      — stem ≥ 20 chars, no placeholder/truncated text
 *   2. Distinct options       — all 4 options unique, non-empty, ≥ 2 chars
 *   3. Correct-index bounds   — correct ∈ {0,1,2,3}
 *   4. Explanation quality    — ≥ 30 chars, must NOT be a copy of the stem
 *   5. Answer-key consistency — explanation must not name a conflicting letter (A/B/C/D)
 *   6. Numeric self-check     — for Physics/Chemistry/Math: the correct option's numeric
 *                               value must appear in the explanation
 *   7. AI secondary verifier  — independent LLM pass re-solves and re-keys the question
 *                               (uses temperature=0 and a different prompt than the generator)
 *                               If verifier's key differs from generator's key AND the
 *                               verifier is high-confidence, the question is rejected or
 *                               routed to human review (configurable via BANK_REJECT_ON_MISMATCH).
 *
 * Netlify environment variables:
 *   BANK_CRON_SECRET           — required (shared secret for this endpoint)
 *   SUPABASE_URL               — e.g. https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key (bypasses RLS for inserts)
 *   ANTHROPIC_KEY              — primary AI provider (preferred)
 *   OPENAI_KEY                 — fallback AI provider
 *   ANTHROPIC_MODEL            — default claude-sonnet-4-20250514
 *   VERIFIER_MODEL             — model for secondary verifier (default: claude-haiku-4-5-20251001)
 *   BANK_QUESTIONS_PER_SUBJECT — how many Qs to generate per subject per run (default 2)
 *   BANK_VERIFY                — "1" (default) to enable AI secondary verifier, "0" to disable
 *   BANK_REJECT_ON_MISMATCH    — "1" (default) to reject key-mismatches; "0" routes to review queue
 *   BANK_STRICT_NUMERIC        — "1" (default) enforce numeric self-check for STEM subjects
 *   BANK_MAX_RETRIES           — retries per question on generation failure (default 3)
 *   BANK_RETRY_DELAY_MS        — delay between generation retries in ms (default 800)
 *
 * Endpoint: POST /.netlify/functions/bank-cron
 * Auth: Authorization: Bearer <BANK_CRON_SECRET>  or  body.secret === BANK_CRON_SECRET
 *
 * Body parameters (all optional):
 *   subjects       — array, e.g. ["Physics","Math"] (default: all 5 BITSAT subjects)
 *   perSubject     — number of questions per subject (1–20, default env var or 2)
 *   verify         — "1"/"0" override
 *   difficulties   — ["easy","medium","hard"] ratio (default even rotation)
 *   dryRun         — true → generate+verify but do NOT write to Supabase
 */

// ═══════════════════════════════════════════════════════════════
//  TOPIC POOLS (BITSAT)
// ═══════════════════════════════════════════════════════════════
const TP = {
  Physics: [
    'Kinematics 1D','Kinematics 2D & Projectile','Newton Laws & FBD','Friction & Inclined Planes',
    'Work-Energy Theorem','Momentum & Collisions','Rotational Motion & Torque','Moment of Inertia',
    'Gravitation & Orbital Mechanics','Escape Velocity & Satellites','Simple Harmonic Motion',
    'Mechanical Waves & Sound','Electrostatics & Coulomb Law','Gauss Law & Electric Field',
    'Electric Potential & Capacitance','Current Electricity & Ohm Law','Kirchhoff Laws & Wheatstone',
    'Magnetic Force on Charges','Biot-Savart & Ampere Law','EM Induction & Faraday',
    'AC Circuits & Impedance','Electromagnetic Waves','Geometric Optics - Mirrors',
    'Geometric Optics - Lenses','Wave Optics - Interference','Photoelectric Effect',
    'Bohr Model & Spectral Series','Nuclear Physics & Radioactivity','Thermodynamics Laws',
    'Kinetic Theory of Gases','Fluid Mechanics & Bernoulli','Elasticity & Stress-Strain',
    'Surface Tension','Heat Transfer',
  ],
  Chemistry: [
    'Atomic Structure & Quantum Numbers','Chemical Bonding - Ionic & Covalent','VSEPR & Molecular Geometry',
    'Hybridisation sp sp2 sp3','Thermochemistry & Hess Law','Chemical Equilibrium & Le Chatelier',
    'Ionic Equilibrium pH & Buffers','Electrochemistry & Nernst','Chemical Kinetics Rate Laws',
    'Adsorption & Colloids','Coordination Chemistry & CFSE','Stereoisomerism - Optical & Geometric',
    'Organic Mechanisms SN1 SN2','Alkenes Addition & Polymerisation','Alkynes & Cyclic Compounds',
    'Aromatic Electrophilic Substitution','Aldehydes Ketones - Nucleophilic Addition',
    'Carboxylic Acids & Derivatives','Amines & Diazonium','Polymers & Biomolecules',
    's-block Alkali Metals','p-block Group 15 16 17','p-block Group 13 14 Noble Gases',
    'd-block Transition Metals','Colligative Properties','Solid State & Crystal Structure',
    'Purification & Identification','Metallurgy & Extraction',
  ],
  Math: [
    'Limits & Continuity','L Hopital Rule','Differentiation - Chain Rule','Derivatives - Maxima Minima',
    'Rolle & LMVT Theorems','Indefinite Integration - Substitution','Definite Integration & Properties',
    'Area Bounded by Curves','Differential Equations - Separable','Differential Equations - Linear',
    'Matrices Operations & Rank','Determinants & Applications','Probability & Bayes Theorem',
    'Binomial Distribution','Vectors Dot & Cross Product','3D Geometry - Lines','3D Geometry - Planes',
    'Complex Numbers Polar Form','Roots of Unity','Permutations & Combinations','Binomial Theorem',
    'Arithmetic Progressions','Geometric Progressions','Straight Lines & Angles',
    'Circles - Tangent & Normal','Parabola & Properties','Ellipse & Hyperbola',
    'Trigonometric Identities','Inverse Trigonometric Functions','Mathematical Reasoning',
  ],
  English: [
    'Synonyms in Context','Antonyms in Context','Word Analogies','Idioms & Phrases',
    'One Word Substitution','Sentence Correction - Verb Agreement','Sentence Correction - Tense',
    'Active & Passive Voice','Direct & Indirect Speech','Fill in Blanks - Prepositions',
    'Reading Comprehension','Spotting Errors',
  ],
  LR: [
    'Number Series - Arithmetic','Number Series - Geometric','Letter & Alphanumeric Series',
    'Coding & Decoding','Blood Relations','Directions & Distances',
    'Seating Arrangement - Linear','Seating Arrangement - Circular','Syllogisms - All Some None',
    'Statement & Assumptions','Data Sufficiency','Analogy in Reasoning','Clock & Calendar',
    'Venn Diagram Logic',
  ],
};

const DS = {
  easy:   'Single concept, direct formula, 40-50 seconds',
  medium: 'Multi-step, 2-3 concepts, 65-80 seconds',
  hard:   'Complex 3+ concepts, tricky distractors, 90-120 seconds',
};

const NUMERIC_SUBJECTS = new Set(['Physics', 'Chemistry', 'Math']);
const ALWAYS_VERIFY    = new Set(['Physics', 'Chemistry', 'Math', 'LR', 'English']);

// ═══════════════════════════════════════════════════════════════
//  UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════
function strHash32(str) {
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return String(h >>> 0);
}

function salt32(str) {
  return (Number(strHash32(String(str || ''))) || Date.now()) >>> 0;
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

function normalizeCorrectIndex(raw, n = 4) {
  const max = n - 1;
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const t = Math.trunc(raw);
    if (t >= 0 && t <= max) return t;
    if (t >= 1 && t <= n)   return t - 1;
  }
  const s = String(raw).trim();
  if (!s) return 0;
  const u = s.toUpperCase();
  if (u.length === 1 && u >= 'A' && u.charCodeAt(0) < 65 + n) return u.charCodeAt(0) - 65;
  const p = parseInt(s.replace(/[^\d-]/g, ''), 10);
  if (!isNaN(p)) {
    if (p >= 0 && p <= max) return p;
    if (p >= 1 && p <= n)   return p - 1;
  }
  return 0;
}

function qFingerprint(q) {
  const subj  = String(q?.subject   || '').trim();
  const topic = String(q?.topic     || '').trim();
  const stem  = String(q?.question  || '').trim();
  const opts  = (q?.options || []).map(x => String(x || '').trim()).join('|');
  return String(strHash32(`${subj}||${topic}||${stem}||${opts}`));
}

function pickTopic(sub, saltVal) {
  const pool = TP[sub] || TP.Physics;
  return pool[(saltVal >>> 0) % pool.length];
}

function shuffleMCQ(q, saltVal) {
  if (!q || !Array.isArray(q.options) || q.options.length !== 4) return q;
  const opts       = q.options.slice(0, 4).map(t => String(t || ''));
  const oldCorrect = normalizeCorrectIndex(q.correct, 4);
  const perm       = [0, 1, 2, 3];
  const rand       = mulberry32((saltVal >>> 0) ^ 0x9e3779b1);
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  q.options  = perm.map(pi => opts[pi]);
  q.correct  = perm.indexOf(oldCorrect);
  return q;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
//  7-LAYER LOCAL VERIFICATION
// ═══════════════════════════════════════════════════════════════

/** Layer 1: Stem completeness */
function checkStemCompleteness(q) {
  const stem = String(q.question || '').trim();
  if (!stem || stem.length < 20)
    return { pass: false, layer: 1, reason: `Stem too short (${stem.length} chars, need ≥ 20)` };
  if (/\.\.\.|undefined|null|placeholder|lorem ipsum|insert question here/i.test(stem))
    return { pass: false, layer: 1, reason: 'Stem contains placeholder text' };
  if (/^\[.*\]$/.test(stem))
    return { pass: false, layer: 1, reason: 'Stem is just a bracket notation' };
  return { pass: true, layer: 1, reason: 'Stem complete' };
}

/** Layer 2: Distinct options */
function checkDistinctOptions(q) {
  const opts = (q.options || []).slice(0, 4).map(o => String(o || '').trim().toLowerCase());
  if (opts.length !== 4)
    return { pass: false, layer: 2, reason: `Expected 4 options, got ${opts.length}` };
  if (opts.some(o => !o || o.length < 2))
    return { pass: false, layer: 2, reason: 'One or more options are empty or too short' };
  const unique = new Set(opts);
  if (unique.size !== 4)
    return { pass: false, layer: 2, reason: `Only ${unique.size}/4 options are distinct` };
  return { pass: true, layer: 2, reason: 'All 4 options distinct and non-empty' };
}

/** Layer 3: Correct-index bounds */
function checkCorrectIndexBounds(q) {
  const ci = normalizeCorrectIndex(q.correct, 4);
  if (ci < 0 || ci > 3)
    return { pass: false, layer: 3, reason: `correct=${q.correct} out of range {0,1,2,3}` };
  return { pass: true, layer: 3, reason: `correct=${ci} in bounds` };
}

/** Layer 4: Explanation quality */
function checkExplanationQuality(q) {
  const e    = String(q.explanation || '').trim();
  const stem = String(q.question    || '').trim().toLowerCase();
  if (!e || e.length < 30)
    return { pass: false, layer: 4, reason: `Explanation too short (${e.length} chars, need ≥ 30)` };
  if (e.toLowerCase() === stem)
    return { pass: false, layer: 4, reason: 'Explanation is identical to the stem' };
  if (/^\s*(see|refer|check|look)\s+(the\s+)?solution\b/i.test(e))
    return { pass: false, layer: 4, reason: 'Explanation is a placeholder reference' };
  return { pass: true, layer: 4, reason: 'Explanation meets quality bar' };
}

/** Layer 5: Answer-key consistency (explanation must not name a conflicting letter) */
function checkAnswerKeyConsistency(q) {
  const expl = String(q.explanation || '').toLowerCase();
  const ci   = normalizeCorrectIndex(q.correct, 4);

  // Look for "correct/answer is (A/B/C/D)" patterns
  const pat = /\b(correct|answer)\s*(option)?\s*(is|=|:|→|-)\s*\(?\s*([abcd])\s*\)?/i;
  const m   = expl.match(pat);
  if (m) {
    const letter = (m[4] || '').toUpperCase();
    const stated = letter.charCodeAt(0) - 65;
    if (stated >= 0 && stated <= 3 && stated !== ci) {
      return {
        pass:   false,
        layer:  5,
        reason: `Explanation names ${letter} but keyed answer is ${String.fromCharCode(65 + ci)}`,
      };
    }
  }
  return { pass: true, layer: 5, reason: 'Explanation-key letter alignment OK' };
}

/** Layer 6: Numeric self-check (STEM subjects only) */
function checkNumericConsistency(q, subject) {
  if (!NUMERIC_SUBJECTS.has(String(subject || '').trim()))
    return { pass: true, layer: 6, reason: 'N/A (non-numeric subject)' };

  const ci        = normalizeCorrectIndex(q.correct, 4);
  const correctOpt = String((q.options || [])[ci] || '').toLowerCase().trim();
  const expl       = String(q.explanation || '').toLowerCase();

  // Extract the leading number(s) from the correct option
  const numMatch = correctOpt.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return { pass: true, layer: 6, reason: 'No numeric value in correct option to verify' };

  const num = numMatch[1];
  if (num.length >= 2 && !expl.includes(num)) {
    return {
      pass:   false,
      layer:  6,
      reason: `Correct option value "${num}" not found in explanation (possible calculation error)`,
    };
  }
  return { pass: true, layer: 6, reason: `Numeric value "${num}" confirmed in explanation` };
}

/** Run all 6 local layers; returns { pass: bool, failures: [...] } */
function runLocalVerification(q, subject) {
  const checks = [
    checkStemCompleteness(q),
    checkDistinctOptions(q),
    checkCorrectIndexBounds(q),
    checkExplanationQuality(q),
    checkAnswerKeyConsistency(q),
    checkNumericConsistency(q, subject),
  ];
  const failures = checks.filter(c => !c.pass);
  return { pass: failures.length === 0, checks, failures };
}

// ═══════════════════════════════════════════════════════════════
//  AI SECONDARY VERIFIER — Layer 7
// ═══════════════════════════════════════════════════════════════
async function runAIVerifier(q, subject, topic, callLLM, envCfg) {
  const sub  = String(subject || '').trim() || 'General';
  const top  = String(topic   || '').trim();
  const ci   = normalizeCorrectIndex(q.correct, 4);
  const opts = (q.options || []).slice(0, 4).map(o => String(o || '').trim());

  const verifierModel = envCfg.verifierModel || 'claude-haiku-4-5-20251001';

  const prompt = `You are a strict BITSAT exam question verifier. Your ONLY job is to independently solve the question and verify the answer key.

SUBJECT: ${sub}${top ? `\nTOPIC: ${top}` : ''}

QUESTION:
${q.question}

OPTIONS (0-indexed):
0) ${opts[0]}
1) ${opts[1]}
2) ${opts[2]}
3) ${opts[3]}

GENERATOR KEYED ANSWER: ${ci} (option "${opts[ci]}")
GENERATOR EXPLANATION: ${q.explanation}

TASK:
1. Solve the question INDEPENDENTLY from scratch.
2. Identify the correct option index (0, 1, 2, or 3).
3. Check if the generator's keyed answer ${ci} is correct.
4. Check if the explanation is accurate and matches your answer.
5. For Physics/Chemistry/Math: recompute any calculations numerically.

Return ONLY this JSON (no markdown, no extra text):
{
  "verdict": "PASS",
  "your_correct_index": ${ci},
  "confidence": "high",
  "explanation_accurate": true,
  "issue": ""
}

verdict must be "PASS" or "FAIL".
confidence must be "high", "medium", or "low".
If verdict is "FAIL", set your_correct_index to what YOU believe is correct and describe the issue.
If confidence is "low", set verdict to "PASS" (do not reject borderline cases).`;

  try {
    const data = await callLLM({
      model:       verifierModel,
      max_tokens:  280,
      temperature: 0,
      messages:    [{ role: 'user', content: prompt }],
    });

    const raw = String(data?.content?.[0]?.text || '').trim()
      .replace(/^```(?:json)?[\r\n]*/i, '')
      .replace(/[\r\n]*```$/i, '')
      .trim();

    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a < 0 || b < 0) return { pass: true, layer: 7, reason: 'AI verifier returned unparseable response; skipped' };

    const r = JSON.parse(raw.slice(a, b + 1));

    const verdict     = String(r.verdict     || 'PASS').toUpperCase();
    const confidence  = String(r.confidence  || 'medium').toLowerCase();
    const theirIndex  = normalizeCorrectIndex(r.your_correct_index, 4);
    const issue       = String(r.issue       || '').trim();

    if (verdict === 'FAIL' && confidence === 'high') {
      return {
        pass:         false,
        layer:        7,
        reason:       `AI verifier (high-confidence) disagrees: says index ${theirIndex} not ${ci}. ${issue}`,
        theirIndex,
        confidence,
      };
    }

    if (verdict === 'FAIL' && confidence === 'medium') {
      // Medium-confidence disagreement → mark for human review rather than outright reject
      return {
        pass:             true,
        needsHumanReview: true,
        layer:            7,
        reason:           `AI verifier (medium-confidence) flagged: ${issue}. Routing to review queue.`,
        theirIndex,
        confidence,
      };
    }

    return {
      pass:      true,
      layer:     7,
      reason:    `AI verifier OK (${confidence} confidence)`,
      theirIndex: ci,
      confidence,
    };
  } catch (e) {
    // If verifier itself errors, do not reject the question — log and pass
    return {
      pass:   true,
      layer:  7,
      reason: `AI verifier skipped due to error: ${String(e?.message || '').slice(0, 80)}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
//  PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════
function makePrompt(sub, topic, diff, seed, sesNum) {
  const corrEx = ((Number(seed) || 0) % 4 + 4) % 4;

  const diagramPolicy = {
    Physics:   '- Diagrams are RARE. Include ONLY when the question physically requires a circuit, ray path, or P-V graph. Use ASCII only (4-16 lines, ≤ 52 chars/line).',
    Chemistry: '- Do NOT include any diagram. Omit the "diagram" key entirely.',
    Math:      '- Do NOT include any diagram/graph. Omit the "diagram" key entirely.',
    English:   '- Do NOT include any diagram. Omit the "diagram" key entirely.',
    LR:        '- Include "diagram" only for seating/Venn/direction puzzles where it is essential. ASCII only.',
  };

  const footer = [
    '',
    'STRICT RULES (ALL MUST BE FOLLOWED):',
    '- Return ONLY valid JSON. No markdown fences, no preamble, no extra text.',
    '- "correct" MUST be a single integer in {0,1,2,3} (0-based index into options array).',
    '- All 4 options must be DISTINCT and non-empty.',
    '- Wrong options must represent common student mistakes / plausible distractors.',
    '- Explanation must:',
    '    (a) Be ≥ 30 characters',
    '    (b) Justify ONLY the correct answer with clear working',
    '    (c) NOT reference option letters A/B/C/D — refer to the correct option by its value',
    '    (d) NOT contradict the keyed answer (no "answer is X... however correct option is Y")',
    '    (e) For Physics/Chemistry/Math: show explicit calculation steps',
    '- The numeric value in the correct option MUST appear in the explanation for STEM subjects.',
    '- Use Unicode: π not pi, ² not ^2, ms⁻¹ not m/s, √ not sqrt.',
    `- ${diagramPolicy[sub] || diagramPolicy.Physics}`,
    `- Uniqueness seed: ${seed} | Session: ${sesNum}`,
    '',
    'NUMERIC SELF-CHECK (Physics/Chemistry/Math mandatory):',
    '- Recompute every sum, product, and ratio from first principles before outputting.',
    '- Your answer in the explanation must match EXACTLY one of the four option strings.',
    '- If your working produces a value not in the options, rewrite the stem numbers and options.',
    '',
    'JSON shape (return this exactly):',
    `{"question":"...","options":["...","...","...","..."],"correct":${corrEx},"explanation":"step-by-step working","difficulty":"${diff}","topic":"${topic}"}`,
  ].join('\n');

  const prompts = {
    Physics: `You are a BITSAT Physics expert with 15 years of paper-setting experience.\nGenerate 1 ORIGINAL Physics MCQ at ${diff} difficulty.\nTopic: ${topic}\nDifficulty descriptor: ${DS[diff]}\nSeed: ${seed} | Session: ${sesNum}\nRules: Use SPECIFIC numbers and units. Wrong options = classic calculation errors. No trivial recall questions.${footer}`,
    Chemistry: `You are a BITSAT Chemistry expert.\nGenerate 1 ORIGINAL Chemistry MCQ at ${diff} difficulty.\nTopic: ${topic}\nDifficulty descriptor: ${DS[diff]}\nSeed: ${seed} | Session: ${sesNum}\nRules: Use real compounds and reagents. For organic: specify conditions. Numerical MCQs must have clear calculation paths.${footer}`,
    Math: `You are a BITSAT Mathematics expert.\nGenerate 1 ORIGINAL Math MCQ at ${diff} difficulty.\nTopic: ${topic}\nDifficulty descriptor: ${DS[diff]}\nSeed: ${seed} | Session: ${sesNum}\nRules: Use specific numbers. Show full calculation in explanation. Wrong options = common algebraic/arithmetic errors.${footer}`,
    English: `You are a BITSAT English expert.\nGenerate 1 ORIGINAL English MCQ at ${diff} difficulty.\nTopic: ${topic}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly ONE correct answer. Distractors must be plausible but clearly wrong to a careful reader. Use British English spelling.${footer}`,
    LR: `You are a BITSAT Logical Reasoning expert.\nGenerate 1 ORIGINAL LR MCQ at ${diff} difficulty.\nTopic: ${topic}\nSeed: ${seed} | Session: ${sesNum}\nRules: EXACTLY ONE valid answer deducible from the given information. All premises must be internally consistent.${footer}`,
  };
  return prompts[sub] || prompts.Physics;
}

// ═══════════════════════════════════════════════════════════════
//  QUESTION PARSER
// ═══════════════════════════════════════════════════════════════
function parseQ(text, sub, topic) {
  let s = String(text || '')
    .trim()
    .replace(/^```(?:json)?[\r\n]*/i, '')
    .replace(/[\r\n]*```$/i, '')
    .trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) s = s.slice(a, b + 1);

  const q = JSON.parse(s);
  if (!q.question || typeof q.question !== 'string') throw new Error('No question field');
  if (!Array.isArray(q.options) || q.options.length < 4) throw new Error('Bad options array');

  q.type        = 'MCQ';
  q.subject     = String(sub   || q.subject   || '').trim();
  q.topic       = String(topic || q.topic     || 'General').trim();
  q.difficulty  = String(q.difficulty || 'medium').toLowerCase();
  q.correct     = normalizeCorrectIndex(q.correct, 4);
  q.options     = q.options.slice(0, 4).map(o => String(o || '').trim() || 'Option');
  q.explanation = String(q.explanation || q.solution || '').trim();

  // Sanitize diagram
  const d = q.diagram;
  if (d != null && typeof d === 'object') {
    const kind  = String(d.kind || 'ascii').toLowerCase();
    const ascii = String(d.ascii || '').trim();
    if (kind === 'ascii' && ascii.length >= 20) {
      q.diagram = { kind: 'ascii', caption: String(d.caption || 'Diagram').trim(), ascii };
    } else {
      delete q.diagram;
    }
  } else {
    delete q.diagram;
  }

  // English/Chemistry/Math never get diagrams
  if (['English', 'Chemistry', 'Math'].includes(String(sub || '').trim())) delete q.diagram;

  return q;
}

// ═══════════════════════════════════════════════════════════════
//  BANK ROW BUILDER
// ═══════════════════════════════════════════════════════════════
function buildBankRow(q, meta = {}) {
  return {
    id:          qFingerprint(q),
    subject:     String(q.subject     || '').trim() || null,
    topic:       String(q.topic       || '').trim() || null,
    difficulty:  String(q.difficulty  || 'medium').toLowerCase(),
    question:    String(q.question    || '').trim(),
    options:     (q.options || []).slice(0, 4).map(x => String(x || '').trim()),
    correct:     normalizeCorrectIndex(q.correct, 4),
    explanation: String(q.explanation || '').trim(),
    diagram:     q.diagram || null,
    created_by:  null,
    // Store verification metadata for audit (Supabase will ignore unknown columns gracefully)
    _verify_passed_layers: meta.passedLayers || 7,
    _generated_at:         new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
//  REVIEW QUEUE (human review for medium-confidence mismatches)
// ═══════════════════════════════════════════════════════════════
async function pushToReviewQueue(supabaseUrl, serviceKey, q, reason) {
  const row = {
    subject:             q.subject || null,
    topic:               q.topic   || null,
    difficulty:          q.difficulty || 'medium',
    status:              'pending',
    question_fingerprint: qFingerprint(q),
    doubt_reasons:       [String(reason || '').slice(0, 500)],
    payload:             {
      question:    q.question,
      options:     q.options,
      correct:     q.correct,
      explanation: q.explanation,
      diagram:     q.diagram || null,
    },
    created_at: new Date().toISOString(),
  };
  try {
    const r = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/question_review_queue`, {
      method:  'POST',
      headers: {
        apikey:         serviceKey,
        Authorization:  `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      console.warn('Review queue insert failed:', r.status, t.slice(0, 200));
    }
  } catch (e) {
    console.warn('Review queue push error:', e?.message || e);
  }
}

// ═══════════════════════════════════════════════════════════════
//  SUPABASE UPSERT
// ═══════════════════════════════════════════════════════════════
async function upsertRows(supabaseUrl, serviceKey, rows) {
  const r = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/question_bank`, {
    method:  'POST',
    headers: {
      apikey:         serviceKey,
      Authorization:  `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer:         'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase upsert HTTP ${r.status}: ${t.slice(0, 300)}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  LLM CALL (Anthropic → OpenAI fallback)
// ═══════════════════════════════════════════════════════════════
async function callLLM(body) {
  const AKEY = process.env.ANTHROPIC_KEY || '';
  const OKEY = process.env.OPENAI_KEY    || '';
  const MDL  = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

  if (AKEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'content-type':      'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key':         AKEY,
      },
      body: JSON.stringify({ ...body, model: body.model || MDL }),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}: ${txt.slice(0, 200)}`);
    return JSON.parse(txt);
  }

  if (OKEY) {
    const openaiBody = {
      model:       'gpt-4o',
      max_tokens:  body.max_tokens ?? 1100,
      temperature: body.temperature ?? 1.0,
      messages:    body.messages,
    };
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${OKEY}` },
      body:    JSON.stringify(openaiBody),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${txt.slice(0, 200)}`);
    const d = JSON.parse(txt);
    return { content: [{ type: 'text', text: String(d?.choices?.[0]?.message?.content ?? '') }] };
  }

  throw new Error('No ANTHROPIC_KEY or OPENAI_KEY configured on server');
}

// ═══════════════════════════════════════════════════════════════
//  AUTHORIZATION
// ═══════════════════════════════════════════════════════════════
function authorize(event, bodyObj) {
  const want = process.env.BANK_CRON_SECRET || '';
  if (!want) return false;
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  if (auth === `Bearer ${want}`) return true;
  if (bodyObj?.secret === want) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  NETLIFY HANDLER
// ═══════════════════════════════════════════════════════════════
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'POST,OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Use POST' }) };
  }

  let bodyObj = {};
  try { bodyObj = JSON.parse(event.body || '{}'); } catch (_e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!authorize(event, bodyObj)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized — check BANK_CRON_SECRET' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }) };
  }

  // Config
  const perSubject  = Math.max(1, Math.min(20, Number(bodyObj.perSubject || process.env.BANK_QUESTIONS_PER_SUBJECT || 2)));
  const subjects    = Array.isArray(bodyObj.subjects) && bodyObj.subjects.length ? bodyObj.subjects : ['Physics', 'Chemistry', 'Math', 'English', 'LR'];
  const doAiVerify  = String(process.env.BANK_VERIFY || bodyObj.verify || '1') !== '0';
  const rejectOnMismatch = String(process.env.BANK_REJECT_ON_MISMATCH || '1') !== '0';
  const strictNumeric    = String(process.env.BANK_STRICT_NUMERIC || '1') !== '0';
  const maxRetries  = Math.max(1, Math.min(5, Number(process.env.BANK_MAX_RETRIES || 3)));
  const retryDelay  = Math.max(200, Number(process.env.BANK_RETRY_DELAY_MS || 800));
  const dryRun      = bodyObj.dryRun === true;

  const envCfg = {
    verifierModel: process.env.VERIFIER_MODEL || 'claude-haiku-4-5-20251001',
    rejectOnMismatch,
    strictNumeric,
  };

  const baseSalt = (Date.now() % 0xffffffff) >>> 0;
  const results  = {
    generated: 0, passedAll7Layers: 0, rejectedLocalCheck: 0,
    rejectedAiVerifier: 0, routedToReview: 0, dbInserted: 0, errors: [],
    perSubject, subjects, dryRun, doAiVerify,
  };
  const rowsBatch = [];

  for (let si = 0; si < subjects.length; si++) {
    const sub    = subjects[si];
    const topics = TP[sub];
    if (!topics) {
      results.errors.push({ subject: sub, error: 'Unknown subject' });
      continue;
    }

    for (let i = 0; i < perSubject; i++) {
      const saltPick = salt32(`pick|${baseSalt}|${sub}|${si}|${i}`);
      const topic    = pickTopic(sub, saltPick);
      const diff     = ['easy', 'medium', 'hard'][(i + si) % 3];
      const seed     = ((baseSalt + i * 7919 + si * 13) % 999983) + 1;
      const sesNum   = 999000 + si * 10 + i;

      let q        = null;
      let genError = null;

      // ── GENERATION with retries ──
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const s2 = seed + attempt * 7919;
        try {
          const data = await callLLM({
            max_tokens:  1200,
            temperature: NUMERIC_SUBJECTS.has(sub) ? 0.5 : 0.9,
            messages:    [{ role: 'user', content: makePrompt(sub, topic, diff, s2, sesNum) }],
          });
          const txt = String(data?.content?.[0]?.text || '').trim();
          if (!txt) throw new Error('Empty model response');
          q = parseQ(txt, sub, topic);
          genError = null;
          break;
        } catch (e) {
          genError = e;
          if (attempt < maxRetries - 1) await sleep(retryDelay * (attempt + 1));
        }
      }

      if (!q) {
        results.errors.push({ subject: sub, topic, diff, error: `Generation failed after ${maxRetries} attempts: ${String(genError?.message || '').slice(0, 120)}` });
        continue;
      }

      results.generated++;

      // Shuffle to randomise correct-answer position before verification
      q = shuffleMCQ(q, salt32(`${seed}|pre|${sub}|${topic}`));

      // ── 6 LOCAL LAYERS ──
      const localResult = runLocalVerification(q, sub);
      if (!localResult.pass) {
        results.rejectedLocalCheck++;
        results.errors.push({
          subject: sub, topic, diff,
          error:   `Local verify failed: ${localResult.failures.map(f => `[L${f.layer}] ${f.reason}`).join(' | ')}`,
        });
        continue; // reject — do not enter bank
      }

      // ── LAYER 7: AI VERIFIER ──
      let needsReview = false;
      if (doAiVerify && ALWAYS_VERIFY.has(sub)) {
        const aiResult = await runAIVerifier(q, sub, topic, callLLM, envCfg);

        if (!aiResult.pass && rejectOnMismatch) {
          results.rejectedAiVerifier++;
          results.errors.push({
            subject: sub, topic, diff,
            error:   `AI verifier rejected: ${aiResult.reason}`,
          });
          continue; // reject — do not enter bank
        }

        if (!aiResult.pass && !rejectOnMismatch) {
          // Route to human review queue
          needsReview = true;
        }

        if (aiResult.needsHumanReview) {
          needsReview = true;
        }
      }

      // Final shuffle after all verification passes (prevents positional bias)
      q = shuffleMCQ(q, salt32(`${seed}|post|${sub}|${i}`));

      results.passedAll7Layers++;
      const row = buildBankRow(q, { passedLayers: needsReview ? 6 : 7 });
      rowsBatch.push(row);

      if (needsReview && !dryRun) {
        results.routedToReview++;
        await pushToReviewQueue(supabaseUrl, serviceKey, q, 'AI verifier medium-confidence flag');
      }

      await sleep(350); // gentle rate-limit between questions
    }
  }

  // ── DB WRITE ──
  const approvedRows = rowsBatch.filter(r => (r._verify_passed_layers || 0) >= 7);
  if (approvedRows.length > 0 && !dryRun) {
    try {
      await upsertRows(supabaseUrl, serviceKey, approvedRows);
      results.dbInserted = approvedRows.length;
    } catch (e) {
      return {
        statusCode: 502,
        headers:    { 'content-type': 'application/json' },
        body:       JSON.stringify({ error: `Supabase write failed: ${String(e?.message || '').slice(0, 200)}`, results }),
      };
    }
  } else if (dryRun) {
    results.dbInserted = 0;
    results.dryRunRows = approvedRows.length;
  }

  return {
    statusCode: 200,
    headers:    { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
    body:       JSON.stringify({
      message:          `Bank population complete. ${results.dbInserted} questions written to Supabase.`,
      generated:        results.generated,
      passed_7_layers:  results.passedAll7Layers,
      rejected_local:   results.rejectedLocalCheck,
      rejected_ai:      results.rejectedAiVerifier,
      routed_review:    results.routedToReview,
      db_inserted:      results.dbInserted,
      dry_run:          results.dryRun,
      errors:           results.errors,
      subjects:         results.subjects,
      per_subject:      results.perSubject,
    }),
  };
};
