
// ══════════════════════════════════════════════
//  SUPABASE INIT
// ══════════════════════════════════════════════
const SUPA_URL = 'https://vikgpdkxpmxclsepgclk.supabase.co';
const SUPA_KEY = 'sb_publishable_xw_AzIB5wA2HopcFDdmMbQ_19NjGESo';
// Supabase → Authentication → URL Configuration (required when the public URL changes):
//   Site URL: https://www.rankgate.in
//   Additional Redirect URLs: https://www.rankgate.in/*  https://rankgate.in/*  (plus localhost or previews if you use them).
// NOTE: The Supabase UMD bundle defines a global `var supabase` (library namespace).
// Do NOT declare `const supabase` here — it causes: "Identifier 'supabase' has already been declared".
let sb=null;
try{
  if(typeof supabase!=='undefined'&&supabase&&typeof supabase.createClient==='function'){
    sb=supabase.createClient(SUPA_URL,SUPA_KEY,{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true,
        flowType:'pkce',
        storage:typeof window!=='undefined'?window.localStorage:undefined
      }
    });
  }
}catch(_e){
  sb=null;
}

// When there are no browser API keys, questions go through `/.netlify/functions/generate-question`.
// That path only exists on the Netlify deployment (or `netlify dev`). Opening this file from disk
// or using a plain static server sends the request to the wrong host and questions never load.
// Production uses the page origin automatically; this is the fallback for file:// or localhost dev.
// Must be https when the live site uses TLS (mixed content: an https page cannot call http:// APIs).
const QUESTION_PROXY_ORIGIN = 'https://www.rankgate.in';

// Auth tabs: avoid relying on inline onclick (some embedded browser previews block it).
function wireAuthTabs(){
  const loginBtn=document.getElementById('authTabLogin');
  const signupBtn=document.getElementById('authTabSignup');
  if(!loginBtn||!signupBtn) return;
  if(loginBtn.dataset.wired==='1' && signupBtn.dataset.wired==='1') return;
  loginBtn.addEventListener('click', () => switchAuthTab('login'));
  signupBtn.addEventListener('click', () => switchAuthTab('signup'));
  loginBtn.dataset.wired='1';
  signupBtn.dataset.wired='1';
}
function bootWireAuthTabs(){
  wireAuthTabs();
  // Extra safety for embedded previews / late DOM hydration
  window.addEventListener('load', wireAuthTabs, {once:true});
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bootWireAuthTabs);
}else{
  bootWireAuthTabs();
}

// ══════════════════════════════════════════════
//  THEME (Dark/Light) — system + toggle + persist
// ══════════════════════════════════════════════
function getSystemTheme(){
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function setTheme(theme, persist=true){
  const t=(theme==='light' || theme==='dark') ? theme : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  if(persist){
    try{ localStorage.setItem('theme', t); }catch(_e){}
  }
  // Update button labels wherever present
  const isLight=t==='light';
  const ico=isLight?'☀️':'🌙';
  const txt=isLight?'Light':'Dark';
  ['Top','Cfg','Exam','Res','Auth'].forEach(s=>{
    const i=document.getElementById('themeIco'+s);
    const x=document.getElementById('themeTxt'+s);
    if(i) i.textContent=ico;
    if(x) x.textContent=txt;
  });
}
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(cur==='light'?'dark':'light', true);
}
window.toggleTheme=toggleTheme;

function initTheme(){
  let saved=null;
  try{ saved=localStorage.getItem('theme'); }catch(_e){ saved=null; }
  if(saved==='light' || saved==='dark') setTheme(saved, false);
  else setTheme(getSystemTheme(), false);
  // React to OS changes only when user hasn't pinned a preference
  try{
    const mq=window.matchMedia('(prefers-color-scheme: light)');
    const handler=()=> {
      let pinned=null;
      try{ pinned=localStorage.getItem('theme'); }catch(_e){ pinned=null; }
      if(pinned!=='light' && pinned!=='dark') setTheme(getSystemTheme(), false);
    };
    if(mq && typeof mq.addEventListener==='function') mq.addEventListener('change', handler);
    else if(mq && typeof mq.addListener==='function') mq.addListener(handler);
  }catch(_e){}
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initTheme);
}else{
  initTheme();
}

const API = 'https://api.anthropic.com/v1/messages';
const MDL = 'claude-sonnet-4-20250514';
const CIRC = 263.9;

// ══════════════════════════════════════════════
//  APP SETTINGS (admin-managed best-effort)
// ══════════════════════════════════════════════
const DEFAULT_SETTINGS={
  api_keys:{anthropic:'',openai:''},
  // Optional: full origin for the Netlify question proxy (overrides QUESTION_PROXY_ORIGIN for local dev).
  api_proxy:{enabled:false,base_url:''},
  // Weighted routing for question generation
  gen_ratio:{api:0.0, bank:1.0},
  // Max parallel AI generations (1–4). Higher can speed a fast provider but often causes 429s on Netlify.
  gen_concurrency:2,
  // How many upcoming questions to keep warm (sliding window). Not all indices at once.
  prefetch_ahead:6,
  // Prefer bank by subject/topic match; keep a small tail for "any subject"
  bank:{enabled:true, max_local:600},
  // Prompt training blocks (admin-set). Used to enforce real-exam style.
  prompt_training:{
    // Applied when cfg.exam === 'BITSAT'
    bitsat:''
  },
  // Question sequencing:
  // - subject_batch: finish one subject/section before moving to next (default)
  // - random: shuffle subject/section order across the test
  question_order:'subject_batch'
};
let APP_SETTINGS=structuredClone ? structuredClone(DEFAULT_SETTINGS) : JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

function safeJsonParse(s, fallback){
  try{ return JSON.parse(s); }catch(_e){ return fallback; }
}
function loadLocalSettings(){
  try{
    const raw=localStorage.getItem('app_settings');
    if(!raw) return;
    const x=safeJsonParse(raw,null);
    if(x && typeof x==='object') APP_SETTINGS=mergeSettings(DEFAULT_SETTINGS,x);
  }catch(_e){}
}
function saveLocalSettings(){
  try{ localStorage.setItem('app_settings', JSON.stringify(APP_SETTINGS)); }catch(_e){}
}
function mergeSettings(base, override){
  const out=structuredClone ? structuredClone(base) : JSON.parse(JSON.stringify(base));
  function assign(dst, src){
    if(!src || typeof src!=='object') return;
    Object.keys(src).forEach(k=>{
      const v=src[k];
      if(v && typeof v==='object' && !Array.isArray(v)){
        if(!dst[k] || typeof dst[k]!=='object') dst[k]={};
        assign(dst[k], v);
      }else{
        dst[k]=v;
      }
    });
  }
  assign(out, override);
  return out;
}
loadLocalSettings();

async function loadRemoteSettings(){
  if(!sb) return;
  try{
    const {data, error}=await sb.from('app_settings').select('settings_json').eq('id','global').maybeSingle();
    if(error) return;
    const x=data?.settings_json;
    if(x && typeof x==='object'){
      // NOTE: This merges any public settings (ratios, toggles, etc.).
      // Do NOT rely on browser-stored provider keys in production.
      APP_SETTINGS=mergeSettings(DEFAULT_SETTINGS,x);
      saveLocalSettings();
    }
  }catch(_e){}
}
async function saveRemoteSettingsIfAdmin(){
  if(!sb || !PROFILE || PROFILE.role!=='admin') return {ok:false};
  try{
    const payload={id:'global',settings_json:APP_SETTINGS,updated_by:USER?.id||null};
    const {error}=await sb.from('app_settings').upsert(payload);
    if(error) throw error;
    return {ok:true};
  }catch(e){
    return {ok:false, error:e};
  }
}

// ══ APP STATE ══
let USER = null;
let PROFILE = null;

// ══ TOPIC POOLS (anti-repeat — tracks per DB user) ══
const TP = {
  Physics:['Kinematics 1D','Kinematics 2D & Projectile','Newton Laws & FBD','Friction & Inclined Planes','Work-Energy Theorem','Momentum & Collisions','Rotational Motion & Torque','Moment of Inertia','Gravitation & Orbital Mechanics','Escape Velocity & Satellites','Simple Harmonic Motion','Mechanical Waves & Sound','Electrostatics & Coulomb Law','Gauss Law & Electric Field','Electric Potential & Capacitance','Current Electricity & Ohm Law','Kirchhoff Laws & Wheatstone','Magnetic Force on Charges','Biot-Savart & Ampere Law','EM Induction & Faraday','AC Circuits & Impedance','Electromagnetic Waves','Geometric Optics - Mirrors','Geometric Optics - Lenses','Wave Optics - Interference','Photoelectric Effect','Bohr Model & Spectral Series','Nuclear Physics & Radioactivity','Thermodynamics Laws','Kinetic Theory of Gases','Fluid Mechanics & Bernoulli','Elasticity & Stress-Strain','Surface Tension','Heat Transfer'],
  Chemistry:['Atomic Structure & Quantum Numbers','Chemical Bonding - Ionic & Covalent','VSEPR & Molecular Geometry','Hybridisation sp sp2 sp3','Thermochemistry & Hess Law','Chemical Equilibrium & Le Chatelier','Ionic Equilibrium pH & Buffers','Electrochemistry & Nernst','Chemical Kinetics Rate Laws','Adsorption & Colloids','Coordination Chemistry & CFSE','Stereoisomerism - Optical & Geometric','Organic Mechanisms SN1 SN2','Alkenes Addition & Polymerisation','Alkynes & Cyclic Compounds','Aromatic Electrophilic Substitution','Aldehydes Ketones - Nucleophilic Addition','Carboxylic Acids & Derivatives','Amines & Diazonium','Polymers & Biomolecules','s-block Alkali Metals','p-block Group 15 16 17','p-block Group 13 14 Noble Gases','d-block Transition Metals','Colligative Properties','Solid State & Crystal Structure','Purification & Identification','Metallurgy & Extraction'],
  Math:['Limits & Continuity','L Hopital Rule','Differentiation - Chain Rule','Derivatives - Maxima Minima','Rolle & LMVT Theorems','Indefinite Integration - Substitution','Definite Integration & Properties','Area Bounded by Curves','Differential Equations - Separable','Differential Equations - Linear','Matrices Operations & Rank','Determinants & Applications','Probability & Bayes Theorem','Binomial Distribution','Vectors Dot & Cross Product','3D Geometry - Lines','3D Geometry - Planes','Complex Numbers Polar Form','Roots of Unity','Permutations & Combinations','Binomial Theorem','Arithmetic Progressions','Geometric Progressions','Straight Lines & Angles','Circles - Tangent & Normal','Parabola & Properties','Ellipse & Hyperbola','Trigonometric Identities','Inverse Trigonometric Functions','Mathematical Reasoning'],
  English:['Synonyms in Context','Antonyms in Context','Word Analogies','Idioms & Phrases','One Word Substitution','Sentence Correction - Verb Agreement','Sentence Correction - Tense','Active & Passive Voice','Direct & Indirect Speech','Fill in Blanks - Prepositions','Reading Comprehension','Spotting Errors'],
  LR:['Number Series - Arithmetic','Number Series - Geometric','Letter & Alphanumeric Series','Coding & Decoding','Blood Relations','Directions & Distances','Seating Arrangement - Linear','Seating Arrangement - Circular','Syllogisms - All Some None','Statement & Assumptions','Data Sufficiency','Analogy in Reasoning','Clock & Calendar','Venn Diagram Logic'],
  // Exam extensions (CUET)
  Language:['Synonyms in Context','Antonyms in Context','Word Analogies','Idioms & Phrases','One Word Substitution','Sentence Correction - Verb Agreement','Sentence Correction - Tense','Reading Comprehension','Spotting Errors'],
  General:['Number Series - Arithmetic','Coding & Decoding','Directions & Distances','Seating Arrangement - Linear','Syllogisms - All Some None','Data Sufficiency','Analogy in Reasoning','Clock & Calendar','Venn Diagram Logic'],
  Biology:['Cell & Biomolecules','Genetics & Inheritance','Human Physiology','Plant Physiology','Ecology & Environment','Evolution & Diversity'],
  Economics:['Microeconomics Basics','Demand & Supply','National Income','Inflation & Money','Fiscal Policy','Statistics & Data Interpretation'],
  History:['Ancient India','Medieval India','Modern India','World History Basics','Indian National Movement'],
  Geography:['Physical Geography','Climate & Weather','Indian Geography','Maps & Coordinates','Resources & Industries'],
  'Political Science':['Constitution Basics','Fundamental Rights','Parliament & Executive','Judiciary','International Relations'],
  Accountancy:['Journal & Ledger','Trial Balance','Final Accounts','Depreciation','Cash Flow Basics'],
  'Business Studies':['Principles of Management','Business Environment','Marketing Basics','Finance Basics','Entrepreneurship'],
  'Computer Science':['Programming Basics','Data Structures Basics','DBMS Basics','Networks Basics','Operating Systems Basics']
  ,
  // International / aptitude exam pools (compact)
  SAT_RW:['Grammar & Usage','Rhetorical Synthesis','Words in Context','Text Structure & Purpose','Transitions','Command of Evidence','Reading Comprehension'],
  SAT_MATH:['Algebra','Advanced Math','Problem Solving & Data Analysis','Geometry & Trigonometry','Functions & Graphs','Linear Equations','Quadratics'],
  ACT_ENG:['Grammar & Usage','Punctuation','Sentence Structure','Rhetoric & Style','Organization','Conciseness'],
  ACT_MATH:['Pre-Algebra','Algebra','Geometry','Trigonometry','Statistics & Probability','Functions'],
  ACT_READ:['Main Idea','Inference','Detail','Author Purpose','Vocabulary in Context','Comparisons'],
  ACT_SCI:['Data Representation','Research Summaries','Conflicting Viewpoints','Graphs & Tables'],
  IELTS_LISTEN:['Listening - MCQ','Listening - Matching','Listening - Form Completion'],
  IELTS_READ:['Reading - MCQ','Reading - Matching','Reading - True/False/Not Given'],
  TOEFL_READ:['Reading - Detail','Reading - Inference','Reading - Vocabulary','Reading - Insert Text'],
  TOEFL_LISTEN:['Listening - Gist','Listening - Detail','Listening - Attitude','Listening - Organization'],
  GRE_VERB:['Text Completion','Sentence Equivalence','Reading Comprehension','Vocabulary'],
  GRE_QUANT:['Arithmetic','Algebra','Geometry','Data Analysis'],
  GMAT_VERB:['Critical Reasoning','Reading Comprehension','Sentence Correction Style'],
  GMAT_QUANT:['Arithmetic','Algebra','Word Problems','Rates & Work'],
  GMAT_DI:['Table Analysis','Graphics Interpretation','Two-Part Analysis','Multi-Source Reasoning'],
  CAT_VARC:['Reading Comprehension','Para-jumbles','Odd Sentence','Summary'],
  CAT_DILR:['Bar/Line Charts','Tables','Seating Arrangement','Games & Tournaments','Venn/Set Logic'],
  CAT_QA:['Arithmetic','Algebra','Geometry','Number System','Modern Math'],
  APT_QA:['Arithmetic','Algebra Basics','Percentages','Ratio & Proportion','Time & Work','Time & Distance'],
  APT_DILR:['Data Interpretation','Puzzles','Seating Arrangement','Syllogisms','Coding-Decoding'],
  APT_VAR:['Vocabulary','Grammar','RC Basics','Sentence Correction','Para-jumbles']
  ,
  // GATE 2027 (default CS-like paper model)
  GATE_GA:['Verbal Ability','Numerical Ability','Analytical Reasoning','Data Interpretation'],
  GATE_MATH:['Discrete Mathematics','Linear Algebra','Calculus','Probability & Statistics'],
  GATE_CORE:['Programming','Data Structures','Algorithms','Operating Systems','DBMS','Computer Networks','Digital Logic','Compiler Basics']
};

const DS = {
  easy:'Single concept, direct formula, 40-50 seconds',
  medium:'Multi-step, 2-3 concepts, 65-80 seconds',
  hard:'Complex 3+ concepts, tricky distractors, 90-120 seconds'
};

const SC = {Physics:'#60a5fa',Chemistry:'#4ade80',Math:'#fbbf24',English:'#c084fc',LR:'#f87171',Language:'#c084fc',General:'#f87171',Biology:'#22c55e',Economics:'#f59e0b',History:'#a855f7',Geography:'#06b6d4','Political Science':'#ef4444',Accountancy:'#f59e0b','Business Studies':'#22c55e','Computer Science':'#60a5fa',
  SAT_RW:'#c084fc',SAT_MATH:'#fbbf24',ACT_ENG:'#c084fc',ACT_MATH:'#fbbf24',ACT_READ:'#a855f7',ACT_SCI:'#60a5fa',
  IELTS_LISTEN:'#06b6d4',IELTS_READ:'#a855f7',TOEFL_READ:'#a855f7',TOEFL_LISTEN:'#06b6d4',
  GRE_VERB:'#c084fc',GRE_QUANT:'#fbbf24',GMAT_VERB:'#c084fc',GMAT_QUANT:'#fbbf24',GMAT_DI:'#06b6d4',
  CAT_VARC:'#a855f7',CAT_DILR:'#f87171',CAT_QA:'#fbbf24',APT_QA:'#fbbf24',APT_DILR:'#f87171',APT_VAR:'#c084fc'
};
const TC = {Physics:'tb-phy',Chemistry:'tb-che',Math:'tb-mat',English:'tb-eng',LR:'tb-lr',Language:'tb-eng',General:'tb-lr',Biology:'tb-che',Economics:'tb-mat',History:'tb-eng',Geography:'tb-phy','Political Science':'tb-lr',Accountancy:'tb-mat','Business Studies':'tb-che','Computer Science':'tb-phy',
  SAT_RW:'tb-eng',SAT_MATH:'tb-mat',ACT_ENG:'tb-eng',ACT_MATH:'tb-mat',ACT_READ:'tb-eng',ACT_SCI:'tb-phy',
  IELTS_LISTEN:'tb-phy',IELTS_READ:'tb-eng',TOEFL_READ:'tb-eng',TOEFL_LISTEN:'tb-phy',
  GRE_VERB:'tb-eng',GRE_QUANT:'tb-mat',GMAT_VERB:'tb-eng',GMAT_QUANT:'tb-mat',GMAT_DI:'tb-phy',
  CAT_VARC:'tb-eng',CAT_DILR:'tb-lr',CAT_QA:'tb-mat',APT_QA:'tb-mat',APT_DILR:'tb-lr',APT_VAR:'tb-eng'
};
const QT = {Physics:'qt-phy',Chemistry:'qt-che',Math:'qt-mat',English:'qt-eng',LR:'qt-lr',Language:'qt-eng',General:'qt-lr',Biology:'qt-che',Economics:'qt-mat',History:'qt-eng',Geography:'qt-phy','Political Science':'qt-lr',Accountancy:'qt-mat','Business Studies':'qt-che','Computer Science':'qt-phy',
  SAT_RW:'qt-eng',SAT_MATH:'qt-mat',ACT_ENG:'qt-eng',ACT_MATH:'qt-mat',ACT_READ:'qt-eng',ACT_SCI:'qt-phy',
  IELTS_LISTEN:'qt-phy',IELTS_READ:'qt-eng',TOEFL_READ:'qt-eng',TOEFL_LISTEN:'qt-phy',
  GRE_VERB:'qt-eng',GRE_QUANT:'qt-mat',GMAT_VERB:'qt-eng',GMAT_QUANT:'qt-mat',GMAT_DI:'qt-phy',
  CAT_VARC:'qt-eng',CAT_DILR:'qt-lr',CAT_QA:'qt-mat',APT_QA:'qt-mat',APT_DILR:'qt-lr',APT_VAR:'qt-eng'
};
const COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4','#ec4899'];

let cfg = {
  exam:'BITSAT',
  subjects:['Physics','Chemistry','Math','English','LR'],
  count:5,
  diff:'adaptive',
  cuet:{ domains:['Physics','Chemistry','Math'], language:'English' }
};
let E = {subList:[],qs:[],ans:{},mks:{},tt:{},rev:{},cur:0,correct:0,wrong:0,score:0,startT:null,tInt:null,tLeft:120,sesNum:0,seed:0,tu:[],easyC:0,medC:0,hardC:0};
let DB_SESSIONS = []; // loaded from Supabase
let DB_USED_TOPICS = {}; // aggregated from DB

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════
function switchAuthTab(t){
  closePasswordReset();
  document.getElementById('authTabLogin')?.classList.toggle('active',t==='login');
  document.getElementById('authTabSignup')?.classList.toggle('active',t==='signup');
  const login=document.getElementById('tab-login');
  const signup=document.getElementById('tab-signup');
  if(login&&signup){
    login.style.display=t==='login'?'block':'none';
    signup.style.display=t==='signup'?'block':'none';
  }
  showAuthErr('');
}
window.switchAuthTab=switchAuthTab;

function landingFocusAuth(mode='login'){
  try{
    switchAuthTab(mode);
    // Make sure the right pane is visible on mobile and focus the first field.
    const panel=document.querySelector('.auth-panel');
    panel?.scrollIntoView({behavior:'smooth',block:'center'});
    const id=mode==='signup'?'su-name':'li-email';
    setTimeout(()=>document.getElementById(id)?.focus(),150);
  }catch(e){
    // no-op
  }
}
window.landingFocusAuth=landingFocusAuth;

function landingStartMock(){
  // If logged in, jump straight to mock config. Otherwise, guide to signup/login.
  if(PROFILE){
    showAuthErr('');
    goToConfig();
    return;
  }
  showAuthErr('Sign in (or create an account) to start your mock test.');
  landingFocusAuth('signup');
}
window.landingStartMock=landingStartMock;

// Animated motivation line rotator (requested: with emoji)
(function(){
  const LINES=[
    "🔥 One more mock today = one less fear on exam day.",
    "🎯 Aim for accuracy first — speed follows with mocks.",
    "⚡ 20 minutes of review beats 2 hours of re-reading.",
    "🧠 Skip smart, save marks — negatives don’t forgive.",
    "📈 Every mock is data: fix 1 weakness, gain 10 marks.",
    "🏆 Rank isn’t luck — it’s repeated practice under timer.",
    "🧪 Strong basics + daily mocks = unstoppable momentum.",
    "⏱️ Train decision-making: attempt what you can finish.",
    "📌 Do a mock, then a micro-review — daily compounding wins.",
    "🤝 Make Rank Gate your best friend in your success journey."
  ];
  function start(){
    const el=document.getElementById('motLine');
    if(!el) return;
    let i=0;
    const swap=()=>{
      i=(i+1)%LINES.length;
      el.classList.remove('mot-fade'); // restart animation
      // Force reflow
      void el.offsetWidth;
      el.textContent=LINES[i];
      el.classList.add('mot-fade');
    };
    // Initial set
    el.textContent=LINES[0];
    el.classList.add('mot-fade');
    setInterval(swap, 3200);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
function selectRole(el){
  if(!el || el.classList.contains('disabled') || el.dataset.role==='admin') return;
  document.querySelectorAll('.role-card').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
}
function showAuthErr(msg){
  const e=document.getElementById('auth-err');
  if(!e) return;
  e.textContent=msg;
  e.classList.toggle('show',!!msg);
}

function openPasswordReset(){
  const box=document.getElementById('pw-reset');
  if(!box) return;
  const li=document.getElementById('li-email')?.value?.trim()||'';
  const pe=document.getElementById('pw-email');
  if(pe && li) pe.value=li;
  box.classList.add('show');
  (pe||document.getElementById('li-email'))?.focus?.();
}
function closePasswordReset(){
  document.getElementById('pw-reset')?.classList.remove('show');
}

async function sendPasswordReset(){
  if(!sb){showAuthErr('Supabase client not initialized. Serve via localhost and ensure the Supabase CDN script loads.');return;}
  const email=(document.getElementById('pw-email')?.value||document.getElementById('li-email')?.value||'').trim();
  if(!email){showAuthErr('Please enter your account email');return;}

  const btn=document.querySelector('#pw-reset .auth-btn');
  const oldTxt=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Sending…';}

  const redirectTo=`${location.origin}${location.pathname}`;
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo});

  if(btn){btn.disabled=false;btn.textContent=oldTxt||'Email reset link →';}

  if(error){
    const msg=String(error.message||'');
    const lower=msg.toLowerCase();
    if(lower.includes('rate limit')||String(error.status||'')==='429'){
      showAuthErr('Email rate limit exceeded. Wait a bit and try again (Supabase Auth).');
      showToast('Password reset email rate limited.','error');
      return;
    }
    showAuthErr(error.message);
    return;
  }

  showAuthErr('');
  showToast('If that email exists, a reset link was sent.','success');
  closePasswordReset();
}

async function doLogin(){
  closePasswordReset();
  if(!sb){showAuthErr('Supabase client not initialized. Serve via localhost and ensure the Supabase CDN script loads.');return;}
  const email=document.getElementById('li-email').value.trim();
  const pass=document.getElementById('li-pass').value;
  if(!email||!pass){showAuthErr('Please fill all fields');return;}
  const btn=document.querySelector('#tab-login .auth-btn');
  btn.disabled=true;btn.textContent='Signing in…';
  const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
  btn.disabled=false;btn.textContent='Sign In →';
  if(error){showAuthErr(error.message);return;}
  if(!data?.session?.user){showAuthErr('Login succeeded but session missing. Please try again.');return;}
  await afterLogin(data.session.user);
}

async function doSignup(){
  closePasswordReset();
  if(!sb){showAuthErr('Supabase client not initialized. Serve via localhost and ensure the Supabase CDN script loads.');return;}
  const name=document.getElementById('su-name').value.trim();
  const email=document.getElementById('su-email').value.trim();
  const pass=document.getElementById('su-pass').value;
  let role=document.querySelector('.role-card.sel')?.dataset.role||'student';
  // Never allow self-signup as admin from the browser UI.
  if(role==='admin') role='student';
  if(!name||!email||!pass){showAuthErr('Please fill all fields');return;}
  if(pass.length<6){showAuthErr('Password must be at least 6 characters');return;}
  const btn=document.querySelector('#tab-signup .auth-btn');
  btn.disabled=true;btn.textContent='Creating account…';
  const {data,error}=await sb.auth.signUp({email,password:pass,options:{data:{full_name:name,role}}});
  btn.disabled=false;btn.textContent='Create Account →';
  if(error){
    const msg=String(error.message||'');
    const code=String(error.status||error.code||'');
    const lower=msg.toLowerCase();
    if(lower.includes('email rate limit')||lower.includes('rate limit exceeded')||code==='429'){
      showAuthErr('Email sending rate limit exceeded (Supabase Auth). Wait a bit and try again, or configure custom SMTP / raise limits in Supabase. Also avoid spamming Sign Up while testing.');
      showToast('Supabase email rate limit hit. This is not your app “table limit” — it’s Auth email throttling.','error');
      return;
    }
    showAuthErr(error.message);
    return;
  }
  // If email confirmations are enabled, Supabase may not return a session here.
  // IMPORTANT: do NOT immediately call signInWithPassword here — it can trigger extra emails
  // (confirm / magic link flows) and hit Auth email rate limits faster during testing.
  if(!data?.session?.user){
    showAuthErr('Account created. Please check your email to confirm, then sign in.');
    return;
  }
  await afterLogin(data.session.user);
}

async function ensureProfileRow(user){
  // Under RLS, reading/writing profiles requires an authenticated session (auth.uid()).
  const {data:existing,error:exErr}=await sb.from('profiles').select('*').eq('id',user.id).maybeSingle();
  if(exErr) throw exErr;
  if(existing) return existing;

  const meta=user.user_metadata||{};
  const full_name=(meta.full_name||meta.fullName||'').trim() || (user.email?user.email.split('@')[0]:'');
  const role=(meta.role||'student');
  const email=(user.email||meta.email||'').trim();
  if(!email) throw new Error('Missing email on user object; cannot create profile row');

  // Create the profile row if trigger didn't run yet or was blocked.
  const {error:insErr}=await sb.from('profiles').insert({id:user.id,email,full_name,role});
  if(insErr){
    const msg=String(insErr.message||'');
    const code=String(insErr.code||'');
    // duplicate key / unique violations
    if(!msg.toLowerCase().includes('duplicate') && code!=='23505'){
      throw insErr;
    }
  }

  const {data:created,error:reErr}=await sb.from('profiles').select('*').eq('id',user.id).maybeSingle();
  if(reErr) throw reErr;
  if(!created) throw new Error('Profile row missing after insert');
  return created;
}

async function afterLogin(user){
  USER=user;
  try{
    PROFILE=await ensureProfileRow(user);
  }catch(e){
    const msg=(e&&typeof e==='object')?(e.message||e.error_description||e.details||JSON.stringify(e)):String(e);
    console.warn('Profile load/create failed:',msg,e);
    showAuthErr('Login succeeded, but profile could not be loaded: '+msg);
    showToast('Profile could not be loaded: '+msg,'error');
    return;
  }
  setupNav();
  await loadUserData();
  await loadRemoteSettings();
  showDash();
}

async function doLogout(){
  if(!sb){USER=null;PROFILE=null;DB_SESSIONS=[];DB_USED_TOPICS={};showScreen('s-auth');return;}
  await sb.auth.signOut();
  USER=null;PROFILE=null;DB_SESSIONS=[];DB_USED_TOPICS={};
  showScreen('s-auth');
}

// ══════════════════════════════════════════════
//  INIT — check existing session
// ══════════════════════════════════════════════
(async()=>{
  if(!sb) return;
  const {data:{session}}=await sb.auth.getSession();
  if(session?.user){
    USER=session.user;
    try{
      PROFILE=await ensureProfileRow(session.user);
    }catch(e){
      console.warn('Profile bootstrap failed:',e?.message||e);
      PROFILE=null;
    }
    setupNav();
    await loadUserData();
    await loadRemoteSettings();
    showDash();
  }
})();

// ══════════════════════════════════════════════
//  DATA LOADING
// ══════════════════════════════════════════════
async function loadUserData(){
  if(!USER||!PROFILE)return;
  if(PROFILE.role==='student'){
    const {data}=await sb.from('test_sessions').select('*').eq('student_id',USER.id).order('created_at',{ascending:false}).limit(50);
    DB_SESSIONS=data||[];
    // Build used topics map
    DB_USED_TOPICS={};
    const ids=DB_SESSIONS.map(s=>s.id).filter(Boolean);
    if(ids.length){
      const {data:qs}=await sb.from('session_questions').select('subject,topic').in('session_id',ids);
      (qs||[]).forEach(q=>{const k=q.subject+':'+q.topic;DB_USED_TOPICS[k]=(DB_USED_TOPICS[k]||0)+1;});
    }
  } else if(PROFILE.role==='parent'){
    // Load linked students' sessions
    const {data:links}=await sb.from('parent_student').select('student_id,profiles!student_id(*)').eq('parent_id',USER.id);
    PROFILE._children=links||[];
  } else if(PROFILE.role==='admin'){
    // Admin: load all students
    const {data:students}=await sb.from('profiles').select('*').eq('role','student').order('created_at',{ascending:false});
    PROFILE._students=students||[];
  }
}

async function loadStudentSessions(studentId){
  const {data}=await sb.from('test_sessions').select('*').eq('student_id',studentId).order('created_at',{ascending:false}).limit(30);
  return data||[];
}

// ══════════════════════════════════════════════
//  NAV SETUP
// ══════════════════════════════════════════════
function setupNav(){
  if(!PROFILE)return;
  const color=PROFILE.avatar_color||COLORS[0];
  const initials=(PROFILE.full_name||PROFILE.email||'?').slice(0,2).toUpperCase();
  document.getElementById('navAvatar').style.background=color;
  document.getElementById('navAvatar').textContent=initials;
  document.getElementById('navName').textContent=PROFILE.full_name||PROFILE.email;
  const rb=document.getElementById('navRoleBadge');
  rb.textContent=PROFILE.role;
  rb.className='nav-role-badge badge-'+PROFILE.role;
  // Exam nav avatar
  document.getElementById('examNavAvatar').style.background=color;
  document.getElementById('examNavAvatar').textContent=initials;
  document.getElementById('examNavName').textContent=PROFILE.full_name||PROFILE.email;
}

// ══════════════════════════════════════════════
//  DASHBOARD RENDER
// ══════════════════════════════════════════════
function showDash(mode='auto'){
  showScreen('s-dashboard');
  syncExamUiAttr();
  if(!PROFILE){
    document.getElementById('dashContent').innerHTML=`
      <div class="dash-wrap">
        <div class="dash-hero">
          <div class="dash-greeting">Profile not found</div>
          <div class="dash-sub">You're signed in, but we couldn't load your <b>profiles</b> row from Supabase (RLS/trigger issue).</div>
        </div>
        <div class="icard" style="max-width:820px;margin:0 auto">
          <div class="ititle">What to check in Supabase</div>
          <div class="ibody">
            - Confirm <b>public.profiles</b> has a row for your user id<br>
            - Confirm RLS policies allow <b>SELECT</b> for <code>auth.uid() = id</code><br>
            - Confirm the <b>on_auth_user_created</b> trigger is installed and firing<br><br>
            Open DevTools → Console for the exact error, or click Sign Out and try again after fixing policies.
          </div>
        </div>
      </div>`;
    return;
  }
  if(PROFILE.role==='student'){
    if(mode==='home'){
      renderStudentDash();
      return;
    }
    // Default: launch mock test panel immediately after login/dashboard entry.
    goToConfig();
    return;
  }
  if(PROFILE.role==='parent') renderParentDash();
  else renderAdminDash();
}

function renderStudentDash(){
  const sessions=DB_SESSIONS;
  const best=sessions.length?Math.max(...sessions.map(s=>s.scaled_390)):0;
  const avg=sessions.length?Math.round(sessions.reduce((a,s)=>a+s.scaled_390,0)/sessions.length):0;
  const total=sessions.length;
  const lastScore=sessions[0]?.scaled_390||0;
  const attemptedSum=sessions.reduce((a,s)=>a+(Number(s.correct)||0)+(Number(s.wrong)||0),0);
  const correctSum=sessions.reduce((a,s)=>a+(Number(s.correct)||0),0);
  const overallAcc=attemptedSum?Math.round(correctSum/attemptedSum*100):0;
  const CUTOFF=375;
  const gapToCutoff=Math.max(0, CUTOFF - Number(lastScore||0));
  const reqAccForCutoff=Math.ceil((CUTOFF/390)*100); // marks-as-percent-of-390 (simple proxy)

  document.getElementById('dashContent').innerHTML=`
    <div class="dash-hero">
      <div class="dash-greeting">Welcome back, ${PROFILE.full_name?.split(' ')[0]||'Student'}! 👋</div>
      <div class="dash-sub">Ready to beat your best score? Target: 350/390</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-n" style="color:var(--amber)">${total}</div><div class="stat-l">Tests Taken</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--green)">${best}</div><div class="stat-l">Best Score /390</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--blue)">${avg}</div><div class="stat-l">Avg Score /390</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--cyan)">${lastScore}</div><div class="stat-l">Last Score</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--purple)" id="stuRankVal">—</div><div class="stat-l">Leaderboard Rank</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--amber)">${overallAcc}%</div><div class="stat-l">Overall Accuracy</div></div>
      <div class="stat-card"><div class="stat-n" style="color:${gapToCutoff===0?'var(--green)':'var(--red)'}">${gapToCutoff===0?'✓':gapToCutoff}</div><div class="stat-l">Gap to Cutoff ${CUTOFF}/390</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--indigo)">${reqAccForCutoff}%</div><div class="stat-l">Accuracy Needed (to reach ${CUTOFF})</div></div>
    </div>

    <div class="mot-card" id="motCard">
      <div class="mot-h">
        <div class="mot-t">Full Mock = Real Rank</div>
        <div class="mot-pill" id="motPill">NEXT LEVEL</div>
      </div>
      <div class="mot-body" id="motBody">
        <span id="dashMotTxt">Loading your next target…</span>
      </div>
      <div class="mot-cta">
        <div>
          <div class="mot-strong" id="motStrong">Aim: 350/390</div>
          <div class="mot-mini" id="motMini">Do a full 130Q mock regularly to build speed + accuracy.</div>
        </div>
        <button class="btn btn-p" onclick="setCnt(document.querySelectorAll('#cntRow .chip')[4],130); showToast('Set to Full 130Q mock ✓','success');">Set 130Q</button>
      </div>
    </div>

    <button class="start-test-btn" onclick="goToConfig()">🚀 Start New Mock Test</button>
    <div class="section-title">📋 Test History</div>
    <div class="history-list" id="histList">
      ${sessions.length===0?'<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-txt">No tests yet — start your first mock!</div></div>':''}
      ${sessions.map(s=>{
        const pct=Math.round((s.scaled_390/390)*100);
        const grade=pct>=90?'Outstanding 🏆':pct>=78?'Excellent ⭐':pct>=65?'Good 👍':pct>=50?'Average 📈':'Keep Going 💪';
        const col=pct>=78?'var(--green)':pct>=50?'var(--amber)':'var(--red)';
        return`<div class="hist-item">
          <div class="hist-score" style="color:${col}">${s.scaled_390}</div>
          <div class="hist-meta">
            <div class="hist-title">Test #${s.session_num} · ${s.q_count}Q · ${s.difficulty}</div>
            <div class="hist-sub">${new Date(s.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} · Acc: ${s.accuracy}% · ${s.subjects?.join(', ')||''}</div>
            <div class="progress-bar" style="margin-top:6px"><div class="progress-fill" style="width:${pct}%;background:${col}"></div></div>
          </div>
          <span class="hist-badge" style="background:rgba(59,130,246,.1);color:var(--blue);border:1px solid rgba(59,130,246,.25)">${grade}</span>
        </div>`;
      }).join('')}
    </div>`;

  // Async enrichments (rank + motivational citation)
  hydrateStudentDashRankAndMotivation();
}

function renderParentDash(){
  const children=PROFILE._children||[];
  document.getElementById('dashContent').innerHTML=`
    <div class="dash-hero">
      <div class="dash-greeting">Parent Dashboard 👨‍👩‍👦</div>
      <div class="dash-sub">Monitor your child's BITSAT preparation progress</div>
    </div>
    <div class="section-title">👦 Linked Students</div>
    ${children.length===0?'<div class="empty-state"><div class="empty-icon">🔗</div><div class="empty-txt">No students linked yet</div></div>':''}
    <div id="childrenList">
    ${children.map(l=>{
      const p=l.profiles;
      const col=p.avatar_color||COLORS[0];
      const init=(p.full_name||p.email||'?').slice(0,2).toUpperCase();
      return`<div class="student-card" onclick="viewStudentProgress('${p.id}','${p.full_name||p.email}')">
        <div class="s-avatar" style="background:${col}">${init}</div>
        <div class="s-info"><div class="s-name">${p.full_name||p.email}</div><div class="s-meta">Student · Click to view progress</div></div>
        <div style="font-size:20px">→</div>
      </div>`;
    }).join('')}
    </div>
    <div class="link-form">
      <div class="cfg-label">Link a Student by Email</div>
      <div class="link-inp-row">
        <input class="inp" id="linkEmail" type="email" placeholder="student@example.com" style="flex:1">
        <button class="btn btn-p" onclick="linkStudent()">Link</button>
      </div>
    </div>`;
}

function getMotivationPayload(){
  const sessions=DB_SESSIONS||[];
  const total=sessions.length;
  const last=sessions[0]?.scaled_390||0;
  const best=total?Math.max(...sessions.map(s=>Number(s.scaled_390)||0)):0;
  const goal=350;
  const gap=Math.max(0,goal-last);
  const streakHint=total>=3 && last>=(sessions[1]?.scaled_390||0) && (sessions[1]?.scaled_390||0)>=(sessions[2]?.scaled_390||0);
  const ex=String(cfg?.exam||'BITSAT');
  const exName=String(examRules()?.name||ex);

  const pool=[
    {pill:'CONSISTENCY', title:'Mocks build momentum', body:`Consistency beats intensity. Do <b>regular mocks</b> for ${escapeHtml(exName)} and review mistakes the same day.`},
    {pill:'SPEED MODE', title:'Train time discipline', body:`Timed practice improves selection: attempt what you can solve, skip what you can’t, and protect your score.`},
    {pill:'ACCURACY', title:'Protect net score', body:`Wrong answers reduce rank. Use a <b>confidence rule</b>: attempt only when you’re sure enough.`},
    {pill:'RANK BOOST', title:'Review = rank growth', body:`Your rank improves most in review. Note 3 weak topics and re-test them in the next mock.`},
  ];
  const idx=(total*7 + last*3 + best) % pool.length;
  const pick=pool[idx];

  let strong=`Aim: ${goal}/390`;
  if(gap===0) strong=`Above target! Push for 360+`;
  else if(gap<=25) strong=`Close: only ${gap} marks to 350`;
  else strong=`Gap to 350: ${gap} marks`;

  const mini=streakHint
    ? `You’re trending up. Convert momentum into rank: schedule your next <b>full mock</b> today.`
    : `Make it a habit: 1 full mock + 30 min review. That’s how top ranks are built.`;

  // Changing citation after each test (based on test count + last score)
  const cite=[
    `“Full mocks don’t test you — they <b>build you</b>.”`,
    `“Rank is earned in the <b>review</b>, not the attempt.”`,
    `“Speed comes from <b>patterns</b>. Patterns come from full mocks.”`,
    `“Every full mock reduces exam-day fear by <b>10%</b>.”`,
    `“Accuracy first, then speed. Full mocks train <b>both</b>.”`,
  ];
  const citeIdx=(total + Math.floor(last/10)) % cite.length;

  return {pill:pick.pill,title:pick.title,body:pick.body,strong,mini,citation:cite[citeIdx]};
}

async function hydrateStudentDashRankAndMotivation(){
  // Motivation block
  try{
    const p=getMotivationPayload();
    const pill=document.getElementById('motPill');
    const body=document.getElementById('motBody');
    const dashLine=document.getElementById('dashMotTxt');
    const strong=document.getElementById('motStrong');
    const mini=document.getElementById('motMini');
    if(pill) pill.textContent=p.pill;
    if(body && !dashLine) body.innerHTML=`${p.citation}<br><br>${p.body}`;
    if(strong) strong.textContent=p.strong;
    if(mini) mini.innerHTML=p.mini;

    // Dashboard rotator (8–10 lines). Starts at index derived from tests & last score.
    if(dashLine){
      const sessions=DB_SESSIONS||[];
      const n=sessions.length;
      const last=Number(sessions?.[0]?.scaled_390)||0;
      const ex=String(cfg?.exam||'BITSAT');
      const exName=String(examRules()?.name||ex);
      const poolByExam={
        BITSAT:[
          `🔥 Next mock = next upgrade. Start now and stay ahead.`,
          `⚡ Speed is trained, not gifted. Mock again and beat the clock.`,
          `🧠 Every mistake is a teacher. Mock → Review → Repeat.`,
          `💪 Protect your marks: skip smart, attempt strong, rank higher.`,
          `🔁 Take a mock, then fix 3 weak topics. That’s how toppers grow.`,
        ],
        JEE_MAIN:[
          `🎯 JEE Main: accuracy first, then speed. Keep negatives low.`,
          `🧩 Fix weak chapters: 1 topic → 1 mock → 1 review loop.`,
          `⚡ Timed PCM practice builds exam temperament.`,
          `📈 Track errors: calculation vs concept vs silly mistakes.`,
          `🔁 Mock → analysis → improvement → next mock.`,
        ],
        CUET:[
          `🧠 CUET: balance domains + language + aptitude consistently.`,
          `📚 Daily practice beats cramming. Improve weekly with review.`,
          `⚡ Accuracy matters: protect score with smart attempts.`,
          `🔁 Short tests + review = fastest improvement.`,
        ],
        SAT:[
          `📚 SAT: master RW grammar + transitions and keep Math steps clean.`,
          `⏱️ Time-box questions: move on fast, return if needed.`,
          `🔁 Section practice → review errors → repeat.`,
        ],
        ACT:[
          `⏱️ ACT: pace is everything. Build rhythm across sections.`,
          `📈 Review wrong answers and the “almost right” ones too.`,
          `🔁 Timed sets daily = confidence on test day.`,
        ],
        IELTS:[
          `🎧 IELTS: focus on accuracy in Listening + Reading practice.`,
          `📝 Note traps: distractors, paraphrases, and keyword mismatch.`,
          `🔁 Practice → check → learn the pattern → repeat.`,
        ],
        TOEFL:[
          `🎧 TOEFL: practice Reading + Listening with strict timing.`,
          `📚 Improve inference + detail questions by reviewing why wrong.`,
          `🔁 Consistent practice builds score stability.`,
        ],
        GRE:[
          `📊 GRE: strengthen Verbal precision and Quant consistency.`,
          `🧠 Review is everything: why was the wrong option tempting?`,
          `🔁 Targeted sets daily outperform random practice.`,
        ],
        GMAT:[
          `📉 GMAT Focus: DI rewards calm decisions under time.`,
          `🧠 Review wrong choices: pattern > memorization.`,
          `🔁 Timed practice + analysis = better score.`,
        ],
        CAT:[
          `🔥 CAT: DILR wins percentiles when you select the right sets.`,
          `📚 VARC improves with consistent RC + review.`,
          `🔁 Accuracy under time = percentile growth.`,
        ],
        IPMAT:[
          `🎓 IPMAT: build speed in QA and stay calm in DILR.`,
          `📚 Verbal accuracy compounds fast with daily practice.`,
          `🔁 Timed sets + review = stable improvement.`,
        ],
        JIPMAT:[
          `🎓 JIPMAT: practice daily and reduce negatives.`,
          `📈 Track mistakes: concept vs speed vs attention.`,
          `🔁 Repeat weak areas until they become strengths.`,
        ],
        GATE_2027:[
          `🧩 GATE: reduce negatives by skipping low-confidence MCQs.`,
          `📊 NAT needs careful calculation — check rounding carefully.`,
          `🔁 Timed practice across GA/Math/Core builds stability.`,
        ]
      };
      const pool=(poolByExam[ex]||[
        `🔥 Next mock = next upgrade. Start now and stay ahead.`,
        `⚡ Timed practice + review is the fastest path to improvement.`,
        `🧠 Every mistake is a teacher. Mock → Review → Repeat.`,
        `📈 Consistency beats talent. Take another mock right now.`,
        `🔁 ${escapeHtml(exName)}: practice today, improve tomorrow.`,
      ]);
      let idx=(n + Math.floor(last/10)) % pool.length;
      if(window.__dashMotInt) clearInterval(window.__dashMotInt);

      const setLine=()=>{
        dashLine.innerHTML=pool[idx];
        dashLine.classList.remove('mot-anim');
        void dashLine.offsetWidth;
        dashLine.classList.add('mot-anim');
      };
      setLine();
      window.__dashMotInt=setInterval(()=>{
        const scr=document.getElementById('s-dashboard');
        if(!scr || !scr.classList.contains('active')) return;
        idx=(idx+1)%pool.length;
        setLine();
      }, 4200);
    }
  }catch(_e){}

  // Rank block (best score per student).
  // NOTE: Under common RLS setups, students can only read their own `test_sessions`,
  // which makes any client-side "global leaderboard" incorrectly show everyone as #1.
  // We therefore:
  // 1) Prefer a server-side RPC/view (if present) that can compute global rank safely.
  // 2) Fall back to client-side only when we can actually see multiple students.
  try{
    const el=document.getElementById('stuRankVal');
    if(!el) return;
    if(!sb||!USER){el.textContent='—';return;}
    el.textContent='…';

    // 1) Preferred: RPC that returns { rank } or a scalar.
    // Create this in SQL as SECURITY DEFINER if you want ranks under strict RLS.
    // Example names we try: get_leaderboard_rank, leaderboard_my_rank.
    try{
      const r1=await sb.rpc('get_leaderboard_rank',{ student_id: USER.id, exam_id: String(cfg?.exam||'BITSAT') });
      if(!r1?.error && r1?.data!==null && r1?.data!==undefined){
        const rank=Number(typeof r1.data==='object' ? (r1.data.rank ?? r1.data[0]?.rank) : r1.data);
        if(Number.isFinite(rank) && rank>0){ el.textContent='#'+rank; el.title=''; return; }
      }
    }catch(_e){}
    try{
      const r2=await sb.rpc('leaderboard_my_rank',{});
      if(!r2?.error && r2?.data!==null && r2?.data!==undefined){
        const rank=Number(typeof r2.data==='object' ? (r2.data.rank ?? r2.data[0]?.rank) : r2.data);
        if(Number.isFinite(rank) && rank>0){ el.textContent='#'+rank; el.title=''; return; }
      }
    }catch(_e){}

    // 2) Fallback: fetch sessions; compute best per student; rank by best desc.
    const {data, error}=await sb.from('test_sessions')
      .select('student_id,scaled_390,created_at')
      .order('scaled_390',{ascending:false})
      .limit(5000);
    if(error){el.textContent='—'; el.title='Leaderboard rank unavailable (permission error).'; return;}

    const ex=String(cfg?.exam||'BITSAT');
    const filtered=(data||[]).filter(r=>String(r?.exam||'BITSAT')===ex);
    const bestBy={};
    filtered.forEach(r=>{
      const sid=r.student_id;
      const sc=Number(r.scaled_390)||0;
      if(!sid) return;
      if(bestBy[sid]===undefined || sc>bestBy[sid]) bestBy[sid]=sc;
    });
    const visibleStudents=Object.keys(bestBy).length;
    if(visibleStudents<2){
      el.textContent='—';
      el.title='Leaderboard rank is hidden because your account can only read its own sessions (RLS). Enable a leaderboard view/RPC to show global rank.';
      return;
    }
    const arr=Object.entries(bestBy).map(([sid,sc])=>({sid,sc})).sort((a,b)=>b.sc-a.sc);
    const idx=arr.findIndex(x=>x.sid===USER.id);
    if(idx===-1){el.textContent='—';return;}
    el.textContent='#'+(idx+1);
    el.title='';
  }catch(_e){
    const el=document.getElementById('stuRankVal');
    if(el && el.textContent==='…') el.textContent='—';
  }
}

function adminSetLeaderboardExam(ex){
  if(!window.__ADMIN) window.__ADMIN={};
  window.__ADMIN.leaderExam=String(ex||'BITSAT');
  // Re-render leaderboard only (sessions already loaded by reports window)
  const panel=document.getElementById('adminPanel');
  if(panel) panel.innerHTML=adminRenderLeaderboard();
}
window.adminSetLeaderboardExam=adminSetLeaderboardExam;

async function linkStudent(){
  const email=document.getElementById('linkEmail').value.trim();
  if(!email){showToast('Enter student email','error');return;}
  const {data:student}=await sb.from('profiles').select('id,full_name').eq('email',email).eq('role','student').single();
  if(!student){showToast('Student not found','error');return;}
  const {error}=await sb.from('parent_student').insert({parent_id:USER.id,student_id:student.id});
  if(error){showToast(error.message,'error');return;}
  showToast(`Linked ${student.full_name||email} successfully!`,'success');
  await loadUserData();
  renderParentDash();
}

async function viewStudentProgress(studentId,name){
  const sessions=await loadStudentSessions(studentId);
  const best=sessions.length?Math.max(...sessions.map(s=>s.scaled_390)):0;
  const avg=sessions.length?Math.round(sessions.reduce((a,s)=>a+s.scaled_390,0)/sessions.length):0;
  document.getElementById('dashContent').innerHTML=`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:1.5rem">
      <button class="rbtn-sec" onclick="showDash('home')" style="padding:8px 16px;font-size:13px">← Back</button>
      <div class="section-title" style="margin:0">📊 ${name}'s Progress</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-n" style="color:var(--amber)">${sessions.length}</div><div class="stat-l">Tests</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--green)">${best}</div><div class="stat-l">Best /390</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--blue)">${avg}</div><div class="stat-l">Average</div></div>
    </div>
    <div class="history-list">
    ${sessions.length===0?'<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-txt">No tests taken yet</div></div>':''}
    ${sessions.map(s=>{
      const pct=Math.round((s.scaled_390/390)*100);
      const col=pct>=78?'var(--green)':pct>=50?'var(--amber)':'var(--red)';
      return`<div class="hist-item">
        <div class="hist-score" style="color:${col}">${s.scaled_390}</div>
        <div class="hist-meta">
          <div class="hist-title">Test #${s.session_num} · ${s.q_count}Q · ${s.difficulty}</div>
          <div class="hist-sub">${new Date(s.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} · Acc: ${s.accuracy}% · C:${s.correct} W:${s.wrong} S:${s.skipped}</div>
          <div class="progress-bar" style="margin-top:6px"><div class="progress-fill" style="width:${pct}%;background:${col}"></div></div>
        </div>
      </div>`;
    }).join('')}
    </div>`;
}

function renderAdminDash(){
  if(!sb){document.getElementById('dashContent').innerHTML=`<div class="icard">Supabase not initialized.</div>`;return;}
  if(!window.__ADMIN) window.__ADMIN={view:'users',days:30,loading:false,users:[],sessions:[],profilesById:{},stats:null};

  const v=window.__ADMIN.view||'users';
  document.getElementById('dashContent').innerHTML=`
    <div class="dash-hero">
      <div class="dash-greeting">Admin Console ⚙️</div>
      <div class="dash-sub">Users · Mock tests · Leaderboards</div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button class="ntab ${v==='users'?'active':''}" onclick="adminGo('users')">👥 Registered Users</button>
      <button class="ntab ${v==='reports'?'active':''}" onclick="adminGo('reports')">🧾 Mock Test Reports</button>
      <button class="ntab ${v==='leaderboard'?'active':''}" onclick="adminGo('leaderboard')">🏆 Leaderboard</button>
      <button class="ntab ${v==='settings'?'active':''}" onclick="adminGo('settings')">⚙️ Settings</button>
      <button class="ntab ${v==='review'?'active':''}" onclick="adminGo('review')">✋ Human review</button>
      <button class="ntab" onclick="window.open('admin.html','_self')" style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.22);color:var(--blue)">⚙️ Full Admin ↗</button>
      <button class="ntab" onclick="window.open('bank.html','_self')" style="background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.22);color:var(--cyan)">🗃️ Question Bank ↗</button>
    </div>

    <div id="adminPanel">
      <div class="icard"><div class="spin" style="margin:auto"></div><div style="margin-top:10px;color:var(--t2);font-size:12px;text-align:center">Loading…</div></div>
    </div>
  `;

  adminLoadAndRender(v);
}

function adminGo(view){
  if(!window.__ADMIN) window.__ADMIN={};
  window.__ADMIN.view=view;
  renderAdminDash();
}

function fmtDateIN(d){
  try{return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}catch(_e){return String(d||'');}
}
function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/** Stacked numerator/denominator (vinculum) for Indian mock style; num/den must already be HTML-safe. */
function stackedFracHtml(numHtml, denHtml, ariaPlain){
  const a=String(ariaPlain||`${numHtml} over ${denHtml}`).replace(/"/g,'');
  return `<span class="stack-frac" role="img" aria-label="${escapeHtml(a)}"><span class="sf-num">${numHtml}</span><span class="sf-bar"></span><span class="sf-den">${denHtml}</span></span>`;
}
/** Replace Unicode sup/sub digit runs with HTML so ²³⁸ uses one font size (avoids U+00B2/U+00B3 vs U+2078 mismatch). */
function unifyScriptDigitMarksToHtml(str){
  const supMap=new Map([
    ['⁰','0'],['¹','1'],['²','2'],['³','3'],['⁴','4'],['⁵','5'],['⁶','6'],['⁷','7'],['⁸','8'],['⁹','9'],
    ['\u00b9','1'],['\u00b2','2'],['\u00b3','3'],
  ]);
  const subMap=new Map([
    ['₀','0'],['₁','1'],['₂','2'],['₃','3'],['₄','4'],['₅','5'],['₆','6'],['₇','7'],['₈','8'],['₉','9'],
  ]);
  const S=String(str||'');
  let out='', i=0;
  while(i<S.length){
    if(S[i]==='<'){
      const j=S.indexOf('>',i);
      if(j<0){ out+=S.slice(i); break; }
      out+=S.slice(i,j+1);
      i=j+1;
      continue;
    }
    let d='';
    while(i<S.length&&supMap.has(S[i])) d+=supMap.get(S[i++]);
    if(d){ out+=`<sup class="exam-digit-sup">${d}</sup>`; continue; }
    d='';
    while(i<S.length&&subMap.has(S[i])) d+=subMap.get(S[i++]);
    if(d){ out+=`<sub class="exam-digit-sub">${d}</sub>`; continue; }
    out+=S[i++];
  }
  return out;
}
/** Escape text, then turn numeric / algebraic divisions into stacked fractions (Indian exams). Preserves SI "per" (m/s, etc.). */
function formatIndianStackedFractions(raw){
  const holes=[];
  let hi=0;
  const hole=(m)=>{ const id=`\uE000${hi++}\uE001`; holes.push([id,m]); return id; };
  let s=String(raw??'');
  const unitSlash=/\b(?:m|cm|mm|km|μm|nm|μs|ms|ns|min|h|kg|g|mg|μg|N|J|W|kW|V|mV|A|mA|C|F|H|Ω|Pa|kPa|MPa|bar|atm|T|mol|Hz|rad|eV|mL)\s*\/\s*(?:m|s|mol|K|A|V|J|N|kg|g|mol|L|l|dm|min|h|Hz|Pa|W|C|m²|m2|m³|m3|s²|s2|min|h)\b/gi;
  s=s.replace(/\bhttps?:\/\/\S+/gi,hole);
  s=s.replace(/\[[^\]\n]{0,40}\]\s*\/\s*\[[^\]\n]{0,40}\]/g,hole);
  s=s.replace(/[A-Za-z0-9αβγδθλμπσφωΔΩ₀-₉²³⁺⁻]+(?:\([^)]*\))?\s*\/\s*H(?:⁺|\+|₂|2)?/gi,hole);
  s=s.replace(unitSlash,hole);
  s=escapeHtml(s);
  const stack=(a,b)=>stackedFracHtml(a,b,`${a} over ${b}`);
  const supFromDigits=d=>{
    const M={0:'⁰',1:'¹',2:'²',3:'³',4:'⁴',5:'⁵',6:'⁶',7:'⁷',8:'⁸',9:'⁹'};
    return String(d).split('').map(c=>M[c]??'').join('');
  };
  // Caret powers missed elsewhere (e.g. x^2/16): avoid sin^2 matching n^2 via (?<![A-Za-z0-9]).
  s=s.replace(/(?<![A-Za-z0-9])([A-Za-z])\^(\d+)\b/g,(m,a,d)=>{
    const sup=supFromDigits(d);
    return sup?a+sup:m;
  });
  // Letter + Unicode superscript(s) over a number (hyperbola x²/16 — no space before /).
  s=s.replace(/\b([A-Za-z])([²³⁰¹⁴⁵⁶⁷⁸⁹\u00b9\u00b2\u00b3]+)\s*\/\s*(\d+(?:\.\d+)?)\b/g,(m,a,sup,den)=>stack(a+sup,den));
  const GR='πθαβφωλμσΔΣΩ';
  for(let pass=0;pass<6;pass++){
    s=s.replace(/(\d+(?:\.\d+)?)\s*÷\s*(\d+(?:\.\d+)?)/g,(_,a,b)=>stack(a,b));
    s=s.replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g,(_,a,b)=>stack(a,b));
  }
  for(let pass=0;pass<3;pass++){
    s=s.replace(/\(([^()]{1,40})\)\s*÷\s*\(([^()]{1,40})\)/g,(_,a,b)=>stack(`(${a})`,`(${b})`));
    s=s.replace(/\(([^()]{1,40})\)\s*\/\s*\(([^()]{1,40})\)/g,(_,a,b)=>stack(`(${a})`,`(${b})`));
  }
  s=s.replace(new RegExp(`([${GR}])\\s*÷\\s*(\\d+(?:\\.\\d+)?)`,'g'),(_,a,b)=>stack(a,b));
  s=s.replace(new RegExp(`([${GR}])\\s*\\/\\s*(\\d+(?:\\.\\d+)?)`,'g'),(_,a,b)=>stack(a,b));
  s=s.replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*÷\\s*([${GR}])`,'g'),(_,a,b)=>stack(a,b));
  s=s.replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*\\/\\s*([${GR}])`,'g'),(_,a,b)=>stack(a,b));
  s=s.replace(/\b([A-Za-z])\s*÷\s*(\d+(?:\.\d+)?)\b/g,(_,a,b)=>stack(a,b));
  s=s.replace(/\b([A-Za-z])\s*\/\s*(\d+(?:\.\d+)?)\b/g,(_,a,b)=>stack(a,b));
  s=s.replace(/\b(\d+(?:\.\d+)?)\s*÷\s*([A-Za-z])\b/g,(_,a,b)=>stack(a,b));
  s=s.replace(/\b(\d+(?:\.\d+)?)\s*\/\s*([A-Za-z])\b/g,(_,a,b)=>stack(a,b));
  s=s.replace(/\b([A-Za-z])\s*÷\s*([A-Za-z])\b/g,(_,a,b)=>stack(a,b));
  s=s.replace(/\b([A-Za-z])\s*\/\s*([A-Za-z])\b/g,(_,a,b)=>stack(a,b));
  s=s.replace(/½/g,stack('1','2'));
  s=s.replace(/¼/g,stack('1','4'));
  s=s.replace(/¾/g,stack('3','4'));
  s=s.replace(/⅓/g,stack('1','3'));
  s=s.replace(/⅔/g,stack('2','3'));
  for(let i=holes.length-1;i>=0;i--){
    const [id,m]=holes[i];
    s=s.split(id).join(escapeHtml(m));
  }
  return unifyScriptDigitMarksToHtml(s);
}
function examRichTextHtml(plain){
  const raw=String(plain??'');
  const ex=String((typeof E!=='undefined'&&E&&E.exam)||(typeof cfg!=='undefined'&&cfg&&cfg.exam)||'BITSAT');
  if(!isIndianExamId(ex)) return unifyScriptDigitMarksToHtml(escapeHtml(raw));
  return formatIndianStackedFractions(raw);
}
function jsQuote(s){
  // Safe single-quoted JS string literal for inline onclick usage
  return String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r/g,'\\r').replace(/\n/g,'\\n');
}
function shortenId(id){
  const s=String(id||'').trim();
  if(s.length<=12) return s||'—';
  return s.slice(0,6)+'…'+s.slice(-4);
}
function displayName(pOrStr){
  if(!pOrStr) return '—';
  if(typeof pOrStr === 'string') return shortenId(pOrStr);
  const full=String(pOrStr.full_name||'').trim();
  if(full) return full;
  const email=String(pOrStr.email||'').trim();
  if(email && email.includes('@')) return email.split('@')[0];
  if(email) return email;
  return shortenId(pOrStr.id);
}

async function adminLoadAndRender(view){
  const panel=document.getElementById('adminPanel');
  if(!panel) return;

  try{
    if(view==='users'){
      await adminLoadUsers();
      panel.innerHTML=adminRenderUsers();
      return;
    }
    if(view==='reports'){
      await adminLoadReports();
      panel.innerHTML=adminRenderReports();
      return;
    }
    if(view==='leaderboard'){
      await adminLoadReports(); // sessions + profile map reused
      panel.innerHTML=adminRenderLeaderboard();
      return;
    }
    if(view==='settings'){
      panel.innerHTML=adminRenderSettings();
      return;
    }
    if(view==='review'){
      await adminLoadReviewQueue();
      panel.innerHTML=adminRenderReviewQueue();
      return;
    }
    panel.innerHTML=`<div class="icard">Unknown admin view.</div>`;
  }catch(e){
    const msg=(e&&typeof e==='object')?(e.message||e.details||JSON.stringify(e)):String(e);
    panel.innerHTML=`<div class="icard"><div class="ititle">Admin load failed</div><div class="ibody" style="color:var(--red)">${escapeHtml(msg)}</div></div>`;
  }
}

function adminRenderSettings(){
  const s=APP_SETTINGS||DEFAULT_SETTINGS;
  const ar=Math.round(Math.max(0,Math.min(1,Number(s?.gen_ratio?.api ?? 0.9)))*100);
  const br=100-ar;
  const aKey=String(s?.api_keys?.anthropic||'');
  const oKey=String(s?.api_keys?.openai||'');
  const bitsatTrain=String(s?.prompt_training?.bitsat||'');
  return `
    <div class="icard">
      <div class="ititle">⚙️ App Settings (Admin)</div>
      <div class="ibody" style="margin-bottom:12px">
        Manage API keys and generation routing. These settings are stored in <code>localStorage</code> and (if table exists + RLS allows) synced to <code>app_settings</code> in Supabase.
      </div>
      <div class="icard" style="background:var(--s2);border:1px solid var(--b1);padding:12px;margin-bottom:12px">
        <div class="ititle" style="font-size:12px">Server proxy mode (recommended)</div>
        <div class="ibody" style="color:var(--t2)">If deployed on Netlify with <code>/.netlify/functions/generate-question</code> configured, you can keep keys on the server and disable client-side keys.</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px">
          <button class="btn ${APP_SETTINGS?.api_proxy?.enabled?'btn-p':''}" onclick="adminToggleProxy()">${APP_SETTINGS?.api_proxy?.enabled?'Proxy enabled':'Enable proxy'}</button>
          <div class="ibody" style="font-size:11px;color:var(--t3)">When enabled, generation uses the Netlify Function first.</div>
        </div>
      </div>
      <div class="inp-wrap">
        <label class="inp-label">Anthropic API Key</label>
        <input class="inp" id="setAnthropicKey" placeholder="sk-ant-..." value="${escapeHtml(aKey)}">
      </div>
      <div class="inp-wrap">
        <label class="inp-label">OpenAI API Key</label>
        <input class="inp" id="setOpenAIKey" placeholder="sk-..." value="${escapeHtml(oKey)}">
      </div>
      <div class="inp-wrap">
        <label class="inp-label">BITSAT pattern trainer (prompt)</label>
        <div class="ibody" style="color:var(--t2);margin-top:-2px">
          This text is appended to the generator prompt only for <b>BITSAT</b>. Use it to enforce the exact exam-style patterns you want (symbols, wording, step length, trap options, etc.).
        </div>
        <textarea class="inp" id="setBitsatTrainer" rows="6" placeholder="Example: Use BITSAT-style short stems, 4 options, avoid LaTeX, use sin⁻¹, ×10⁻³, units, etc.">${escapeHtml(bitsatTrain)}</textarea>
      </div>
      <div class="inp-wrap">
        <label class="inp-label">Question source ratio (API vs Question Bank)</label>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <input type="range" min="0" max="100" value="${ar}" oninput="adminUpdateRatioLive(this.value)" style="flex:1;min-width:240px" disabled>
          <div style="font-family:var(--mono);font-size:12px;color:var(--t2)">
            API: <b id="ratioApiLbl">${ar}%</b> · Bank: <b id="ratioBankLbl">${br}%</b>
          </div>
        </div>
      </div>
      <div class="ibody" style="margin-top:-6px;color:var(--t3)">
        Routing is locked to <b>100% API</b> (Question Bank disabled) to prevent repeated questions.
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px">
        <button class="btn" onclick="adminResetSettings()">Reset</button>
        <button class="btn btn-p" onclick="adminSaveSettings()">Save</button>
      </div>
      <div class="ibody" style="margin-top:12px;color:var(--amber)">
        Security note: placing provider keys in a browser app exposes them to anyone who can load the page. For production, move API calls to a server.
      </div>
    </div>
  `;
}

function adminUpdateRatioLive(v){
  const apiPct=Math.max(0,Math.min(100,Number(v)||0));
  const bankPct=100-apiPct;
  const a=document.getElementById('ratioApiLbl');
  const b=document.getElementById('ratioBankLbl');
  if(a) a.textContent=apiPct+'%';
  if(b) b.textContent=bankPct+'%';
  if(!APP_SETTINGS.gen_ratio) APP_SETTINGS.gen_ratio={api:0.9,bank:0.1};
  APP_SETTINGS.gen_ratio.api=apiPct/100;
  APP_SETTINGS.gen_ratio.bank=bankPct/100;
}
function adminResetSettings(){
  APP_SETTINGS=mergeSettings(DEFAULT_SETTINGS,{});
  saveLocalSettings();
  renderAdminDash();
}

function adminToggleProxy(){
  if(!APP_SETTINGS.api_proxy) APP_SETTINGS.api_proxy={enabled:false,base_url:''};
  APP_SETTINGS.api_proxy.enabled=!APP_SETTINGS.api_proxy.enabled;
  saveLocalSettings();
  renderAdminDash();
}
async function adminSaveSettings(){
  const a=String(document.getElementById('setAnthropicKey')?.value||'').trim();
  const o=String(document.getElementById('setOpenAIKey')?.value||'').trim();
  const bt=String(document.getElementById('setBitsatTrainer')?.value||'').trim();
  if(!APP_SETTINGS.api_keys) APP_SETTINGS.api_keys={anthropic:'',openai:''};
  APP_SETTINGS.api_keys.anthropic=a;
  APP_SETTINGS.api_keys.openai=o;
  if(!APP_SETTINGS.prompt_training) APP_SETTINGS.prompt_training={bitsat:''};
  // Keep it bounded so we don't accidentally blow up prompt size.
  APP_SETTINGS.prompt_training.bitsat=bt.slice(0, 2200);
  saveLocalSettings();
  const r=await saveRemoteSettingsIfAdmin();
  if(r.ok) showToast('Settings saved ✓','success');
  else{
    const msg=String(r?.error?.message||r?.error?.details||'').trim();
    showToast(msg?`Saved locally. Remote save failed: ${msg}`:'Saved locally. Remote save failed (table/RLS?)','error');
  }
}

async function adminLoadUsers(){
  const st=window.__ADMIN;
  if(st.loading) return;
  st.loading=true;
  try{
    // Accurate counts (not impacted by the "latest 500" list)
    const [t,stu,par,adm]=await Promise.all([
      sb.from('profiles').select('id',{count:'exact',head:true}),
      sb.from('profiles').select('id',{count:'exact',head:true}).eq('role','student'),
      sb.from('profiles').select('id',{count:'exact',head:true}).eq('role','parent'),
      sb.from('profiles').select('id',{count:'exact',head:true}).eq('role','admin'),
    ]);
    if(t.error) throw t.error;
    if(stu.error) throw stu.error;
    if(par.error) throw par.error;
    if(adm.error) throw adm.error;
    st.stats={
      total: Number(t.count)||0,
      students: Number(stu.count)||0,
      parents: Number(par.count)||0,
      admins: Number(adm.count)||0
    };

    // Latest users list for browsing
    const {data, error}=await sb.from('profiles')
      .select('id,email,full_name,role,created_at,avatar_color')
      .order('created_at',{ascending:false})
      .limit(500);
    if(error) throw error;
    st.users=data||[];
  }finally{
    st.loading=false;
  }
}

async function adminLoadReports(){
  const st=window.__ADMIN;
  if(st.loading) return;
  st.loading=true;
  try{
    const days=Math.max(1,Math.min(365,Number(st.days)||30));
    st.days=days;
    const since=new Date(Date.now()-days*24*60*60*1000).toISOString();

    // Pull a reasonably large window; for scale, replace with server-side view/RPC later.
    // Prefer SQL-style join via PostgREST embedding if FK exists: test_sessions.student_id -> profiles.id
    // Falls back to non-join flow if embedding isn't available.
    let sessions=null, sErr=null;

    async function tryJoined(selectStr){
      const r=await sb.from('test_sessions')
        .select(selectStr)
        .gte('created_at', since)
        .order('created_at',{ascending:false})
        .limit(2000);
      if(r.error) return {ok:false, data:null};
      const rows=r.data||[];
      // Consider it "joined" only if at least one row has embedded profile.
      const hasEmbed=rows.some(x=>x && x.profiles && typeof x.profiles==='object');
      return {ok:hasEmbed, data:rows};
    }

    // Join variants (PostgREST embedding depends on relationship naming / FK exposure).
    // 1) default relationship name
    let joined=await tryJoined('*, profiles(full_name,email,avatar_color,role,created_at)');
    // 2) force inner join semantics
    if(!joined.ok) joined=await tryJoined('*, profiles!inner(full_name,email,avatar_color,role,created_at)');
    // 3) common FK constraint name used by Postgres
    if(!joined.ok) joined=await tryJoined('*, profiles:profiles!test_sessions_student_id_fkey(full_name,email,avatar_color,role,created_at)');

    if(joined.ok){
      sessions=joined.data||[];
    }else{
      // Fallback: no relationship/permission for embed
      const plain=await sb.from('test_sessions')
        .select('*')
        .gte('created_at', since)
        .order('created_at',{ascending:false})
        .limit(2000);
      sessions=plain.data||[];
      sErr=plain.error||null;
    }
    if(sErr) throw sErr;
    st.sessions=sessions||[];
    // Best-effort name map from sessions table (helps if profiles are not readable by RLS).
    st.namesByStudentId={};
    st.emailsByStudentId={};
    st.sessions.forEach(s=>{
      const sid=s.student_id;
      if(!sid) return;
      const sn=String(s.student_name||'').trim();
      const se=String(s.student_email||'').trim();
      if(sn) st.namesByStudentId[sid]=sn;
      if(se) st.emailsByStudentId[sid]=se;
    });

    const ids=[...new Set(st.sessions.map(s=>s.student_id).filter(Boolean))];
    st.profilesById={};
    st.profileReadBlocked=false;

    // If join embedding worked, hydrate profilesById from embedded profiles immediately.
    st.sessions.forEach(s=>{
      const sid=s.student_id;
      const p=s?.profiles;
      if(!sid||!p||typeof p!=='object') return;
      st.profilesById[sid]={id:sid,...p};
    });

    if(ids.length){
      // Fetch missing profiles only (keeps this efficient when embed works)
      const missing=ids.filter(id=>!st.profilesById[id]);
      if(missing.length){
        const {data:profs, error:pErr}=await sb.from('profiles')
          .select('id,email,full_name,role,avatar_color,created_at')
          .in('id', missing)
          .limit(2000);
        if(pErr){
          // Most common reason: RLS blocks admin from selecting other users' profiles.
          // Keep the app working via denormalized names (test_sessions.student_name) / id shortening.
          st.profileReadBlocked=true;
        }else{
          (profs||[]).forEach(p=>{st.profilesById[p.id]=p;});
        }
      }
    }

    // Question-level stats for subject/topic analytics
    st.qRows=[];
    const sessIds=[...new Set(st.sessions.map(s=>s.id).filter(Boolean))];
    if(sessIds.length){
      const {data:qRows, error:qErr}=await sb.from('session_questions')
        .select('session_id,subject,topic,correct,skipped,marks,time_taken_s,difficulty,answered')
        .in('session_id', sessIds)
        .limit(20000);
      if(qErr) throw qErr;
      st.qRows=qRows||[];
    }
  }finally{
    st.loading=false;
  }
}

function nameForStudentId(st, sid){
  const p=st?.profilesById?.[sid];
  if(p) return displayName(p);
  const n=String(st?.namesByStudentId?.[sid]||'').trim();
  if(n) return n;
  const e=String(st?.emailsByStudentId?.[sid]||'').trim();
  if(e && e.includes('@')) return e.split('@')[0];
  return shortenId(sid);
}

function adminRenderUsers(){
  const st=window.__ADMIN;
  const users=st.users||[];
  const s=st.stats||{total:0,students:0,parents:0,admins:0};

  return `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-n" style="color:var(--amber)">${s.total}</div><div class="stat-l">Total Users</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--blue)">${s.students}</div><div class="stat-l">Students</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--green)">${s.parents}</div><div class="stat-l">Parents</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--red)">${s.admins}</div><div class="stat-l">Admins</div></div>
    </div>

    <div class="icard" style="margin-top:14px">
      <div class="ititle">Registered Users (latest 500)</div>
      <table class="marks-table">
        <thead><tr>
          <th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th>
        </tr></thead>
        <tbody>
          ${users.length?users.map(u=>{
            const name=escapeHtml(displayName(u));
            const email=escapeHtml(u.email||'—');
            const role=escapeHtml(u.role||'—');
            const joined=escapeHtml(fmtDateIN(u.created_at));
            const viewBtn=u.role==='student'?`<button class="btn" onclick="viewStudentProgress('${u.id}','${jsQuote(displayName(u))}')">View</button>`:'';
            return `<tr>
              <td>${name}</td>
              <td>${email}</td>
              <td>${role}</td>
              <td>${joined}</td>
              <td style="text-align:right">${viewBtn}</td>
            </tr>`;
          }).join(''):`<tr><td colspan="5" class="neu">No users found.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function adminRenderReports(){
  const st=window.__ADMIN;
  const days=st.days||30;
  const sessions=st.sessions||[];
  const qRows=st.qRows||[];

  const total=sessions.length;
  const unique=new Set(sessions.map(s=>s.student_id).filter(Boolean)).size;
  const avg=total?Math.round(sessions.reduce((a,s)=>a+(Number(s.scaled_390)||0),0)/total):0;
  const best=total?Math.max(...sessions.map(s=>Number(s.scaled_390)||0)):0;

  // ── Subject-wise accuracy ──
  const subjAgg={}; // {sub:{attempted,correct,wrong,skipped,marks}}
  qRows.forEach(q=>{
    const sub=String(q.subject||'').trim()||'Unknown';
    if(!subjAgg[sub]) subjAgg[sub]={attempted:0,correct:0,wrong:0,skipped:0,marks:0};
    if(q.skipped){subjAgg[sub].skipped++; return;}
    subjAgg[sub].attempted++;
    if(q.correct) subjAgg[sub].correct++; else subjAgg[sub].wrong++;
    subjAgg[sub].marks+=Number(q.marks)||0;
  });
  const subjRows=Object.entries(subjAgg)
    .map(([sub,a])=>({sub,...a,acc:a.attempted?Math.round(a.correct/a.attempted*100):0}))
    .sort((x,y)=> (y.acc-x.acc) || (y.attempted-x.attempted));

  // ── Topic heatmap (by subject+topic) ──
  const topicAgg={}; // key => {subject,topic,attempted,correct,skipped,marks}
  qRows.forEach(q=>{
    const subject=String(q.subject||'').trim()||'Unknown';
    const topic=String(q.topic||'').trim()||'Unknown';
    const k=subject+'||'+topic;
    if(!topicAgg[k]) topicAgg[k]={subject,topic,attempted:0,correct:0,skipped:0,marks:0};
    if(q.skipped){topicAgg[k].skipped++; return;}
    topicAgg[k].attempted++;
    if(q.correct) topicAgg[k].correct++;
    topicAgg[k].marks+=Number(q.marks)||0;
  });
  const topicRows=Object.values(topicAgg)
    .map(t=>({...t,acc:t.attempted?Math.round(t.correct/t.attempted*100):0}))
    .sort((a,b)=> (b.attempted-a.attempted) || (a.acc-b.acc));

  // ── Student growth (trend) ──
  const sessionsByStudent={};
  sessions.forEach(s=>{
    const sid=s.student_id;
    if(!sid) return;
    (sessionsByStudent[sid]||(sessionsByStudent[sid]=[])).push(s);
  });
  const growthRows=Object.entries(sessionsByStudent).map(([sid,arr])=>{
    const list=arr.slice().sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
    const scores=list.map(s=>Number(s.scaled_390)||0);
    const n=scores.length;
    const last=scores[n-1]||0;
    const goal=350;
    const gap=goal-last;
    const w=Math.min(3,n);
    const prevW=Math.min(3,Math.max(0,n-w));
    const avgLast=w?Math.round(scores.slice(n-w).reduce((a,v)=>a+v,0)/w):0;
    const avgPrev=prevW?Math.round(scores.slice(n-w-prevW,n-w).reduce((a,v)=>a+v,0)/prevW):avgLast;
    const delta=avgLast-avgPrev;
    const trend=delta>=15?'up':delta<=-15?'down':'flat';
    const name=nameForStudentId(st, sid);
    return {sid,name,tests:n,last,avgLast,avgPrev,delta,trend,gap,updated_at:list[n-1]?.created_at};
  }).sort((a,b)=> (b.last-a.last) || (b.tests-a.tests));

  function pctColor(p){
    const n=Number(p)||0;
    if(n>=80) return 'var(--green)';
    if(n>=60) return 'var(--amber)';
    return 'var(--red)';
  }

  return `
    <div class="icard" style="margin-bottom:14px">
      <div class="ititle">Reports window</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="color:var(--t2);font-size:12px">Showing last</div>
        <input class="inp" style="width:110px" type="number" min="1" max="365" value="${days}" onchange="adminSetDays(this.value)">
        <div style="color:var(--t2);font-size:12px">days</div>
        <button class="btn btn-p" onclick="adminRefresh()">Refresh</button>
      </div>
    </div>

    ${st.profileReadBlocked?`
      <div class="icard" style="border-color:rgba(239,68,68,.22);background:rgba(239,68,68,.05);margin-bottom:14px">
        <div class="ititle" style="color:var(--red)">Profiles blocked by RLS</div>
        <div class="ibody" style="color:var(--t2)">
          Your admin session cannot read <code>public.profiles</code> rows for other users, so the UI falls back to saved names (or shortened ids).
          Fix by adding an admin SELECT policy on <code>profiles</code> (recommended) or by storing <code>student_name</code> on <code>test_sessions</code>.
        </div>
      </div>`:''}

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-n" style="color:var(--amber)">${total}</div><div class="stat-l">Mock Tests</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--cyan)">${unique}</div><div class="stat-l">Active Students</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--green)">${best}</div><div class="stat-l">Best Score /390</div></div>
      <div class="stat-card"><div class="stat-n" style="color:var(--blue)">${avg}</div><div class="stat-l">Avg Score /390</div></div>
    </div>

    <div class="icard" style="margin-top:14px">
      <div class="ititle">📊 Subject-wise Accuracy (from question data)</div>
      <div class="ibody" style="color:var(--t3)">Uses <code>session_questions</code> rows in this window. Accuracy is computed on attempted (non-skipped) questions.</div>
      <table class="marks-table">
        <thead><tr>
          <th>Subject</th><th>Attempted</th><th>Correct</th><th>Wrong</th><th>Skipped</th><th>Acc</th><th>Marks</th>
        </tr></thead>
        <tbody>
          ${subjRows.length?subjRows.map(r=>{
            return `<tr>
              <td>${escapeHtml(r.sub)}</td>
              <td class="neu">${r.attempted}</td>
              <td class="pos">${r.correct}</td>
              <td class="neg">${r.wrong}</td>
              <td class="neu">${r.skipped}</td>
              <td style="color:${pctColor(r.acc)};font-weight:800">${r.acc}%</td>
              <td class="${r.marks>=0?'pos':'neg'}">${r.marks}</td>
            </tr>`;
          }).join(''):`<tr><td colspan="7" class="neu">No question rows found. (Check if <code>session_questions</code> is being populated / RLS.)</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="icard" style="margin-top:14px">
      <div class="ititle">🧩 Topic Heatmap (volume + accuracy)</div>
      <div class="ibody" style="color:var(--t3)">Sorted by most-attempted topics first. Use this to spot high-volume weak areas (low accuracy).</div>
      <table class="marks-table">
        <thead><tr>
          <th>Subject</th><th>Topic</th><th>Attempted</th><th>Skipped</th><th>Acc</th><th>Marks</th>
        </tr></thead>
        <tbody>
          ${topicRows.length?topicRows.slice(0,120).map(t=>{
            const bg=`background:rgba(59,130,246,${Math.max(0.06,Math.min(0.22,(t.attempted||0)/30))});border-radius:8px;`;
            return `<tr style="${bg}">
              <td>${escapeHtml(t.subject)}</td>
              <td>${escapeHtml(t.topic)}</td>
              <td class="neu">${t.attempted}</td>
              <td class="neu">${t.skipped}</td>
              <td style="color:${pctColor(t.acc)};font-weight:800">${t.acc}%</td>
              <td class="${t.marks>=0?'pos':'neg'}">${t.marks}</td>
            </tr>`;
          }).join(''):`<tr><td colspan="6" class="neu">No topic rows found.</td></tr>`}
        </tbody>
      </table>
      ${topicRows.length>120?`<div class="ibody" style="color:var(--t3);margin-top:10px">Showing top 120 topics for performance.</div>`:''}
    </div>

    <div class="icard" style="margin-top:14px">
      <div class="ititle">📈 Student Growth (improving vs dropping)</div>
      <div class="ibody" style="color:var(--t3)">
        Trend compares avg of last up to 3 tests vs previous up to 3 tests (Δ ≥ 15 = up, Δ ≤ -15 = down). Goal is 350/390.
      </div>
      <table class="marks-table">
        <thead><tr>
          <th>Student</th><th>Tests</th><th>Latest</th><th>Δ</th><th>Trend</th><th>To 350</th><th>Updated</th><th></th>
        </tr></thead>
        <tbody>
          ${growthRows.length?growthRows.slice(0,200).map(g=>{
            const col=g.trend==='up'?'var(--green)':g.trend==='down'?'var(--red)':'var(--t2)';
            const trendTxt=g.trend==='up'?'Improving':g.trend==='down'?'Dropping':'Stable';
            const gapTxt=g.gap>0?`${g.gap} marks`:'On/above goal';
            const gapCol=g.gap<=0?'var(--green)':g.gap<=25?'var(--amber)':'var(--red)';
            const deltaSign=g.delta>0?'+':'';
            const viewBtn=`<button class="btn" onclick="viewStudentProgress('${g.sid}','${escapeHtml(String(g.name).replace(/'/g,'\\\''))}')">View</button>`;
            return `<tr>
              <td>${escapeHtml(g.name)}</td>
              <td class="neu">${g.tests}</td>
              <td style="font-weight:800;color:${g.last>=350?'var(--green)':g.last>=250?'var(--amber)':'var(--red)'}">${g.last}</td>
              <td style="color:${g.delta>=0?'var(--green)':'var(--red)'};font-weight:700">${deltaSign}${g.delta}</td>
              <td style="color:${col};font-weight:800">${trendTxt}</td>
              <td style="color:${gapCol};font-weight:800">${gapTxt}</td>
              <td class="neu">${escapeHtml(fmtDateIN(g.updated_at))}</td>
              <td style="text-align:right">${viewBtn}</td>
            </tr>`;
          }).join(''):`<tr><td colspan="8" class="neu">No student sessions found.</td></tr>`}
        </tbody>
      </table>
      ${growthRows.length>200?`<div class="ibody" style="color:var(--t3);margin-top:10px">Showing top 200 students for performance.</div>`:''}
    </div>

    <div class="icard" style="margin-top:14px">
      <div class="ititle">Mock Test Sessions (latest ${Math.min(2000,total)})</div>
      <table class="marks-table">
        <thead><tr>
          <th>Date</th><th>Student</th><th>Score</th><th>Acc</th><th>C/W/S</th><th>Q</th><th>Diff</th><th></th>
        </tr></thead>
        <tbody>
          ${sessions.length?sessions.map(s=>{
            const student=escapeHtml(nameForStudentId(st, s.student_id));
            const dt=escapeHtml(fmtDateIN(s.created_at));
            const score=Number(s.scaled_390)||0;
            const acc=escapeHtml((s.accuracy??'—')+'%');
            const cws=escapeHtml(`${s.correct??0}/${s.wrong??0}/${s.skipped??0}`);
            const q=escapeHtml(String(s.q_count??'—'));
            const diff=escapeHtml(String(s.difficulty??'—'));
            const col=score>=300?'var(--green)':score>=200?'var(--amber)':'var(--red)';
            const viewBtn=s.student_id?`<button class="btn" onclick="viewStudentProgress('${s.student_id}','${jsQuote(nameForStudentId(st, s.student_id))}')">Student</button>`:'';
            return `<tr>
              <td>${dt}</td>
              <td>${student}</td>
              <td style="color:${col};font-weight:700">${score}</td>
              <td>${acc}</td>
              <td class="neu">${cws}</td>
              <td>${q}</td>
              <td>${diff}</td>
              <td style="text-align:right">${viewBtn}</td>
            </tr>`;
          }).join(''):`<tr><td colspan="8" class="neu">No sessions found in this window.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function adminRenderLeaderboard(){
  const st=window.__ADMIN;
  const chosen=String(st.leaderExam || cfg?.exam || 'BITSAT');
  const sessions=(st.sessions||[]).filter(s=>String(s?.exam||'BITSAT')===chosen);
  const byStudent={};
  sessions.forEach(s=>{
    const sid=s.student_id;
    if(!sid) return;
    const score=Number(s.scaled_390)||0;
    const prev=byStudent[sid];
    if(!prev || score>prev.best){
      byStudent[sid]={best:score,last_at:s.created_at,acc:Number(s.accuracy)||0,session:s};
    }
  });
  const rows=Object.entries(byStudent).map(([sid,v])=>{
    return {sid, best:v.best, last_at:v.last_at, name:nameForStudentId(st, sid)};
  }).sort((a,b)=>b.best-a.best || String(b.last_at).localeCompare(String(a.last_at)));

  return `
    <div class="icard" style="margin-bottom:14px">
      <div class="ititle">Leaderboard — ${escapeHtml(chosen)}</div>
      <div class="ibody" style="color:var(--t2)">Computed from ${escapeHtml(chosen)} sessions in the current reports window (${st.days||30} days).</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${['BITSAT','JEE_MAIN','CUET','JEE_ADV','NEET','IISER_IAT','NEST','ISI','SAT','ACT','IELTS','TOEFL','GRE','GMAT','CAT','IPMAT','JIPMAT','GATE_2027'].map(ex=>{
          const sel=chosen===ex;
          const label={
            BITSAT:'BITSAT',JEE_MAIN:'JEE Main',CUET:'CUET',JEE_ADV:'JEE Adv',NEET:'NEET',IISER_IAT:'IISER',NEST:'NEST',ISI:'ISI',
            SAT:'SAT',ACT:'ACT',IELTS:'IELTS',TOEFL:'TOEFL',GRE:'GRE',GMAT:'GMAT',CAT:'CAT',IPMAT:'IPMAT',JIPMAT:'JIPMAT',GATE_2027:'GATE 2027'
          }[ex]||ex;
          return `<button class="chip ${sel?'chip-elite sel-n':'chip-pro'}" onclick="adminSetLeaderboardExam('${ex}')">${escapeHtml(label)}</button>`;
        }).join('')}
      </div>
    </div>

    <div class="icard">
      <table class="marks-table">
        <thead><tr>
          <th>Rank</th><th>Student</th><th>Best /390</th><th>Last Attempt</th><th></th>
        </tr></thead>
        <tbody>
          ${rows.length?rows.slice(0,200).map((r,i)=>{
            const col=r.best>=320?'var(--green)':r.best>=240?'var(--amber)':'var(--red)';
            const student=escapeHtml(r.name);
            const last=escapeHtml(fmtDateIN(r.last_at));
            const viewBtn=`<button class="btn" onclick="viewStudentProgress('${r.sid}','${jsQuote(r.name)}')">View</button>`;
            return `<tr>
              <td class="neu">#${i+1}</td>
              <td>${student}</td>
              <td style="color:${col};font-weight:800">${r.best}</td>
              <td>${last}</td>
              <td style="text-align:right">${viewBtn}</td>
            </tr>`;
          }).join(''):`<tr><td colspan="5" class="neu">No leaderboard data.</td></tr>`}
        </tbody>
      </table>
      ${rows.length>200?`<div class="ibody" style="color:var(--t3);margin-top:10px">Showing top 200 for performance.</div>`:''}
    </div>
  `;
}

function adminSetDays(v){
  if(!window.__ADMIN) window.__ADMIN={};
  window.__ADMIN.days=Number(v)||30;
}
function adminRefresh(){
  if(!window.__ADMIN) window.__ADMIN={};
  // Force reload by clearing caches.
  window.__ADMIN.sessions=[];
  window.__ADMIN.profilesById={};
  window.__ADMIN.reviewQueue=[];
  adminLoadAndRender(window.__ADMIN.view||'reports');
}

async function adminLoadReviewQueue(){
  const st=window.__ADMIN;
  if(!sb) throw new Error('Supabase not initialized');
  const {data,error}=await sb.from('question_review_queue')
    .select('*')
    .eq('status','pending')
    .order('created_at',{ascending:false})
    .limit(150);
  if(error) throw error;
  st.reviewQueue=data||[];
}

function adminRenderReviewQueue(){
  const rows=window.__ADMIN.reviewQueue||[];
  const cards=rows.length?rows.map(r=>{
    const p=r.payload||{};
    const opts=Array.isArray(p.options)?p.options:[];
    const corr=normalizeCorrectIndex(p.correct,4);
    const letter=String.fromCharCode(65+corr);
    const reasons=(r.doubt_reasons||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('')||'<li class="neu">No reasons stored</li>';
    const stem=escapeHtml(String(p.question||'').slice(0,900));
    const expl=escapeHtml(String(p.explanation||'').slice(0,1200));
    const optHtml=opts.slice(0,4).map((o,i)=>`<div style="margin:4px 0;font-size:12px"><b>${String.fromCharCode(65+i)}.</b> ${escapeHtml(String(o||''))}</div>`).join('');
    const meta=`${escapeHtml(r.subject||'')} · ${escapeHtml(r.topic||'')} · ${escapeHtml(r.difficulty||'')} · FP ${escapeHtml(shortenId(r.question_fingerprint))}`;
    const ridQ=jsQuote(String(r.id||''));
    return`<div class="icard" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <div class="ititle" style="margin-bottom:6px">Pending review</div>
          <div class="ibody" style="font-size:12px;color:var(--t2)">${meta}</div>
          <div class="ibody" style="font-size:11px;color:var(--t3);margin-top:4px">${escapeHtml(fmtDateIN(r.created_at))} · keyed <b>${letter}</b></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-p" onclick="adminResolveReview('${ridQ}','approve')">Approve</button>
          <button class="btn" onclick="adminResolveReview('${ridQ}','reject')">Reject</button>
        </div>
      </div>
      <div class="ibody" style="margin-top:10px;font-weight:700">Question</div>
      <div class="ibody" style="font-size:13px;line-height:1.5">${stem||'—'}</div>
      ${optHtml?`<div style="margin-top:8px">${optHtml}</div>`:''}
      <div class="ibody" style="margin-top:10px;font-weight:700">Explanation</div>
      <div class="ibody" style="font-size:12px;line-height:1.55;color:var(--t2)">${expl||'—'}</div>
      <div class="ibody" style="margin-top:10px;font-weight:700">Why the system flagged it</div>
      <ul style="margin:6px 0 0 18px;font-size:12px;color:var(--amber)">${reasons}</ul>
    </div>`;
  }).join(''):`<div class="icard"><div class="ibody neu">No pending items. Doubtful questions appear here after students generate mocks (requires <code>question_review_queue</code> table + admin JWT role — see <code>supabase/question_review_queue.sql</code>).</div></div>`;

  return`
    <div class="icard" style="margin-bottom:14px">
      <div class="ititle">✋ Human review queue</div>
      <div class="ibody" style="color:var(--t2)">Items flagged when automated checks were uncertain (verifier changed the key, conflicting explanation signals, thin stem, duplicate options, etc.). Approve pushes the item into the question bank for reuse.</div>
      <div style="margin-top:10px"><button class="btn" onclick="adminRefresh()">Refresh</button></div>
    </div>
    ${cards}`;
}

async function adminResolveReview(id, action){
  if(!sb||PROFILE?.role!=='admin'||!USER?.id){showToast('Admin only','error');return;}
  const act=action==='approve'?'approve':'reject';
  try{
    if(act==='approve'){
      const {data,error}=await sb.from('question_review_queue').select('*').eq('id',id).single();
      if(error) throw error;
      const p=data.payload||{};
      const q={...p,subject:data.subject||p.subject};
      await saveQuestionToBank(q);
      const {error:u1}=await sb.from('question_review_queue').update({
        status:'approved',
        decided_at:new Date().toISOString(),
        decided_by:USER.id
      }).eq('id',id);
      if(u1) throw u1;
      showToast('Approved and written to question bank ✓','success');
    }else{
      const {error:u2}=await sb.from('question_review_queue').update({
        status:'rejected',
        decided_at:new Date().toISOString(),
        decided_by:USER.id
      }).eq('id',id);
      if(u2) throw u2;
      showToast('Marked rejected ✓','success');
    }
    await adminLoadReviewQueue();
    const panel=document.getElementById('adminPanel');
    if(panel&&(window.__ADMIN?.view==='review')) panel.innerHTML=adminRenderReviewQueue();
  }catch(e){
    const msg=String(e?.message||e?.details||e||'').slice(0,160);
    showToast('Review action failed: '+msg,'error');
  }
}

// ══════════════════════════════════════════════
//  CONFIG / WELCOME
// ══════════════════════════════════════════════
function toggleSubj(el){
  if(examRules().id!=='BITSAT'){ showToast('Subjects are fixed for this exam.','error'); return; }
  const s=el.dataset.s;if(s==='ALL')return;
  el.classList.toggle('sel');
  const sels=[...document.querySelectorAll('#subjGrid .scard.sel')].filter(e=>e.dataset.s!=='ALL');
  cfg.subjects=sels.map(e=>e.dataset.s);
  document.querySelector('[data-s="ALL"]').classList.toggle('sel',cfg.subjects.length===5);
  document.getElementById('startBtn').disabled=cfg.subjects.length===0;
}
function selectAll(){
  if(examRules().id!=='BITSAT') return;
  document.querySelectorAll('#subjGrid .scard').forEach(c=>c.classList.add('sel'));
  cfg.subjects=['Physics','Chemistry','Math','English','LR'];
}

const CUET_LANGS=['Hindi','English','Marathi','Bengali','Tamil','Telugu','Kannada','Malayalam','Assamese'];
const CUET_DOMAINS=['Physics','Chemistry','Math','Biology','Economics','History','Geography','Political Science','Accountancy','Business Studies','Computer Science'];

function cuetPrefsKey(){
  const uid=String(USER?.id||'').trim();
  return uid?`cuet_prefs_${uid}`:'cuet_prefs_guest';
}
function loadCuetPrefs(){
  try{
    const raw=localStorage.getItem(cuetPrefsKey());
    const p=safeJsonParse(raw,null);
    if(!p || typeof p!=='object') return null;
    const dom=Array.isArray(p.domains)?p.domains.map(x=>String(x||'').trim()).filter(Boolean):null;
    const lang=String(p.language||'').trim();
    const out={};
    if(dom && dom.length) out.domains=dom.filter(x=>CUET_DOMAINS.includes(x)).slice(0,3);
    if(CUET_LANGS.includes(lang)) out.language=lang;
    return Object.keys(out).length?out:null;
  }catch(_e){ return null; }
}
function saveCuetPrefs(){
  try{
    const prefs={
      domains:(cfg.cuet?.domains||[]).slice(0,3),
      language:String(cfg.cuet?.language||'English')
    };
    localStorage.setItem(cuetPrefsKey(), JSON.stringify(prefs));
  }catch(_e){}
  // Best-effort remote (only if your `profiles` table has a JSON column like `prefs_json`)
  // This is optional and safely ignored if the column doesn't exist.
  try{
    if(sb && USER?.id){
      const payload={ prefs_json: { ...(PROFILE?.prefs_json||{}), cuet: { domains:(cfg.cuet?.domains||[]).slice(0,3), language:String(cfg.cuet?.language||'English') } } };
      // Fire-and-forget; ignore errors if column doesn't exist / RLS blocks.
      sb.from('profiles').update(payload).eq('id', USER.id);
    }
  }catch(_e){}
}

function isIndianExamId(id){
  const x=String(id||'').trim();
  return new Set([
    'BITSAT','JEE_MAIN','JEE_ADV','NEET','CUET','IISER_IAT','NEST','ISI',
    'CAT','IPMAT','JIPMAT','GATE_2027'
  ]).has(x);
}

function syncExamUiAttr(){
  try{
    const id=String(examRules()?.id||cfg?.exam||'BITSAT');
    document.documentElement.setAttribute('data-exam-ui', isIndianExamId(id)?'indian':'intl');
  }catch(_e){
    document.documentElement.setAttribute('data-exam-ui','intl');
  }
}

function examRules(){
  const ex=String(cfg.exam||'BITSAT');
  if(ex==='JEE_MAIN') return {id:'JEE_MAIN', name:'JEE Main', correct:4, wrong:-1, scaleTo:300, fixedCount:null};
  if(ex==='CUET') return {id:'CUET', name:'CUET', correct:5, wrong:-1, scaleTo:500, fixedCount:null};
  // Simplified single-correct MCQ mocks (real papers can include multiple correct / integer types).
  if(ex==='JEE_ADV') return {id:'JEE_ADV', name:'JEE Advanced', correct:4, wrong:-1, scaleTo:216, fixedCount:null};
  if(ex==='NEET') return {id:'NEET', name:'NEET', correct:4, wrong:-1, scaleTo:720, fixedCount:null};
  if(ex==='IISER_IAT') return {id:'IISER_IAT', name:'IISER (IAT)', correct:3, wrong:-1, scaleTo:180, fixedCount:null};
  if(ex==='NEST') return {id:'NEST', name:'NEST', correct:3, wrong:-1, scaleTo:180, fixedCount:null};
  if(ex==='ISI') return {id:'ISI', name:'ISI Entrance', correct:2, wrong:-0.5, scaleTo:120, fixedCount:null};
  // International exams (MCQ-only practice mode)
  if(ex==='SAT') return {id:'SAT', name:'SAT (Digital)', correct:1, wrong:0, scaleTo:1600, fixedCount:null};
  if(ex==='ACT') return {id:'ACT', name:'ACT', correct:1, wrong:0, scaleTo:36, fixedCount:null};
  if(ex==='IELTS') return {id:'IELTS', name:'IELTS', correct:1, wrong:0, scaleTo:9, fixedCount:null};
  if(ex==='TOEFL') return {id:'TOEFL', name:'TOEFL iBT', correct:1, wrong:0, scaleTo:120, fixedCount:null};
  if(ex==='GRE') return {id:'GRE', name:'GRE', correct:1, wrong:0, scaleTo:340, fixedCount:null};
  if(ex==='GMAT') return {id:'GMAT', name:'GMAT Focus', correct:1, wrong:0, scaleTo:805, fixedCount:null};
  if(ex==='CAT') return {id:'CAT', name:'CAT', correct:3, wrong:-1, scaleTo:198, fixedCount:null};
  if(ex==='IPMAT') return {id:'IPMAT', name:'IPMAT', correct:4, wrong:-1, scaleTo:400, fixedCount:null};
  if(ex==='JIPMAT') return {id:'JIPMAT', name:'JIPMAT', correct:4, wrong:-1, scaleTo:400, fixedCount:null};
  if(ex==='GATE_2027') return {id:'GATE_2027', name:'GATE 2027', correct:0, wrong:0, scaleTo:100, fixedCount:null};
  return {id:'BITSAT', name:'BITSAT', correct:3, wrong:-1, scaleTo:390, fixedCount:null};
}

function setExam(examId){
  cfg.exam=String(examId||'BITSAT');
  const r=examRules();
  // UI chip state
  ['exBitsat','exJee','exCuet','exJeeAdv','exNeet','exIiser','exNest','exIsi','exSat','exAct','exIelts','exToefl','exGre','exGmat','exCat','exIpmat','exJipmat','exGate'].forEach(id=>{
    const b=document.getElementById(id);
    if(!b) return;
    b.classList.remove('sel-n');
  });
  const pickId={
    BITSAT:'exBitsat',JEE_MAIN:'exJee',CUET:'exCuet',JEE_ADV:'exJeeAdv',NEET:'exNeet',
    IISER_IAT:'exIiser',NEST:'exNest',ISI:'exIsi',
    SAT:'exSat',ACT:'exAct',IELTS:'exIelts',TOEFL:'exToefl',GRE:'exGre',GMAT:'exGmat',
    CAT:'exCat',IPMAT:'exIpmat',JIPMAT:'exJipmat',GATE_2027:'exGate'
  }[r.id] || 'exBitsat';
  const pb=document.getElementById(pickId);
  if(pb) pb.classList.add('sel-n');

  if(r.id==='JEE_MAIN'){
    cfg.subjects=['Physics','Chemistry','Math'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='CUET'){
    if(!cfg.count) cfg.count=5;
    if(!cfg.cuet) cfg.cuet={domains:['Physics','Chemistry','Math'], language:'English'};
    // Prefer saved prefs per student (localStorage), else fall back to current/default
    const saved=loadCuetPrefs();
    if(saved?.domains && saved.domains.length===3) cfg.cuet.domains=saved.domains.slice(0,3);
    if(saved?.language && CUET_LANGS.includes(saved.language)) cfg.cuet.language=saved.language;
    if(!Array.isArray(cfg.cuet.domains) || cfg.cuet.domains.length!==3) cfg.cuet.domains=['Physics','Chemistry','Math'];
    if(!CUET_LANGS.includes(cfg.cuet.language)) cfg.cuet.language='English';
  }else if(r.id==='JEE_ADV'){
    cfg.subjects=['Physics','Chemistry','Math'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='NEET'){
    cfg.subjects=['Physics','Chemistry','Biology'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='IISER_IAT'){
    cfg.subjects=['Physics','Chemistry','Math','Biology'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='NEST'){
    cfg.subjects=['Physics','Chemistry','Math','Biology'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='ISI'){
    // Simplified: Math + Aptitude (tracked as General)
    cfg.subjects=['Math','General'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='SAT'){
    cfg.subjects=['SAT_RW','SAT_MATH'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='ACT'){
    cfg.subjects=['ACT_ENG','ACT_MATH','ACT_READ','ACT_SCI'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='IELTS'){
    // Objective practice only (Listening + Reading). Writing/Speaking are not auto-graded.
    cfg.subjects=['IELTS_LISTEN','IELTS_READ'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='TOEFL'){
    // Objective practice only (Reading + Listening). Speaking/Writing are not auto-graded.
    cfg.subjects=['TOEFL_READ','TOEFL_LISTEN'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='GRE'){
    cfg.subjects=['GRE_VERB','GRE_QUANT'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='GMAT'){
    cfg.subjects=['GMAT_VERB','GMAT_QUANT','GMAT_DI'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='CAT'){
    cfg.subjects=['CAT_VARC','CAT_DILR','CAT_QA'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='IPMAT' || r.id==='JIPMAT'){
    cfg.subjects=['APT_QA','APT_DILR','APT_VAR'];
    if(!cfg.count) cfg.count=5;
  }else if(r.id==='GATE_2027'){
    // Default paper model (CS-like): GA + Engineering Maths + Core
    cfg.subjects=['GATE_GA','GATE_MATH','GATE_CORE'];
    if(!cfg.count) cfg.count=5;
  }else{
    // BITSAT defaults
    if(!Array.isArray(cfg.subjects) || !cfg.subjects.length) cfg.subjects=['Physics','Chemistry','Math','English','LR'];
  }
  syncExamUiAttr();
  renderWelcomeByExam();
}
window.setExam=setExam;

function setCuetLanguage(lang){
  if(!cfg.cuet) cfg.cuet={domains:['Physics','Chemistry','Math'], language:'English'};
  const L=String(lang||'English');
  if(CUET_LANGS.includes(L)) cfg.cuet.language=L;
  saveCuetPrefs();
  renderWelcomeByExam();
}
window.setCuetLanguage=setCuetLanguage;

function toggleCuetDomain(sub){
  if(!cfg.cuet) cfg.cuet={domains:[], language:'English'};
  const s=String(sub||'').trim();
  if(!s) return;
  const cur=new Set(cfg.cuet.domains||[]);
  if(cur.has(s)) cur.delete(s);
  else{
    if(cur.size>=3){ showToast('Pick exactly 3 domain subjects for CUET.','error'); return; }
    cur.add(s);
  }
  cfg.cuet.domains=[...cur];
  saveCuetPrefs();
  renderWelcomeByExam();
}
window.toggleCuetDomain=toggleCuetDomain;

function renderWelcomeByExam(){
  const r=examRules();
  const title=document.getElementById('welcomeTitle');
  const sub=document.getElementById('welcomeSub');
  const punch=document.getElementById('heroPunchTxt');
  const cuet=document.getElementById('cuetExtra');
  const subjLbl=document.getElementById('subjectsLbl');
  const grid=document.getElementById('subjGrid');
  const note=document.getElementById('ctaNote');
  const startBtn=document.getElementById('startBtn');
  const cntRow=document.getElementById('cntRow');
  const diffRow=document.querySelector('.diff-row');

  const titleByExam={
    BITSAT:'BITSAT MASTERY <br> Mock Test',
    JEE_MAIN:'JEE MAIN <br> Mock Test',
    CUET:'CUET <br> Mock Test',
    JEE_ADV:'JEE ADVANCED <br> Mock Test',
    NEET:'NEET <br> Mock Test',
    IISER_IAT:'IISER (IAT) <br> Mock Test',
    NEST:'NEST <br> Mock Test',
    ISI:'ISI <br> Mock Test',
    SAT:'SAT <br> Mock Test',
    ACT:'ACT <br> Mock Test',
    IELTS:'IELTS <br> Mock Test',
    TOEFL:'TOEFL <br> Mock Test',
    GRE:'GRE <br> Mock Test',
    GMAT:'GMAT <br> Mock Test',
    CAT:'CAT <br> Mock Test',
    IPMAT:'IPMAT <br> Mock Test',
    JIPMAT:'JIPMAT <br> Mock Test',
    GATE_2027:'GATE 2027 <br> Mock Test',
  };
  if(title) title.innerHTML = titleByExam[r.id] || `${escapeHtml(String(r.name||r.id||'Exam'))} <br> Mock Test`;
  const subTxtByExam={
    BITSAT:'Anti-Repeat Engine · Full BITSAT Pattern',
    JEE_MAIN:'NTA-style PCM · 25Q each · +4 / −1',
    CUET:'3 Domain + 1 Language + General Aptitude · +5 / −1',
    JEE_ADV:'PCM · Advanced-style practice · +4 / −1 (single-correct MCQ)',
    NEET:'PCB · NEET-style practice · +4 / −1',
    IISER_IAT:'PCMB · IAT-style practice · +3 / −1',
    NEST:'PCMB · NEST-style practice · +3 / −1',
    ISI:'Math + Aptitude · ISI-style practice · +2 / −0.5',
    SAT:'RW + Math · Digital SAT practice · No negative marking',
    ACT:'English + Math + Reading + Science · No negative marking',
    IELTS:'Listening + Reading practice (MCQ-only) · No negative marking',
    TOEFL:'Reading + Listening practice (MCQ-only) · No negative marking',
    GRE:'Verbal + Quant practice (MCQ-only) · No negative marking',
    GMAT:'Verbal + Quant + Data Insights practice (MCQ-only) · No negative marking',
    CAT:'VARC + DILR + QA (MCQ-only) · +3/−1',
    IPMAT:'QA + DILR + Verbal (MCQ-only) · +4/−1',
    JIPMAT:'QA + DILR + Verbal (MCQ-only) · +4/−1',
    GATE_2027:'Objective only: MCQ + MSQ + NAT · Negative only for MCQ',
  };
  if(sub) sub.textContent = subTxtByExam[r.id] || subTxtByExam.BITSAT;

  const punchTxtByExam={
    BITSAT:`🚀 Do <b>3 full mocks</b> daily — speed + accuracy will skyrocket. Stay consistent, stay unstoppable.`,
    JEE_MAIN:`🎯 Train like the real exam: <b>PCM</b> speed + accuracy. Mock → review → repeat.`,
    CUET:`🧠 Boost score with <b>domain + language + aptitude</b> balance. Practice daily, improve weekly.`,
    JEE_ADV:`⚡ Advanced-level thinking needs repetition: <b>concept + depth</b> with timed mocks.`,
    NEET:`🩺 NCERT first, speed next: <b>PCB</b> mocks + focused revision = rank jump.`,
    IISER_IAT:`🔬 Strengthen fundamentals across <b>PCMB</b>. Timed practice builds selection confidence.`,
    NEST:`🌟 Crack NEST with <b>concept clarity</b> + smart attempts. Review mistakes every time.`,
    ISI:`📈 Win with <b>Math + Aptitude</b> precision. Fewer errors = big rank gains.`,
    SAT:`📚 Digital SAT: master <b>RW + Math</b> with short drills and full mocks.`,
    ACT:`⏱️ ACT is about pace: build rhythm across <b>English, Math, Reading, Science</b>.`,
    IELTS:`🎧 IELTS: sharpen <b>Listening + Reading</b> accuracy with objective practice.`,
    TOEFL:`🎧 TOEFL: practice <b>Reading + Listening</b> objectively and track weak areas.`,
    GRE:`📊 GRE: improve <b>Verbal + Quant</b> with targeted sets + timed sections.`,
    GMAT:`📉 GMAT Focus: train <b>DI + Quant + Verbal</b> with decision-making under time.`,
    CAT:`🔥 CAT: accuracy under pressure in <b>VARC, DILR, QA</b> wins percentiles.`,
    IPMAT:`🎓 IPMAT: build speed in <b>QA + DILR + Verbal</b> and keep negatives low.`,
    JIPMAT:`🎓 JIPMAT: daily practice in <b>QA + DILR + Verbal</b> brings consistency.`,
    GATE_2027:`🧩 GATE 2027: practice <b>MCQ/MSQ/NAT</b> and reduce negative marks smartly.`,
  };
  if(punch) punch.innerHTML = punchTxtByExam[r.id] || punchTxtByExam.BITSAT;

  const noteTxtByExam={
    BITSAT:'Unique AI questions · No repeat topics · Full BITSAT marking',
    JEE_MAIN:'PCM only · 75Q total · +4 correct · −1 wrong',
    CUET:'Select 3 domains + language · 100Q total · +5 correct · −1 wrong',
    JEE_ADV:'PCM only · 54Q full mock · +4 correct · −1 wrong',
    NEET:'PCB · 180Q full mock · +4 correct · −1 wrong',
    IISER_IAT:'PCMB · 60Q full mock · +3 correct · −1 wrong',
    NEST:'PCMB · 60Q full mock · +3 correct · −1 wrong',
    ISI:'Math + Aptitude · 60Q mock · +2 correct · −0.5 wrong',
    SAT:'RW 54 + Math 44 (98Q) · No negative marking',
    ACT:'English 75 + Math 60 + Reading 40 + Science 40 · No negative marking',
    IELTS:'Listening 40 + Reading 40 (80Q practice) · Writing/Speaking not auto-graded',
    TOEFL:'Reading + Listening practice · Speaking/Writing not auto-graded',
    GRE:'Verbal + Quant practice · No negative marking',
    GMAT:'Verbal + Quant + DI practice · No negative marking',
    CAT:'MCQ-only practice · +3/−1 (TITA not included)',
    IPMAT:'MCQ-only practice · +4/−1',
    JIPMAT:'MCQ-only practice · +4/−1',
    GATE_2027:'GATE 2027 · Objective only (MCQ/MSQ/NAT). Negative marking applies ONLY to MCQ.',
  };
  if(note) note.textContent = noteTxtByExam[r.id] || noteTxtByExam.BITSAT;

  if(cuet) cuet.style.display = (r.id==='CUET') ? 'block' : 'none';

  // Counts: vary per exam (supports short tests 5/10 for all)
  if(cntRow){
    cntRow.style.display='flex';
    const optionsByExam = (r.id==='BITSAT')
      ? [5,10,20,40,130]
      : (r.id==='JEE_MAIN')
        ? [5,10,25,50,75]
        : (r.id==='CUET')
          ? [5,10,20,50,100]
          : (r.id==='JEE_ADV')
            ? [5,10,18,36,54]
            : (r.id==='NEET')
              ? [5,10,45,90,180]
              : (r.id==='IISER_IAT' || r.id==='NEST')
                ? [5,10,20,40,60]
                : (r.id==='ISI')
                  ? [5,10,20,40,60]
                  : (r.id==='SAT')
                    ? [5,10,30,60,98]
                    : (r.id==='ACT')
                      ? [5,10,40,120,215]
                      : (r.id==='IELTS')
                        ? [5,10,20,40,80]
                        : (r.id==='TOEFL')
                          ? [5,10,20,40,70]
                          : (r.id==='GRE')
                            ? [5,10,20,40,54]
                            : (r.id==='GMAT')
                              ? [5,10,20,40,63]
                              : (r.id==='CAT')
                                ? [5,10,22,44,66]
                                : (r.id==='IPMAT')
                                  ? [5,10,30,60,90]
                                  : (r.id==='GATE_2027')
                                    ? [5,10,25,40,65]
                                    : [5,10,30,60,100];
    const labelsByN = (r.id==='BITSAT')
      ? {5:'5 Q',10:'10 Q',20:'🔥 20 Q',40:'🚀 40 Q',130:'🏆 Full 130 Q'}
      : (r.id==='JEE_MAIN')
        ? {5:'5 Q',10:'10 Q',25:'25 Q',50:'50 Q',75:'🏆 Full 75 Q'}
        : (r.id==='CUET')
          ? {5:'5 Q',10:'10 Q',20:'20 Q',50:'50 Q',100:'🏆 Full 100 Q'}
          : (r.id==='JEE_ADV')
            ? {5:'5 Q',10:'10 Q',18:'18 Q',36:'36 Q',54:'🏆 Full 54 Q'}
            : (r.id==='NEET')
              ? {5:'5 Q',10:'10 Q',45:'45 Q',90:'90 Q',180:'🏆 Full 180 Q'}
              : (r.id==='IISER_IAT' || r.id==='NEST' || r.id==='ISI')
                ? {5:'5 Q',10:'10 Q',20:'20 Q',40:'40 Q',60:'🏆 Full 60 Q'}
                : (r.id==='SAT')
                  ? {5:'5 Q',10:'10 Q',30:'30 Q',60:'60 Q',98:'🏆 Full 98 Q'}
                  : (r.id==='ACT')
                    ? {5:'5 Q',10:'10 Q',40:'40 Q',120:'120 Q',215:'🏆 Full 215 Q'}
                    : (r.id==='IELTS')
                      ? {5:'5 Q',10:'10 Q',20:'20 Q',40:'40 Q',80:'🏆 Full 80 Q'}
                      : (r.id==='TOEFL')
                        ? {5:'5 Q',10:'10 Q',20:'20 Q',40:'40 Q',70:'🏆 Full 70 Q'}
                        : (r.id==='GRE')
                          ? {5:'5 Q',10:'10 Q',20:'20 Q',40:'40 Q',54:'🏆 Full 54 Q'}
                          : (r.id==='GMAT')
                            ? {5:'5 Q',10:'10 Q',20:'20 Q',40:'40 Q',63:'🏆 Full 63 Q'}
                            : (r.id==='CAT')
                              ? {5:'5 Q',10:'10 Q',22:'22 Q',44:'44 Q',66:'🏆 Full 66 Q'}
                              : (r.id==='IPMAT')
                                ? {5:'5 Q',10:'10 Q',30:'30 Q',60:'60 Q',90:'🏆 Full 90 Q'}
                                : (r.id==='GATE_2027')
                                  ? {5:'5 Q',10:'10 Q',25:'25 Q',40:'40 Q',65:'🏆 Full 65 Q'}
                                  : {5:'5 Q',10:'10 Q',30:'30 Q',60:'60 Q',100:'🏆 Full 100 Q'};

    // Keep current selection if still valid, else default to 5.
    const cur = Number(cfg.count||0);
    if(!optionsByExam.includes(cur)) cfg.count=optionsByExam[0];

    cntRow.innerHTML = optionsByExam.map((n,idx)=>{
      const cls = (n===cfg.count) ? (n===5?'chip chip-soft sel-q':'chip chip-pro sel-n') : (idx<2?'chip chip-soft':'chip chip-pro');
      const badge = (n===5)?'<span class=\"chip-badge\">Warm-up</span>':(n===10?'<span class=\"chip-badge\">Practice</span>':'');
      return `<button class=\"${cls}\" data-n=\"${n}\" onclick=\"setCnt(this,${n})\">${labelsByN[n]||`${n} Q`}${badge}</button>`;
    }).join('');
  }

  // Difficulty: keep (still useful); show always
  if(diffRow) diffRow.style.display='flex';

  // Build subject grid
  if(grid){
    if(r.id==='BITSAT'){
      if(subjLbl) subjLbl.textContent='Select Subjects';
      grid.innerHTML=`
        <div class="scard ${cfg.subjects.includes('Physics')?'sel':''}" data-s="Physics" onclick="toggleSubj(this)"><div class="sc-em">⚡</div><div class="sc-nm">Physics</div><div class="sc-ct">30 Q full</div></div>
        <div class="scard ${cfg.subjects.includes('Chemistry')?'sel':''}" data-s="Chemistry" onclick="toggleSubj(this)"><div class="sc-em">🧪</div><div class="sc-nm">Chemistry</div><div class="sc-ct">30 Q full</div></div>
        <div class="scard ${cfg.subjects.includes('Math')?'sel':''}" data-s="Math" onclick="toggleSubj(this)"><div class="sc-em">📐</div><div class="sc-nm">Math</div><div class="sc-ct">40 Q full</div></div>
        <div class="scard ${cfg.subjects.includes('English')?'sel':''}" data-s="English" onclick="toggleSubj(this)"><div class="sc-em">📖</div><div class="sc-nm">English</div><div class="sc-ct">10 Q full</div></div>
        <div class="scard ${cfg.subjects.includes('LR')?'sel':''}" data-s="LR" onclick="toggleSubj(this)"><div class="sc-em">🧠</div><div class="sc-nm">Reasoning</div><div class="sc-ct">20 Q full</div></div>
        <div class="scard" data-s="ALL" onclick="selectAll()"><div class="sc-em">🎯</div><div class="sc-nm">All</div><div class="sc-ct">Full mock</div></div>
      `;
      if(startBtn) startBtn.disabled = cfg.subjects.length===0;
    }else if(r.id==='JEE_MAIN'){
      if(subjLbl) subjLbl.textContent='Subjects (fixed)';
      grid.innerHTML=`
        <div class="scard sel" data-s="Physics"><div class="sc-em">⚡</div><div class="sc-nm">Physics</div><div class="sc-ct">25 Q</div></div>
        <div class="scard sel" data-s="Chemistry"><div class="sc-em">🧪</div><div class="sc-nm">Chemistry</div><div class="sc-ct">25 Q</div></div>
        <div class="scard sel" data-s="Math"><div class="sc-em">📐</div><div class="sc-nm">Math</div><div class="sc-ct">25 Q</div></div>
      `;
      if(startBtn) startBtn.disabled=false;
    }else if(r.id==='JEE_ADV'){
      if(subjLbl) subjLbl.textContent='Subjects (fixed)';
      grid.innerHTML=`
        <div class="scard sel" data-s="Physics"><div class="sc-em">⚡</div><div class="sc-nm">Physics</div><div class="sc-ct">18 Q full</div></div>
        <div class="scard sel" data-s="Chemistry"><div class="sc-em">🧪</div><div class="sc-nm">Chemistry</div><div class="sc-ct">18 Q full</div></div>
        <div class="scard sel" data-s="Math"><div class="sc-em">📐</div><div class="sc-nm">Math</div><div class="sc-ct">18 Q full</div></div>
      `;
      if(startBtn) startBtn.disabled=false;
    }else if(r.id==='NEET'){
      if(subjLbl) subjLbl.textContent='Subjects (fixed)';
      grid.innerHTML=`
        <div class="scard sel" data-s="Physics"><div class="sc-em">⚡</div><div class="sc-nm">Physics</div><div class="sc-ct">45 Q full</div></div>
        <div class="scard sel" data-s="Chemistry"><div class="sc-em">🧪</div><div class="sc-nm">Chemistry</div><div class="sc-ct">45 Q full</div></div>
        <div class="scard sel" data-s="Biology"><div class="sc-em">🧬</div><div class="sc-nm">Biology</div><div class="sc-ct">90 Q full</div></div>
      `;
      if(startBtn) startBtn.disabled=false;
    }else if(r.id==='IISER_IAT'){
      if(subjLbl) subjLbl.textContent='Subjects (fixed)';
      grid.innerHTML=`
        <div class="scard sel" data-s="Physics"><div class="sc-em">⚡</div><div class="sc-nm">Physics</div><div class="sc-ct">15 Q full</div></div>
        <div class="scard sel" data-s="Chemistry"><div class="sc-em">🧪</div><div class="sc-nm">Chemistry</div><div class="sc-ct">15 Q full</div></div>
        <div class="scard sel" data-s="Math"><div class="sc-em">📐</div><div class="sc-nm">Math</div><div class="sc-ct">15 Q full</div></div>
        <div class="scard sel" data-s="Biology"><div class="sc-em">🧬</div><div class="sc-nm">Biology</div><div class="sc-ct">15 Q full</div></div>
      `;
      if(startBtn) startBtn.disabled=false;
    }else if(r.id==='NEST'){
      if(subjLbl) subjLbl.textContent='Subjects (fixed)';
      grid.innerHTML=`
        <div class="scard sel" data-s="Physics"><div class="sc-em">⚡</div><div class="sc-nm">Physics</div><div class="sc-ct">15 Q full</div></div>
        <div class="scard sel" data-s="Chemistry"><div class="sc-em">🧪</div><div class="sc-nm">Chemistry</div><div class="sc-ct">15 Q full</div></div>
        <div class="scard sel" data-s="Math"><div class="sc-em">📐</div><div class="sc-nm">Math</div><div class="sc-ct">15 Q full</div></div>
        <div class="scard sel" data-s="Biology"><div class="sc-em">🧬</div><div class="sc-nm">Biology</div><div class="sc-ct">15 Q full</div></div>
      `;
      if(startBtn) startBtn.disabled=false;
    }else if(r.id==='ISI'){
      if(subjLbl) subjLbl.textContent='Subjects (fixed)';
      grid.innerHTML=`
        <div class="scard sel" data-s="Math"><div class="sc-em">📐</div><div class="sc-nm">Mathematics</div><div class="sc-ct">40 Q full</div></div>
        <div class="scard sel" data-s="General"><div class="sc-em">🧠</div><div class="sc-nm">Aptitude</div><div class="sc-ct">20 Q full</div></div>
      `;
      if(startBtn) startBtn.disabled=false;
    }else if(r.id==='CUET'){
      // CUET domain selection (exactly 3)
      if(!cfg.cuet) cfg.cuet={domains:[], language:'English'};
      if(subjLbl) subjLbl.textContent='Choose 3 Domain Subjects';
      grid.innerHTML=CUET_DOMAINS.map(s=>{
        const sel=(cfg.cuet.domains||[]).includes(s);
        const em = s==='Biology'?'🧬':s==='Economics'?'📈':s==='History'?'🏺':s==='Geography'?'🗺️':s==='Political Science'?'🏛️':s==='Accountancy'?'🧾':s==='Business Studies'?'💼':s==='Computer Science'?'💻':(s==='Physics'?'⚡':s==='Chemistry'?'🧪':'📐');
        return `<div class="scard ${sel?'sel':''}" onclick="toggleCuetDomain('${jsQuote(s)}')"><div class="sc-em">${em}</div><div class="sc-nm">${escapeHtml(s)}</div><div class="sc-ct">20 Q</div></div>`;
      }).join('');
      const ok=(cfg.cuet.domains||[]).length===3;
      if(startBtn) startBtn.disabled=!ok;
    }else{
      // All other exams: fixed sections (no selection UI)
      if(subjLbl) subjLbl.textContent='Sections (fixed)';
      const nameMap={
        SAT_RW:{em:'📖',nm:'SAT Reading & Writing'}, SAT_MATH:{em:'📐',nm:'SAT Math'},
        ACT_ENG:{em:'✍️',nm:'ACT English'}, ACT_MATH:{em:'📐',nm:'ACT Math'}, ACT_READ:{em:'📚',nm:'ACT Reading'}, ACT_SCI:{em:'🧪',nm:'ACT Science'},
        IELTS_LISTEN:{em:'🎧',nm:'IELTS Listening'}, IELTS_READ:{em:'📚',nm:'IELTS Reading'},
        TOEFL_READ:{em:'📚',nm:'TOEFL Reading'}, TOEFL_LISTEN:{em:'🎧',nm:'TOEFL Listening'},
        GRE_VERB:{em:'📝',nm:'GRE Verbal'}, GRE_QUANT:{em:'📐',nm:'GRE Quant'},
        GMAT_VERB:{em:'📝',nm:'GMAT Verbal'}, GMAT_QUANT:{em:'📐',nm:'GMAT Quant'}, GMAT_DI:{em:'📊',nm:'GMAT Data Insights'},
        CAT_VARC:{em:'📚',nm:'CAT VARC'}, CAT_DILR:{em:'🧩',nm:'CAT DILR'}, CAT_QA:{em:'📐',nm:'CAT QA'},
        APT_QA:{em:'📐',nm:'Quant'}, APT_DILR:{em:'🧩',nm:'DILR'}, APT_VAR:{em:'📚',nm:'Verbal'},
        GATE_GA:{em:'🧠',nm:'GATE General Aptitude'}, GATE_MATH:{em:'📐',nm:'GATE Engg. Maths'}, GATE_CORE:{em:'💻',nm:'GATE Core'}
      };
      const subs=(cfg.subjects||[]).slice(0,8);
      grid.innerHTML=subs.map(s=>{
        const meta=nameMap[s]||{em:'📄',nm:String(s||'Section')};
        return `<div class="scard sel" data-s="${escapeHtml(String(s))}"><div class="sc-em">${meta.em}</div><div class="sc-nm">${escapeHtml(meta.nm)}</div><div class="sc-ct">Fixed</div></div>`;
      }).join('');
      if(startBtn) startBtn.disabled=false;
    }
  }

  // Count locks (5-test / 10-test rule) after chips render
  try{ enforceCountLock(); }catch(_e){}

  // CUET language chips
  const langRow=document.getElementById('cuetLangRow');
  if(langRow){
    if(r.id==='CUET'){
      const cur=String(cfg.cuet?.language||'English');
      langRow.innerHTML=CUET_LANGS.map(L=>{
        const sel=(L===cur);
        return `<button class="chip chip-soft ${sel?'sel-n':''}" onclick="setCuetLanguage('${jsQuote(L)}')">${escapeHtml(L)}</button>`;
      }).join('');
    }else{
      langRow.innerHTML='';
    }
  }
}
function setCnt(el,n){
  if(el && el.disabled) return;
  document.querySelectorAll('#cntRow .chip').forEach(c=>{c.classList.remove('sel-n','sel-q')});
  el.classList.add(n===5?'sel-q':'sel-n');
  cfg.count=n;
}

function enforceCountLock(){
  // Rule (all exams): after 5 completed tests disable 5Q; after 10 completed tests disable 10Q.
  const r=examRules();
  const exams=(DB_SESSIONS||[]).map(s=>String(s?.exam||'BITSAT'));
  const tests=exams.filter(x=>x===r.id).length;
  const lock5=tests>=5;
  const lock10=tests>=10;
  const chips=[...document.querySelectorAll('#cntRow .chip')];
  chips.forEach(c=>{
    const n=Number(c.dataset.n||0);
    const shouldLock = (n===5 && lock5) || (n===10 && lock10);
    if(n===5 || n===10){
      c.disabled=shouldLock;
      c.classList.toggle('chip-locked', shouldLock);
      c.title = shouldLock ? (n===5?'Locked after 5 tests':'Locked after 10 tests') : '';
    }
  });

  // If current selection became locked, bump to first unlocked option.
  const picked = chips.find(x=>x.classList.contains('sel-q') || x.classList.contains('sel-n'));
  if(picked && picked.disabled){
    const fallback = chips.find(x=>!x.disabled) || chips[chips.length-1];
    if(fallback){
      fallback.disabled=false;
      setCnt(fallback, Number(fallback.dataset.n||cfg.count));
    }
  }
}
function setDiff(el,d){document.querySelectorAll('.dbtn').forEach(b=>b.className='dbtn');el.classList.add('d-'+d);cfg.diff=d;document.getElementById('adaptHint').style.display=d==='adaptive'?'block':'none';}

// ══════════════════════════════════════════════
//  ANTI-REPEAT TOPIC PICKER (DB-aware)
// ══════════════════════════════════════════════
function pickTopic(sub,qi){
  const pool=TP[sub]||TP.Physics;
  // Sort by least-used (DB-tracked) then by seed offset
  const sorted=[...pool].sort((a,b)=>{
    const ka=sub+':'+a,kb=sub+':'+b;
    const ua=DB_USED_TOPICS[ka]||0,ub=DB_USED_TOPICS[kb]||0;
    if(ua!==ub)return ua-ub;
    return ((E.seed*17+qi*31)%100)/100-.5;
  });
  // Pick from least-used 60%
  const halfLen=Math.max(1,Math.ceil(sorted.length*.6));
  const idx=((E.seed*3+qi*11)%halfLen+halfLen)%halfLen;
  const topic=sorted[idx]||sorted[0];
  E.tu.push(sub+':'+topic);
  // Update local count for this session
  const k=sub+':'+topic;
  DB_USED_TOPICS[k]=(DB_USED_TOPICS[k]||0)+1;
  return topic;
}

function shouldShuffleQuestionOrder(){
  return String(APP_SETTINGS?.question_order||'subject_batch').trim().toLowerCase()==='random';
}
function maybeShuffleSubList(list){
  if(!shouldShuffleQuestionOrder()) return list;
  for(let i=list.length-1;i>0;i--){
    const j=(E.seed+i*7)%(i+1);
    [list[i],list[j]]=[list[j],list[i]];
  }
  return list;
}

function buildSubList(){
  const r=examRules();
  const list=[];
  if(r.id==='JEE_MAIN'){
    // Full: 25 each = 75. Short tests: distribute evenly across PCM.
    const n=Number(cfg.count||75);
    if(n===75){
      [{s:'Physics',c:25},{s:'Chemistry',c:25},{s:'Math',c:25}].forEach(({s:sub,c})=>{for(let i=0;i<c;i++)list.push(sub);});
      return list;
    }
    const s=['Physics','Chemistry','Math'];
    const base=Math.floor(n/s.length);let rem=n%s.length;
    const counts={};s.forEach((sub,i)=>{counts[sub]=(base+(i<rem?1:0));});
    s.forEach(sub=>{for(let i=0;i<counts[sub];i++)list.push(sub);});
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='JEE_ADV'){
    // Simplified: full 54 = 18 each (PCM). Short tests distribute evenly.
    const n=Number(cfg.count||54);
    if(n===54){
      [{s:'Physics',c:18},{s:'Chemistry',c:18},{s:'Math',c:18}].forEach(({s:sub,c})=>{for(let i=0;i<c;i++)list.push(sub);});
      return list;
    }
    const s=['Physics','Chemistry','Math'];
    const base=Math.floor(n/s.length);let rem=n%s.length;
    const counts={};s.forEach((sub,i)=>{counts[sub]=(base+(i<rem?1:0));});
    s.forEach(sub=>{for(let i=0;i<counts[sub];i++)list.push(sub);});
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='NEET'){
    // Full 180: Physics 45, Chemistry 45, Biology 90. Short tests distribute across PCB.
    const n=Number(cfg.count||180);
    if(n===180){
      [{s:'Physics',c:45},{s:'Chemistry',c:45},{s:'Biology',c:90}].forEach(({s:sub,c})=>{for(let i=0;i<c;i++)list.push(sub);});
      return list;
    }
    const s=['Physics','Chemistry','Biology'];
    const base=Math.floor(n/s.length);let rem=n%s.length;
    const counts={};s.forEach((sub,i)=>{counts[sub]=(base+(i<rem?1:0));});
    s.forEach(sub=>{for(let i=0;i<counts[sub];i++)list.push(sub);});
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='IISER_IAT' || r.id==='NEST'){
    // Default full: 60 = 15 each (PCMB). Short tests distribute evenly.
    const n=Number(cfg.count||60);
    if(n===60){
      [{s:'Physics',c:15},{s:'Chemistry',c:15},{s:'Math',c:15},{s:'Biology',c:15}].forEach(({s:sub,c})=>{for(let i=0;i<c;i++)list.push(sub);});
      return list;
    }
    const s=['Physics','Chemistry','Math','Biology'];
    const base=Math.floor(n/s.length);let rem=n%s.length;
    const counts={};s.forEach((sub,i)=>{counts[sub]=(base+(i<rem?1:0));});
    s.forEach(sub=>{for(let i=0;i<counts[sub];i++)list.push(sub);});
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='ISI'){
    // Default full: 60 = Math 40 + Aptitude(General) 20. Short tests distribute 2:1.
    const n=Number(cfg.count||60);
    if(n===60){
      [{s:'Math',c:40},{s:'General',c:20}].forEach(({s:sub,c})=>{for(let i=0;i<c;i++)list.push(sub);});
      return list;
    }
    const math=Math.round(n*2/3);
    const gen=Math.max(0,n-math);
    for(let i=0;i<math;i++) list.push('Math');
    for(let i=0;i<gen;i++) list.push('General');
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='SAT'){
    // Full 98: RW 54 + Math 44. Short tests distribute ~55/45.
    const n=Number(cfg.count||98);
    const rw=Math.round(n*0.55);
    const mt=Math.max(0,n-rw);
    if(n===98){
      for(let i=0;i<54;i++) list.push('SAT_RW');
      for(let i=0;i<44;i++) list.push('SAT_MATH');
    }else{
      for(let i=0;i<rw;i++) list.push('SAT_RW');
      for(let i=0;i<mt;i++) list.push('SAT_MATH');
      maybeShuffleSubList(list);
    }
    return list.slice(0,n);
  }
  if(r.id==='ACT'){
    // Full 215: Eng 75, Math 60, Read 40, Sci 40. No negative.
    const n=Number(cfg.count||215);
    if(n===215){
      [{s:'ACT_ENG',c:75},{s:'ACT_MATH',c:60},{s:'ACT_READ',c:40},{s:'ACT_SCI',c:40}].forEach(({s,c})=>{for(let i=0;i<c;i++)list.push(s);});
      return list;
    }
    const s=['ACT_ENG','ACT_MATH','ACT_READ','ACT_SCI'];
    const base=Math.floor(n/s.length);let rem=n%s.length;
    const counts={};s.forEach((sub,i)=>{counts[sub]=(base+(i<rem?1:0));});
    s.forEach(sub=>{for(let i=0;i<counts[sub];i++)list.push(sub);});
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='IELTS'){
    // Objective practice only: Listening 40 + Reading 40.
    const n=Number(cfg.count||80);
    if(n===80){
      for(let i=0;i<40;i++) list.push('IELTS_LISTEN');
      for(let i=0;i<40;i++) list.push('IELTS_READ');
      return list;
    }
    const half=Math.floor(n/2);
    for(let i=0;i<half;i++) list.push('IELTS_LISTEN');
    for(let i=0;i<n-half;i++) list.push('IELTS_READ');
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='TOEFL'){
    // Objective practice only (approx): Reading 35 + Listening 35 => 70.
    const n=Number(cfg.count||70);
    const half=Math.floor(n/2);
    for(let i=0;i<half;i++) list.push('TOEFL_READ');
    for(let i=0;i<n-half;i++) list.push('TOEFL_LISTEN');
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='GRE'){
    // Practice only: Verbal + Quant (approx 27+27=54).
    const n=Number(cfg.count||54);
    const half=Math.floor(n/2);
    for(let i=0;i<half;i++) list.push('GRE_VERB');
    for(let i=0;i<n-half;i++) list.push('GRE_QUANT');
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='GMAT'){
    // Practice only: Verbal + Quant + Data Insights (21 each in full = 63).
    const n=Number(cfg.count||63);
    if(n===63){
      [{s:'GMAT_VERB',c:21},{s:'GMAT_QUANT',c:21},{s:'GMAT_DI',c:21}].forEach(({s,c})=>{for(let i=0;i<c;i++)list.push(s);});
      return list;
    }
    const s=['GMAT_VERB','GMAT_QUANT','GMAT_DI'];
    const base=Math.floor(n/s.length);let rem=n%s.length;
    const counts={};s.forEach((sub,i)=>{counts[sub]=(base+(i<rem?1:0));});
    s.forEach(sub=>{for(let i=0;i<counts[sub];i++)list.push(sub);});
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='CAT'){
    // MCQ-only practice: VARC 24, DILR 20, QA 22 (full 66).
    const n=Number(cfg.count||66);
    if(n===66){
      [{s:'CAT_VARC',c:24},{s:'CAT_DILR',c:20},{s:'CAT_QA',c:22}].forEach(({s,c})=>{for(let i=0;i<c;i++)list.push(s);});
      return list;
    }
    const s=['CAT_VARC','CAT_DILR','CAT_QA'];
    const base=Math.floor(n/s.length);let rem=n%s.length;
    const counts={};s.forEach((sub,i)=>{counts[sub]=(base+(i<rem?1:0));});
    s.forEach(sub=>{for(let i=0;i<counts[sub];i++)list.push(sub);});
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='IPMAT' || r.id==='JIPMAT'){
    // MCQ-only practice: QA + DILR + Verbal. Full 100 for JIPMAT, 90 for IPMAT (practice).
    const n=Number(cfg.count||100);
    const s=['APT_QA','APT_DILR','APT_VAR'];
    const base=Math.floor(n/s.length);let rem=n%s.length;
    const counts={};s.forEach((sub,i)=>{counts[sub]=(base+(i<rem?1:0));});
    s.forEach(sub=>{for(let i=0;i<counts[sub];i++)list.push(sub);});
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='GATE_2027'){
    // Default GATE paper model: GA 10, Engg Maths 13, Core 42 (total 65)
    const n=Number(cfg.count||65);
    if(n===65){
      [{s:'GATE_GA',c:10},{s:'GATE_MATH',c:13},{s:'GATE_CORE',c:42}].forEach(({s,c})=>{for(let i=0;i<c;i++)list.push(s);});
      return list;
    }
    // Short tests: keep proportional weights GA:Math:Core ~= 10:13:42
    const w=[{s:'GATE_GA',w:10},{s:'GATE_MATH',w:13},{s:'GATE_CORE',w:42}];
    const total=w.reduce((a,x)=>a+x.w,0);
    let remaining=n;
    const counts={};
    w.forEach((x,idx)=>{
      const c = (idx===w.length-1) ? remaining : Math.max(0, Math.round(n*x.w/total));
      counts[x.s]=c; remaining-=c;
    });
    Object.entries(counts).forEach(([s,c])=>{for(let i=0;i<c;i++)list.push(s);});
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }
  if(r.id==='CUET'){
    // 3 domains + 1 language + compulsory General Aptitude.
    const domains=(cfg.cuet?.domains||[]).slice(0,3);
    const n=Number(cfg.count||100);
    const blocks=[...domains.map(d=>({s:d})), {s:'Language'}, {s:'General'}].map(b=>b.s);
    // If domains not ready, return empty so UI disables start.
    if(domains.length!==3) return [];
    if(n===100){
      // 20 each = 100
      blocks.forEach(sub=>{for(let i=0;i<20;i++)list.push(sub);});
      return list;
    }
    // Short tests: keep section balance (5 => 1 each; 10 => 2 each; etc.)
    const per=Math.floor(n/blocks.length);
    let rem=n%blocks.length;
    blocks.forEach((sub,i)=>{
      const c=per+(i<rem?1:0);
      for(let k=0;k<c;k++) list.push(sub);
    });
    maybeShuffleSubList(list);
    return list.slice(0,n);
  }

  // BITSAT (existing behavior)
  const s=cfg.subjects,n=cfg.count;
  if(n===130&&s.length===5){
    [{s:'Physics',c:30},{s:'Chemistry',c:30},{s:'Math',c:40},{s:'English',c:10},{s:'LR',c:20}].forEach(({s:sub,c})=>{for(let i=0;i<c;i++)list.push(sub);});
  } else {
    const base=Math.floor(n/s.length);let rem=n%s.length;
    const counts={};s.forEach((sub,i)=>{counts[sub]=(base+(i<rem?1:0));});
    s.forEach(sub=>{for(let i=0;i<counts[sub];i++)list.push(sub);});
    maybeShuffleSubList(list);
  }
  return list.slice(0,n);
}

// ══════════════════════════════════════════════
//  ADAPTIVE DIFFICULTY
// ══════════════════════════════════════════════
function getAdaptDiff(qi){
  if(cfg.diff!=='adaptive')return cfg.diff;
  if(qi<2)return'medium';
  const recent=Object.entries(E.mks).slice(-5);
  if(!recent.length)return'medium';
  const rate=recent.filter(([,v])=>v===3).length/recent.length;
  return rate>=0.8?'hard':rate>=0.4?'medium':'easy';
}

// ══════════════════════════════════════════════
//  API CALL
// ══════════════════════════════════════════════
// ── CALL WITH AUTO-FALLBACK ──
// ⚠️ SECURITY WARNING:
// You requested provider keys embedded in `index.html` so "folder upload" deployments work.
// This makes keys PUBLIC to anyone who can view-source your site.
// Prefer Netlify Functions / Supabase Edge Functions for production.
// DO NOT embed real keys in client code.
// Use Netlify Functions (recommended) or set keys in Admin Settings for local-only testing.
const ANTHROPIC_KEY_EMBEDDED = '';
const OPENAI_KEY_EMBEDDED    = '';

function isRankgateHostname(h){
  const x=String(h||'').toLowerCase();
  return x==='rankgate.in'||x==='www.rankgate.in'||x.endsWith('.rankgate.in');
}
// Avoid broken questions after domain/TLS changes: upgrade http→https on secure pages and match www/apex to the tab the user is on.
function normalizeQuestionProxyOriginForPage(raw){
  const pin=String(raw||'').trim();
  if(!pin) return '';
  try{
    const u=/^https?:\/\//i.test(pin)?new URL(pin):new URL(pin,window.location.origin);
    const loc=window.location;
    const curHost=String(loc.hostname||'').toLowerCase();
    if(loc.protocol==='https:'&&u.protocol==='http:') u.protocol='https:';
    const uh=String(u.hostname||'').toLowerCase();
    if(isRankgateHostname(curHost)&&isRankgateHostname(uh)) u.hostname=curHost;
    return u.origin.replace(/\/$/,'');
  }catch(_e){
    return pin.replace(/\/$/,'');
  }
}

async function getQuestionApiToken(){
  if(!sb) return '';
  try{
    let {data:{session}}=await sb.auth.getSession();
    const expiresAt=Number(session?.expires_at||0);
    const shouldRefresh=!session?.access_token || (expiresAt && expiresAt-Date.now()/1000<90);
    if(shouldRefresh){
      const refreshed=await sb.auth.refreshSession();
      session=refreshed?.data?.session||session;
    }
    return String(session?.access_token||'').trim();
  }catch(e){
    console.warn('Could not read/refresh Supabase session:', e?.message||e);
    return '';
  }
}

function getQuestionProxyBase(){
  const fromSettings=String(APP_SETTINGS?.api_proxy?.base_url||'').trim();
  if(fromSettings){
    const normalized=normalizeQuestionProxyOriginForPage(fromSettings);
    if(normalized) return normalized;
    try{
      if(/^https?:\/\//i.test(fromSettings)){
        return new URL(fromSettings).origin.replace(/\/$/,'');
      }
    }catch(_e){}
    return fromSettings.replace(/\/$/,'');
  }
  try{
    const loc=window.location;
    const proto=String(loc.protocol||'');
    const host=String(loc.hostname||'').toLowerCase();
    const isFile=proto==='file:';
    const isLocal=host==='localhost'||host==='127.0.0.1'||host==='[::1]'||host==='0.0.0.0';
    if(isFile||isLocal){
      const pin=String(typeof QUESTION_PROXY_ORIGIN!=='undefined'?QUESTION_PROXY_ORIGIN:'').trim();
      if(pin){
        const n=normalizeQuestionProxyOriginForPage(pin);
        if(n) return n;
        try{ return new URL(pin).origin.replace(/\/$/,''); }
        catch(_e){ return pin.replace(/\/$/,''); }
      }
    }
    return String(loc.origin||'').replace(/\/$/,'');
  }catch(_e){
    const pin=String(typeof QUESTION_PROXY_ORIGIN!=='undefined'?QUESTION_PROXY_ORIGIN:'').trim();
    if(!pin) return '';
    const n=normalizeQuestionProxyOriginForPage(pin);
    return n||pin.replace(/\/$/,'');
  }
}

async function callNetlifyQuestionFunction(body){
  // If deployed with Netlify Functions, keep provider keys on server.
  const base=getQuestionProxyBase();
  const url=(base?base:'')+'/.netlify/functions/generate-question';
  const tok=await getQuestionApiToken();
  if(!tok) throw new Error('Missing Authorization Bearer token — sign out, sign in again, then retry.');
  const ctrl=new AbortController();
  const to=setTimeout(()=>ctrl.abort(),88000);
  let r;
  try{
    r=await fetch(url,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer '+tok
      },
      body: JSON.stringify({ body }),
      signal:ctrl.signal
    });
  }catch(e){
    clearTimeout(to);
    if(String(e?.name||'')==='AbortError') throw new Error('Question API timed out — try again.');
    const m=String(e?.message||e||'');
    if(/Failed to fetch|Load failed|NetworkError/i.test(m)){
      let apiHost='server';
      try{ apiHost=new URL(url,typeof location!=='undefined'?location.href:'http://localhost').host; }catch(_e){}
      throw new Error('Cannot reach question API ('+apiHost+'). Check network, ad-blockers, or that the site is deployed with Netlify Functions.');
    }
    throw e;
  }
  clearTimeout(to);
  const txt=await r.text();
  if(!r.ok){
    let msg=txt.replace(/\s+/g,' ').trim().slice(0,280);
    try{
      const j=JSON.parse(txt);
      const e0=String(j?.error||'').trim();
      const d0=String(j?.detail||'').trim();
      msg=[e0,d0].filter(Boolean).join(' — ').slice(0,280)||msg;
    }catch(_e){
      if(/^\s*</.test(txt)) msg='Function returned HTML instead of JSON (deploy or routing issue — check Netlify Functions for generate-question).';
    }
    throw new Error(`Server function failed (${r.status}). ${msg}`);
  }
  let data;
  try{
    data=JSON.parse(txt);
  }catch(_e){
    const prev=txt.replace(/\s+/g,' ').trim().slice(0,100);
    throw new Error('Question API returned invalid JSON (empty proxy body or wrong URL). '+prev);
  }
  // Preserve upstream provider (anthropic/openai) when the function includes it.
  // Only set a generic label if it's missing.
  if(!data._provider) data._provider='proxy';
  return data;
}

async function callAPI(body, retries = 2) {
  // For "folder upload" deployments, call providers directly from the browser.
  // First use embedded keys, then fall back to admin/local settings.
  const AKEY=String(ANTHROPIC_KEY_EMBEDDED||'').trim() || String(APP_SETTINGS?.api_keys?.anthropic||'').trim();
  const OKEY=String(OPENAI_KEY_EMBEDDED||'').trim() || String(APP_SETTINGS?.api_keys?.openai||'').trim();
  const preferProxy=!!APP_SETTINGS?.api_proxy?.enabled;
  const noClientKeys=(!AKEY && !OKEY);
  if(preferProxy || noClientKeys){
    // Best-effort: if proxy fails and we have client keys, fall through to direct mode.
    try{
      return await callNetlifyQuestionFunction(body);
    }catch(e){
      if(noClientKeys) throw e;
    }
  }
  // Try Anthropic first
  try {
    if(!AKEY) throw new Error('Anthropic key missing');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-api-key': AKEY,
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('Anthropic HTTP ' + r.status);
    const data = await r.json();
    console.log('✓ Answered by Anthropic');
    try{ data._provider='anthropic'; }catch(_e){}
    return data; // shape: { content: [{ text: "..." }] }

  } catch (anthropicErr) {
    console.warn('Anthropic failed:', anthropicErr.message, '— trying OpenAI...');

    if(!OKEY) throw anthropicErr;
    // Convert Anthropic request format → OpenAI format
    const openaiBody = {
      model: 'gpt-4o',
      max_tokens: body.max_tokens || 1100,
      temperature: body.temperature ?? 1.0,
      messages: body.messages, // same shape, works directly
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + OKEY,
          },
          body: JSON.stringify(openaiBody)
        });
        if (r.status === 429 || r.status === 503) {
          if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
        }
        if (!r.ok) throw new Error('OpenAI HTTP ' + r.status);
        const data = await r.json();
        console.log('✓ Answered by OpenAI (fallback)');

        // Normalize OpenAI response → Anthropic shape so rest of app works unchanged
        const out = {
          content: [{
            type: 'text',
            text: data.choices[0].message.content
          }]
        };
        out._provider='openai';
        return out;

      } catch (e) {
        if (attempt === retries) throw e;
        await sleep(1000 * (attempt + 1));
      }
    }
  }
}

async function callAPIProviderOnly(provider, body){
  const p=String(provider||'').toLowerCase();
  if(p==='proxy'){
    return await callNetlifyQuestionFunction(body);
  }
  const AKEY=String(ANTHROPIC_KEY_EMBEDDED||'').trim() || String(APP_SETTINGS?.api_keys?.anthropic||'').trim();
  const OKEY=String(OPENAI_KEY_EMBEDDED||'').trim() || String(APP_SETTINGS?.api_keys?.openai||'').trim();
  if(p==='anthropic'){
    if(!AKEY) throw new Error('Anthropic key missing');
    const r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true',
        'x-api-key':AKEY,
      },
      body:JSON.stringify(body)
    });
    if(!r.ok) throw new Error('Anthropic HTTP '+r.status);
    const data=await r.json();
    data._provider='anthropic';
    return data;
  }
  if(p==='openai'){
    if(!OKEY) throw new Error('OpenAI key missing');
    const openaiBody={
      model:'gpt-4o',
      max_tokens: body.max_tokens ?? 1100,
      temperature: body.temperature ?? 1.0,
      messages: body.messages,
    };
    const r=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+OKEY,
      },
      body:JSON.stringify(openaiBody)
    });
    if(!r.ok) throw new Error('OpenAI HTTP '+r.status);
    const data=await r.json();
    return { _provider:'openai', content:[{type:'text', text:String(data?.choices?.[0]?.message?.content ?? '')}] };
  }
  throw new Error('Unknown provider: '+p);
}

function sanitizeExplanation(expl, maxLines=7, maxChars=700){
  let s=String(expl||'').trim();
  if(!s) return s;
  // Remove explicit option-letter statements (we never want explanation to depend on A/B/C/D).
  s=s.replace(/\b(option\s*)?([ABCD])\b\s*(is|=|:)\s*(correct|answer)\b/ig,'the correct option');
  s=s.replace(/\b(correct|answer)\s*(option)?\s*(is|=|:|-)\s*\(?\s*([ABCD])\s*\)?\b/ig,'the correct option');
  const lines=s.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const clipped=lines.slice(0, maxLines).join('\n');
  return clipped.length>maxChars ? clipped.slice(0,maxChars).trim() : clipped;
}

function isLikelySectionMismatch(sub, q){
  const s=String(sub||'').trim();
  const stem=String(q?.question||'').toLowerCase();
  const topic=String(q?.topic||'').toLowerCase();
  const lrSignals=/\b(next in series|series|seating arrangement|blood relation|clock|calendar|coding[-\s]*decoding|syllogism|direction)\b/i;
  const quantSignals=/\b(kg|m\/s|velocity|force|ohm|capacitance|integral|derivative|probability|triangle|circle)\b/i;
  // Language sections must not turn into LR/Quant puzzles.
  const languageSections=new Set(['English','Language','SAT_RW','ACT_ENG','ACT_READ','IELTS_LISTEN','IELTS_READ','TOEFL_READ','TOEFL_LISTEN','GRE_VERB','GMAT_VERB','CAT_VARC','APT_VAR']);
  if(languageSections.has(s)){
    if(lrSignals.test(stem) || lrSignals.test(topic)) return true;
    if(quantSignals.test(stem) && !/\bpassage\b/i.test(stem)) return true;
  }
  return false;
}

function normalizeCorrectIndex(raw,n=4){
  const max=n-1;
  if(raw===undefined||raw===null)return 0;
  if(typeof raw==='number'&&Number.isFinite(raw)){
    const t=Math.trunc(raw);
    // Prefer 0-based indices {0..max} — generator JSON uses these. A legacy 1..n branch
    // would mis-read 2 as “second letter (B)” instead of “third choice (C)”.
    if(t>=0&&t<=max)return t;
    if(t>=1&&t<=n)return t-1;
  }
  const s=String(raw).trim();
  if(!s)return 0;
  const u=s.toUpperCase();
  if(u.length===1&&u>='A'&&u.charCodeAt(0)<65+n)return u.charCodeAt(0)-65;
  const p=parseInt(s.replace(/[^\d-]/g,''),10);
  if(!Number.isNaN(p)){
    if(p>=0&&p<=max)return p;
    if(p>=1&&p<=n)return p-1;
  }
  return 0;
}

function strHash32(str){
  let h=5381>>>0;
  const x=String(str||'');
  for(let i=0;i<x.length;i++)h=((h<<5)+h+x.charCodeAt(i))>>>0;
  return h>>>0;
}

function mulberry32(seed){
  let a=seed>>>0;
  return function(){
    let t=(a+=0x6d2b79f5)>>>0;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return((t^t>>>14)>>>0)/4294967296;
  };
}

function sanitizeSvgForExam(raw){
  let s=String(raw||'').trim();
  if(!s) return '';
  if(s.length>200000) s=s.slice(0,200000);
  s=s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi,'');
  s=s.replace(/<\/?(?:script|foreignObject|iframe|object|embed|audio|video|canvas|meta|link|base)[^>]*>/gi,'');
  s=s.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'');
  s=s.replace(/\bon\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'');
  s=s.replace(/\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,(m)=>/javascript:/i.test(m)?'':m);
  s=s.replace(/\sxlink:href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,(m)=>/javascript:/i.test(m)?'':m);
  s=s.replace(/javascript:/gi,'');
  s=s.replace(/<\?[\s\S]*?\?>/g,'');
  if(!/<svg[\s>/]/i.test(s)) return '';
  return s;
}
function coerceAllowedDiagramImageUrl(u){
  const s=String(u||'').trim();
  if(!s || s.length>500000) return null;
  if(/^https:\/\//i.test(s)){
    try{ const x=new URL(s); if(x.protocol!=='https:') return null; return s; }catch(_e){ return null; }
  }
  if(/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(s)){
    const i=s.indexOf(',');
    if(i<0) return null;
    const b64=s.slice(i+1);
    if(b64.length>2_200_000) return null;
    return s;
  }
  return null;
}
function normalizeQuestionDiagram(q){
  if(!q||typeof q!=='object') return;
  const examId=String((typeof E!=='undefined'&&E&&E.exam)||cfg?.exam||'BITSAT').trim()||'BITSAT';
  const indian=isIndianExamId(examId);
  const d=q.diagram;
  if(d==null||d===undefined){ delete q.diagram; return; }
  if(typeof d!=='object'){ delete q.diagram; return; }
  const caption=String(d.caption||'Diagram').trim()||'Diagram';
  const kind=String(d.kind||'ascii').toLowerCase();
  const minAscii=indian?14:20;
  if(kind==='ascii'){
    const ascii=String(d.ascii||'').trim();
    if(ascii.length<minAscii) delete q.diagram;
    else q.diagram={kind:'ascii',caption,ascii};
    return;
  }
  if(kind==='svg'){
    const raw=String(d.svg||d.ascii||'').trim();
    const svg=sanitizeSvgForExam(raw);
    const minSvg=indian?40:60;
    if(svg.length<minSvg) delete q.diagram;
    else q.diagram={kind:'svg',caption,svg};
    return;
  }
  if(kind==='image'||kind==='png'||kind==='jpg'||kind==='jpeg'||kind==='webp'||kind==='gif'){
    const url=coerceAllowedDiagramImageUrl(d.url||d.src||d.href||'');
    if(!url) delete q.diagram;
    else q.diagram={kind:'image',caption,url};
    return;
  }
  delete q.diagram;
}

function sanitizeApiSymbols(text){
  const supDigits={'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻'};
  function toSup10(n){ return String(n).split('').map(c=>supDigits[c]||c).join(''); }
  let t=String(text??'');
  if(!t) return t;
  t=t.replace(/v\^2/g,'v²').replace(/r\^2/g,'r²').replace(/r\^3/g,'r³');
  t=t.replace(/10\^(-?\d+)/g,(m,e)=>'10'+toSup10(e));
  t=t.replace(/\bpi\b/gi,'π');
  // Single-letter caret exponents (x^2, y^3) for API/bank text; (?<![A-Za-z0-9]) avoids sin^2 → si + n².
  t=t.replace(/(?<![A-Za-z0-9])([A-Za-z])\^(\d+)\b/g,(m,a,d)=>{
    const sup=toSup10(d);
    return sup?a+sup:m;
  });
  t=t.replace(/\bomega\b/gi,'ω');
  t=t.replace(/\blambda\b/gi,'λ');
  t=t.replace(/\balpha\b/gi,'α');
  t=t.replace(/\bbeta\b/gi,'β');
  t=t.replace(/\btheta\b/gi,'θ');
  t=t.replace(/\bsqrt\(/gi,'√(');
  t=t.replace(/\barcsin\b/gi,'sin⁻¹');
  t=t.replace(/\barccos\b/gi,'cos⁻¹');
  t=t.replace(/\barctan\b/gi,'tan⁻¹');
  t=t.replace(/\bcsc\b/gi,'cosec');
  t=t.replace(/m\/s²/g,'ms⁻²');
  t=t.replace(/m\/s\b/g,'ms⁻¹');
  t=t.replace(/J\/mol/g,'Jmol⁻¹');
  t=t.replace(/N\/m²/g,'Nm⁻²');
  t=t.replace(/-->/g,'→');
  t=t.replace(/<-->/g,'⇌');
  t=t.replace(/=>/g,'⇒');
  t=t.replace(/\btherefore\b/gi,'∴');
  t=t.replace(/\bbecause\b/gi,'∵');
  t=t.replace(/\binfinity\b/gi,'∞');
  return t;
}

function normalizeUnitSpacingText(s){
  // Display-only normalization: make "10g" and "10 g" render consistently as "10 g".
  // Keep conservative (units-only) so we don't touch arbitrary identifiers.
  const units='kg|mg|g|µg|ug|mol|km|cm|mm|m|ms|µs|us|s|hz|pa|j|w|v|a|c|f|ml|l|n';
  return String(s||'').replace(
    new RegExp(`\\b(\\d+(?:\\.\\d+)?)(?:\\s*)(${units})\\b`, 'gi'),
    (_m, num, unit) => `${num} ${unit}`
  );
}

function parseQ(text){
  let s=text.trim().replace(/^```(?:json)?[\r\n]*/,'').replace(/[\r\n]*```$/,'').trim();
  const a=s.indexOf('{'),b=s.lastIndexOf('}');
  if(a!==-1&&b>a)s=s.slice(a,b+1);
  const q=JSON.parse(s);
  if(!q.question||typeof q.question!=='string')throw new Error('No question');
  q.type=String(q.type||'MCQ').toUpperCase();
  if(q.type==='NAT'){
    q.answer=String(q.answer??q.correct_answer??q.correct??'').trim();
    if(!q.answer) throw new Error('Bad NAT answer');
    q.options=['0','1','2','3']; // placeholder for UI consistency
    q.correct=0;
  }else if(q.type==='MSQ'){
    if(!Array.isArray(q.options)||q.options.length<4)throw new Error('Bad options');
    q.options=q.options.slice(0,4).map(o=>normalizeUnitSpacingText(String(o).trim())||'Option');
    const arr=Array.isArray(q.correct_set)?q.correct_set:q.correct_answers;
    if(!Array.isArray(arr) || !arr.length) throw new Error('Bad MSQ correct_set');
    q.correct_set=[...new Set(arr.map(x=>normalizeCorrectIndex(x,4)))].sort((a,b)=>a-b);
    q.correct=q.correct_set[0]??0;
  }else{
    // MCQ default
    if(!Array.isArray(q.options)||q.options.length<4)throw new Error('Bad options');
    q.correct=normalizeCorrectIndex(q.correct,4);
    q.options=q.options.slice(0,4).map(o=>normalizeUnitSpacingText(String(o).trim())||'Option');
    // Rare: dual-correct MCQ (allowed only for language-style ambiguity)
    if(Array.isArray(q.correct_set) || Array.isArray(q.correct_answers)){
      const arr=Array.isArray(q.correct_set)?q.correct_set:q.correct_answers;
      const set=[...new Set((arr||[]).map(x=>normalizeCorrectIndex(x,4)))].sort((a,b)=>a-b);
      if(set.length>1) q.correct_set=set;
    }
  }
  q.question=sanitizeApiSymbols(String(q.question||''));
  if(Array.isArray(q.options)) q.options=q.options.map(o=>normalizeUnitSpacingText(sanitizeApiSymbols(String(o||''))));
  q.explanation=q.explanation||q.solution||'See BITSAT solution.';
  q.explanation=sanitizeApiSymbols(String(q.explanation));
  if(q.type==='NAT') q.answer=sanitizeApiSymbols(String(q.answer||''));
  // If dual-correct is present, never let heuristics silently collapse it.
  if(Array.isArray(q.correct_set) && q.correct_set.length>1){
    q.correct_set=[...new Set(q.correct_set.map(x=>normalizeCorrectIndex(x,4)))].sort((a,b)=>a-b);
    q.correct=q.correct_set[0]??q.correct;
  }
  q.difficulty=q.difficulty||'medium';
  q.topic=q.topic||'General';

  return reconcileCorrect(q);
}

function normalizeDualCorrectMCQ(q, subject){
  if(!q || typeof q!=='object') return q;
  if(String(q.type||'MCQ').toUpperCase()!=='MCQ') { delete q.correct_set; return q; }
  const arr=Array.isArray(q.correct_set)?q.correct_set:(Array.isArray(q.correct_answers)?q.correct_answers:null);
  if(!Array.isArray(arr) || !arr.length){ delete q.correct_set; return q; }
  const set=[...new Set(arr.map(x=>normalizeCorrectIndex(x,4)))].sort((a,b)=>a-b);
  if(set.length<=1){ delete q.correct_set; return q; }
  // Only allow for language-like sections (to prevent breaking exam patterns).
  const sub=String(subject||q.subject||'').trim();
  const allowed=new Set(['English','Language','SAT_RW','ACT_ENG','ACT_READ','IELTS_LISTEN','IELTS_READ','TOEFL_READ','TOEFL_LISTEN','GRE_VERB','GMAT_VERB','CAT_VARC','APT_VAR']);
  if(!allowed.has(sub)){ delete q.correct_set; return q; }
  // Must be exactly 2 indices; anything else is suspicious -> force single-correct.
  if(set.length!==2){ delete q.correct_set; return q; }
  q.correct_set=set;
  q.correct=set[0]??q.correct;
  return q;
}

function inferCorrectFromExplanation(expl){
  if(!expl) return null;
  const s=String(expl).replace(/\s+/g,' ').trim();
  if(!s) return null;
  // Prioritize explicit answer declarations.
  const patterns=[
    /\b(correct|answer)\s*(option)?\s*(is|=|:|-)\s*\(?\s*([ABCD])\s*\)?\b/i,
    /\boption\s*\(?\s*([ABCD])\s*\)?\s*(is|:)\s*correct\b/i,
    /\btherefore\s*,?\s*(the\s*)?(correct|answer)\s*(is|=|:)\s*\(?\s*([ABCD])\s*\)?\b/i,
  ];
  for(const re of patterns){
    const m=s.match(re);
    if(m){
      const letter=(m[4]||m[1]||m[5]||'').toUpperCase();
      const idx=letter.charCodeAt(0)-65;
      if(idx>=0&&idx<=3) return idx;
    }
  }
  return null;
}

function normalizeForMatch(s){
  return String(s||'')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g,"'") // curly quotes
    .replace(/[^a-z0-9'+\-*/=().,\s]/g,' ')     // keep common math/punct
    .replace(/\s+/g,' ')
    .trim();
}
function inferCorrectFromExplanationText(expl, options){
  if(!expl || !Array.isArray(options) || options.length<2) return null;
  const e=normalizeForMatch(expl);
  if(!e) return null;
  const opts=options.slice(0,4).map(o=>normalizeForMatch(o));

  // Split into sentences/clauses; prioritize those that claim correctness.
  const parts=e.split(/[.!?;\n]+/).map(x=>x.trim()).filter(Boolean);
  const keyParts=parts.filter(p=>/\b(correct|therefore|hence|thus|so)\b/.test(p));
  // Only scan "key" clauses; global matching is too error-prone (numbers, comparisons, contradictions).
  const scan=keyParts;

  function matchesIn(p){
    const hits=[];
    opts.forEach((o,idx)=>{
      if(!o) return;
      // Require whole-word-ish match for short options to avoid accidental substrings.
      if(o.length<=4){
        const re=new RegExp(`\\b${o.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i');
        if(re.test(p)) hits.push(idx);
      }else{
        if(p.includes(o)) hits.push(idx);
      }
    });
    return hits;
  }

  for(const p of scan){
    // Strong cue: "correct ... <optionText>"
    if(/\bcorrect\b/.test(p)){
      const hits=matchesIn(p);
      if(hits.length===1) return hits[0];
    }
    // Cue: "answer ... <optionText>"
    if(/\banswer\b/.test(p)){
      const hits=matchesIn(p);
      if(hits.length===1) return hits[0];
    }
  }
  return null;
}

function mentionedOptionIndicesInText(expl, options){
  if(!expl || !Array.isArray(options) || options.length<2) return [];
  const e=normalizeForMatch(expl);
  if(!e) return [];
  const opts=options.slice(0,4).map(o=>normalizeForMatch(o));
  const hits=[];
  opts.forEach((o,idx)=>{
    if(!o) return;
    // Short option values (e.g. "10 g") need boundary matching.
    if(o.length<=10){
      const re=new RegExp(`\\b${o.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')}\\b`,'i');
      if(re.test(e)) hits.push(idx);
    }else{
      if(e.includes(o)) hits.push(idx);
    }
  });
  return [...new Set(hits)];
}

function optionKeysForQuoteMatch(raw){
  const o=normalizeForMatch(raw);
  if(o.length<16) return [];
  const keys=new Set([o]);
  const noTrail=o.replace(/[.?!]+$/,'').trim();
  if(noTrail.length>=16) keys.add(noTrail);
  return [...keys];
}
// When the same explanation quotes the right answer and also pastes a wrong option to critique it,
// naive "longest substring wins" picks the wrong line. Score windows around each embedded option.
function sentimentAtQuotedKey(e, key, pos){
  const before=e.slice(Math.max(0, pos - 220), pos);
  const after=e.slice(pos, Math.min(e.length, pos + key.length + 160));
  const mid=e.slice(Math.max(0, pos - 220), Math.min(e.length, pos + 40));
  let s=0;
  if(/\bdemonstrates\s+correct\b/i.test(after)) s+=6;
  if(/\bcorrect\s+subject[\s-]?verb\b/i.test(after)) s+=5;
  if(/\bcorrectly\s+pairs\b/i.test(after)) s+=4;
  if(/\b(is\s+wrong|wrong\s+because|is\s+incorrect|not\s+grammatical)\b/i.test(after)) s-=5;
  if(/\b(fail(s|ed|ing)?)\b/i.test(before)) s-=5;
  if(/\b(wrong|incorrect)\b/i.test(before) && /\bbecause\b/i.test(before + after.slice(0, 40))) s-=3;
  if(/\boption\s*[1-4a-d]\b[^.]{0,120}\b(fail(s|ed|ing)?|wrong|incorrect)\b/i.test(mid)) s-=5;
  if(/\b(the sentence|the choice|correct\s+sentence)\b/i.test(before)) s+=3;
  if(/\b(pairs|agrees)\b/i.test(after) && !/\b(not|never|fails?)\b/i.test(after.slice(0, 60))) s+=2;
  return s;
}
function maxSentimentForQuotedOption(e, raw){
  const keys=optionKeysForQuoteMatch(raw);
  let best=-Infinity;
  for(const key of keys){
    if(!key || !e.includes(key)) continue;
    let p=0;
    while((p = e.indexOf(key, p)) !== -1){
      const sc=sentimentAtQuotedKey(e, key, p);
      if(sc > best) best=sc;
      p += 1;
    }
  }
  return best;
}
// When the explanation embeds one MCQ option verbatim, that text is stronger than JSON `correct`
// or a verifier guess. Fixes severe mismatches (e.g. solution quotes "would ... following evening"
// but the keyed answer was "will ... following evening").
function inferCorrectFromQuotedOptionText(expl, options){
  if(!expl || !Array.isArray(options) || options.length<2) return null;
  const e=normalizeForMatch(expl);
  if(!e) return null;
  const hits=[];
  for(let i=0;i<Math.min(4,options.length);i++){
    const raw=String(options[i]||'').trim();
    if(raw.length<16) continue;
    const keys=optionKeysForQuoteMatch(raw);
    if(!keys.length) continue;
    if(keys.some((k)=>e.includes(k))) hits.push(i);
  }
  if(hits.length===1) return hits[0];
  if(hits.length>1){
    let bestI=hits[0], bestS=-Infinity;
    for(const i of hits){
      const raw=String(options[i]||'').trim();
      const s=maxSentimentForQuotedOption(e, raw);
      if(s > bestS){
        bestS=s;
        bestI=i;
      }
    }
    if(bestS >= 2) return bestI;
    const scored=hits.map(i=>{
      const o=normalizeForMatch(String(options[i]||''));
      return{i, len:o.length};
    });
    scored.sort((a,b)=>b.len-a.len);
    const maxL=scored[0].len;
    const tops=scored.filter(x=>x.len===maxL);
    if(tops.length===1) return tops[0].i;
  }
  return null;
}

function reconcileCorrect(q) {
  if(!q || typeof q !== 'object') return q;
  q.type = String(q.type || 'MCQ').toUpperCase();
  if(Array.isArray(q.options))
    q.options = q.options.slice(0,4).map(o => normalizeUnitSpacingText(String(o).trim()) || 'Option');
  
  // Store AI's original answer — treat it as ground truth
  const aiCorrect = normalizeCorrectIndex(q.correct, 4);
  q.correct = aiCorrect;
  q.explanation = q.explanation || q.solution || '';

  if(q.type === 'NAT') { normalizeQuestionDiagram(q); return q; }

  // Normalize MSQ shape early (and avoid running MCQ heuristics on it).
  if(q.type === 'MSQ') {
    const arr = Array.isArray(q.correct_set) ? q.correct_set : q.correct_answers;
    if(Array.isArray(arr) && arr.length) {
      q.correct_set = [...new Set(arr.map(x => normalizeCorrectIndex(x,4)))].sort((a,b)=>a-b);
      q.correct = q.correct_set[0] ?? q.correct;
    } else {
      q.type = 'MCQ';
      delete q.correct_set;
    }
  }

  // Normalize rare dual-correct MCQ (language ambiguity only).
  normalizeDualCorrectMCQ(q, q.subject);
  const hasDual = Array.isArray(q.correct_set) && q.correct_set.length > 1;

  // ── NEW: Only override if heuristic is HIGH-CONFIDENCE ──
  // GUARD: never run heuristics on numeric subjects or dual-correct items.
  const numericSubjects = new Set(['Physics','Chemistry','Math','Biology',
    'SAT_MATH','ACT_MATH','GRE_QUANT','GMAT_QUANT','CAT_QA','APT_QA','GATE_MATH','GATE_CORE','GATE_GA']);
  const isNumeric = numericSubjects.has(String(q.subject || '').trim());
  if(!isNumeric && !hasDual) {
    const inferredByLetter = inferCorrectFromExplanation(q.explanation);
    if(inferredByLetter !== null) {
      q.correct = inferredByLetter;
    } else {
      // Only use text-match if it finds EXACTLY ONE option mentioned
      // AND the explanation contains a strong positive signal word near it
      const inferredByText = inferCorrectFromExplanationText(q.explanation, q.options || []);
      if(inferredByText !== null) {
        const expl = q.explanation.toLowerCase();
        const optText = (q.options[inferredByText] || '').toLowerCase().slice(0, 20);
        const nearCorrect = /\b(correct|therefore|hence|∴|best answer|right answer)\b/.test(
          expl.slice(Math.max(0, expl.indexOf(optText) - 80), expl.indexOf(optText) + 80)
        );
        if(nearCorrect) q.correct = inferredByText;
      }
    }
  }

  // Ensure dual-correct never gets collapsed.
  if(hasDual) {
    q.correct_set = [...new Set(q.correct_set.map(x => normalizeCorrectIndex(x,4)))].sort((a,b)=>a-b);
    q.correct = q.correct_set[0] ?? q.correct;
  }

  normalizeQuestionDiagram(q);
  return q;
}

// ══════════════════════════════════════════════
//  QUESTION BANK (Supabase + local fallback)
// ══════════════════════════════════════════════
function qFingerprint(q){
  try{
    const subj=String(q?.subject||'').trim();
    const topic=String(q?.topic||'').trim();
    const stem=String(q?.question||'').trim();
    const opts=(q?.options||[]).map(x=>String(x||'').trim()).join('|');
    return String(strHash32(`${subj}||${topic}||${stem}||${opts}`));
  }catch(_e){
    return String(Date.now());
  }
}

// Persistent anti-repeat across sessions (localStorage, per user + exam)
function seenKeyForExam(){
  const uid=String(USER?.id||'guest').trim()||'guest';
  const ex=String(cfg?.exam||E?.exam||'BITSAT').trim()||'BITSAT';
  return `seen_fp_${uid}_${ex}`;
}
function loadSeenSet(){
  try{
    const raw=localStorage.getItem(seenKeyForExam());
    const arr=safeJsonParse(raw,[]);
    const list=Array.isArray(arr)?arr:[];
    const s=new Set();
    list.slice(-4000).forEach(x=>{ if(x!=null) s.add(String(x)); });
    return s;
  }catch(_e){ return new Set(); }
}
function saveSeenSet(set){
  try{
    const arr=[...set].slice(-4000);
    localStorage.setItem(seenKeyForExam(), JSON.stringify(arr));
  }catch(_e){}
}
function rememberSeen(fp){
  if(!fp) return;
  if(!E._seenGlobal) E._seenGlobal=loadSeenSet();
  E._seenGlobal.add(String(fp));
  // Save occasionally (cheap throttle)
  const n=E._seenGlobal.size;
  if(n%7===0) saveSeenSet(E._seenGlobal);
}
function wasSeenBefore(fp){
  if(!fp) return false;
  if(!E._seenGlobal) E._seenGlobal=loadSeenSet();
  return E._seenGlobal.has(String(fp));
}
function loadLocalBank(){
  try{
    const raw=localStorage.getItem('question_bank_local');
    const arr=safeJsonParse(raw,[]);
    return Array.isArray(arr)?arr:[];
  }catch(_e){ return []; }
}
function saveLocalBank(arr){
  try{
    const max=Math.max(50, Number(APP_SETTINGS?.bank?.max_local)||600);
    const trimmed=arr.slice(-max);
    localStorage.setItem('question_bank_local', JSON.stringify(trimmed));
  }catch(_e){}
}
async function saveQuestionToBank(q){
  if(!q || !q.question || !Array.isArray(q.options) || q.options.length!==4) return;
  q=reconcileCorrect(q);
  const row={
    id:qFingerprint(q),
    exam: String(E?.exam || cfg?.exam || 'BITSAT'),
    subject:String(q.subject||'').trim()||null,
    topic:String(q.topic||'').trim()||null,
    difficulty:String(q.difficulty||'medium').toLowerCase(),
    question:String(q.question||'').trim(),
    options:q.options.slice(0,4).map(x=>String(x||'').trim()),
    correct:normalizeCorrectIndex(q.correct,4),
    explanation:String(q.explanation||'').trim(),
    diagram:q.diagram||null,
    created_by:USER?.id||null
  };
  // Local always (best-effort)
  try{
    const bank=loadLocalBank();
    const idx=bank.findIndex(x=>String(x?.id)===String(row.id));
    if(idx>=0) bank[idx]=row; else bank.push(row);
    saveLocalBank(bank);
  }catch(_e){}

  // Remote if table exists
  if(!sb) return;
  try{
    await sb.from('question_bank').upsert(row);
  }catch(_e){}
}
async function fetchBankQuestion(sub, topic, diff, salt32){
  const exam = String(E?.exam || cfg?.exam || 'BITSAT');

  const useLocal = () => {
    const bank = loadLocalBank()
      .filter(x => x && String(x.subject||'') === String(sub||'')
                     && (!x.exam || x.exam === exam));           // ← exam guard
    let pool = bank;
    if (topic) pool = pool.filter(x => String(x.topic||'') === String(topic));
    if (diff)  pool = pool.filter(x => String(x.difficulty||'') === String(diff).toLowerCase());
    if (!pool.length) pool = bank;
    const seen  = loadSeenSet();
    const fresh = pool.filter(x => x && !seen.has(String(x.id || qFingerprint(x))));
    if (fresh.length) pool = fresh;
    if (!pool.length) return null;
    const rand = mulberry32((salt32>>>0) ^ 0x85ebca6b);
    const pick = pool[Math.floor(rand() * pool.length)];
    return pick ? JSON.parse(JSON.stringify(pick)) : null;
  };

  if (!sb) return useLocal();
  try {
    // Pull 200-row window per exam+subject, pick client-side (avoids PostgREST RANDOM() issues)
    let q = sb.from('question_bank')
               .select('*')
               .eq('subject', sub)
               .eq('exam', exam)               // ← exam filter
               .limit(200);                    // ← bigger pool
    if (diff) q = q.eq('difficulty', String(diff).toLowerCase());
    const { data, error } = await q;
    if (error) return useLocal();
    let rows = (data || []).filter(Boolean);
    if (!rows.length) return useLocal();
    // Exclude already-seen questions this session
    const seen = loadSeenSet();
    const fresh = rows.filter(r => !seen.has(String(r.id || qFingerprint(r))));
    if (fresh.length) rows = fresh;
    // Topic preference — try to match, fall back to any row for this subject
    const topicMatch = topic
      ? rows.filter(r => String(r.topic||'') === String(topic))
      : [];
    const pool = topicMatch.length ? topicMatch : rows;
    const rand = mulberry32((salt32>>>0) ^ 0xc2b2ae35);
    return pool[Math.floor(rand() * pool.length)];
  } catch (_e) {
    return useLocal();
  }
}

function shuffleMCQ(q, salt32){
  if(!q||!Array.isArray(q.options)||q.options.length!==4) return q;
  const opts=q.options.slice(0,4).map(t=>String(t||''));
  const oldCorrect=normalizeCorrectIndex(q.correct,4);
  const perm=[0,1,2,3];
  const rand=mulberry32((salt32>>>0)^0x9e3779b1);
  for(let i=3;i>0;i--){
    const j=Math.floor(rand()*(i+1));
    [perm[i],perm[j]]=[perm[j],perm[i]];
  }
  q.options=perm.map(pi=>opts[pi]);
  q.correct=perm.indexOf(oldCorrect);
  return q;
}

function toSuperscript(s){
  /* Prefer U+2070–U+2079 for digits 0,4–9 (one font block); ¹²³ remain U+00B9,U+00B2,U+00B3 (no Unicode alternatives). Display layer unifyScriptDigitMarksToHtml() normalizes runs for HTML views. */
  const m={
    '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹',
    '+':'⁺','-':'⁻','(':'⁽',')':'⁾',
    'n':'ⁿ','i':'ⁱ'
  };
  let out='';
  for(const ch of String(s||'')){
    if(!(ch in m)) return null;
    out+=m[ch];
  }
  return out;
}

function toSubscript(s){
  const m={
    '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉',
    '+':'₊','-':'₋','(':'₍',')':'₎'
  };
  let out='';
  for(const ch of String(s||'')){
    if(!(ch in m)) return null;
    out+=m[ch];
  }
  return out;
}

function indianExamMathText(s){
  let t=String(s??'');
  if(!t) return t;

  // Strip common LaTeX wrappers that models often emit.
  t=t
    .replaceAll('\\(','').replaceAll('\\)','')
    .replaceAll('\\[','').replaceAll('\\]','')
    .replaceAll('$$','');

  // LaTeX → exam-friendly text (common patterns)
  t=t
    .replaceAll('\\left','')
    .replaceAll('\\right','')
    // spacing commands
    .replaceAll('\\,',' ')
    .replaceAll('\\;',' ')
    .replaceAll('\\!','')
    .replaceAll('\\quad',' ')
    .replaceAll('\\qquad',' ')
    // trig + log (remove backslash)
    .replace(/\\(sin|cos|tan|cot|sec|csc|log|ln)\b/gi,'$1')
    // greek letters
    .replaceAll('\\alpha','α').replaceAll('\\beta','β').replaceAll('\\gamma','γ').replaceAll('\\theta','θ')
    .replaceAll('\\phi','φ').replaceAll('\\omega','ω').replaceAll('\\pi','π').replaceAll('\\Delta','Δ')
    // \frac{a}{b} → a/b
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/gi,'$1/$2')
    // \sqrt{...} → √(...)
    .replace(/\\sqrt\s*\{([^}]*)\}/gi,'√($1)')
    // subscripts/superscripts: x_{2} or x_2, x^{2} or x^2
    .replace(/_\s*\{([^}]*)\}/g,'_$1')
    .replace(/\^\s*\{([^}]*)\}/g,'^$1');

  // Remove leftover braces (after handling frac/sqrt/super/sub).
  t=t.replace(/[{}]/g,'');

  // Common simple fractions → single glyph (international / compact). Indian UI uses stacked vinculum instead.
  const exId=String((typeof cfg!=='undefined'&&cfg&&cfg.exam)||(typeof E!=='undefined'&&E&&E.exam)||'BITSAT');
  if(!isIndianExamId(exId)){
    t=t
      .replace(/\b1\s*\/\s*2\b/g,'½')
      .replace(/\b1\s*\/\s*4\b/g,'¼')
      .replace(/\b3\s*\/\s*4\b/g,'¾')
      .replace(/\b1\s*\/\s*3\b/g,'⅓')
      .replace(/\b2\s*\/\s*3\b/g,'⅔');
  }

  // Common LaTeX operators → exam-friendly unicode.
  t=t.replaceAll('\\times','×').replaceAll('\\cdot','·');

  // Inverse trig written in Indian exams: sin⁻¹, cos⁻¹, tan⁻¹, etc.
  t=t.replace(/\b(sin|cos|tan|cot|sec|csc)\s*\^\s*\(?\s*-1\s*\)?\s*(?=\()/gi,(m,fn)=>{
    const sup=toSuperscript('-1');
    return sup ? `${String(fn)}${sup}` : m;
  });

  // sqrt(...) → √(...)
  t=t.replace(/sqrt\s*\(/gi,'√(');

  // Reaction arrows / equilibrium (common Indian exam style)
  t=t
    .replace(/<[-=]+>/g,'⇌')
    .replace(/[-=]+>/g,'→');

  // <= >= != and approx
  t=t
    .replaceAll('<=','≤')
    .replaceAll('>=','≥')
    .replaceAll('!=','≠')
    .replaceAll('~','≈');

  // Common unit/physics symbols
  t=t
    .replace(/\bOhm\b/g,'Ω')
    .replaceAll('mu','μ'); // best-effort; may appear in μm, μF etc.

  // Multiplication * → × (avoid touching markdown bullets like "* text")
  t=t.replace(/(\d|[A-Za-z\)\]])\s*\*\s*(\d|[A-Za-z\(\[])/g,'$1×$2');

  // Units with negative powers: m s^-2, cm^-1, s^-1 → m s⁻², cm⁻¹, s⁻¹
  t=t.replace(/\b([A-Za-zμΩ]+)\s*\^\s*\(?\s*([-+]?\d+)\s*\)?\b/g,(m,unit,exp)=>{
    // Keep common unit tokens short; avoid mangling variables like x^2 (handled below).
    if(String(unit).length>4) return m;
    const sup=toSuperscript(exp);
    return sup ? `${unit}${sup}` : m;
  });

  // Subscripts: x_2 → x₂ (digits only)
  t=t.replace(/([A-Za-z\)\]])_(\d+)/g,(m,base,num)=>{
    const sub=toSubscript(num);
    return sub ? `${base}${sub}` : m;
  });

  // Common constants in Indian exam typography: epsilon0, mu0 → ε₀, μ₀
  t=t
    .replace(/\bepsilon\s*0\b/gi,'ε₀')
    .replace(/\bmu\s*0\b/gi,'μ₀')
    .replace(/\bepsilon0\b/gi,'ε₀')
    .replace(/\bmu0\b/gi,'μ₀');

  // Degree symbol: 30° (best-effort when written as 30 deg / 30 degree)
  t=t.replace(/(\d)\s*(deg|degree|degrees)\b/gi,'$1°');

  // Chemistry: ionic charges like SO4^2-, Na^+, Cl^- → SO₄²⁻, Na⁺, Cl⁻ (when representable)
  t=t.replace(/([A-Za-z0-9\)\]])\s*\^\s*(\d+)\s*([+-])\b/g,(m,base,num,sign)=>{
    const sup=toSuperscript(`${num}${sign}`);
    return sup ? `${base}${sup}` : m;
  });
  t=t.replace(/([A-Za-z0-9\)\]])\s*\^\s*([+-])\b/g,(m,base,sign)=>{
    const sup=toSuperscript(sign);
    return sup ? `${base}${sup}` : m;
  });

  // Power: x^2, (x+1)^(10), a^(-1) → x², (x+1)¹⁰, a⁻¹ (when representable)
  t=t.replace(/([A-Za-z0-9\)\]])\s*\^\s*\(?\s*([-+]?\d+)\s*\)?/g,(m,base,exp)=>{
    const sup=toSuperscript(exp);
    return sup ? `${base}${sup}` : m;
  });
  // Single-letter exponent: x^n → xⁿ (supported letters only)
  t=t.replace(/([A-Za-z0-9\)\]])\s*\^\s*([ni])\b/g,(m,base,exp)=>{
    const sup=toSuperscript(exp);
    return sup ? `${base}${sup}` : m;
  });

  // Prefer π symbol where "pi" is used as standalone token.
  t=t.replace(/\bpi\b/gi,'π');

  // Chemistry: subscripts in formulas: H2SO4 → H₂SO₄, (NH4)2SO4 → (NH₄)₂SO₄
  // Conservative: only when digits directly follow an element symbol or ')'.
  t=t.replace(/(\b[A-Z][a-z]?)(\d+)/g,(m,el,num)=>{
    const sub=toSubscript(num);
    return sub ? `${el}${sub}` : m;
  });
  t=t.replace(/(\))(\d+)/g,(m,par,num)=>{
    const sub=toSubscript(num);
    return sub ? `${par}${sub}` : m;
  });

  // Compact common spacing around operators (optional but helps exam look)
  t=t.replace(/\s*×\s*/g,'×');
  return t;
}

function applyIndianExamMathStyle(q, sub){
  if(!q || typeof q!=='object') return q;
  const s=String(sub||q.subject||'');
  // Apply to quantitative sections; avoid language-heavy sections.
  const nonQuant=new Set(['English','Language','SAT_RW','ACT_ENG','ACT_READ','IELTS_LISTEN','IELTS_READ','TOEFL_READ','TOEFL_LISTEN','GRE_VERB','GMAT_VERB','CAT_VARC','APT_VAR']);
  if(nonQuant.has(s)) return q;
  // GATE sections are quantitative/aptitude; keep formatting there too.
  q.question=indianExamMathText(q.question);
  if(Array.isArray(q.options)) q.options=q.options.map(indianExamMathText);
  q.explanation=indianExamMathText(q.explanation);
  if(q.type==='NAT') q.answer=indianExamMathText(q.answer);
  return q;
}

// Diagrams are OPTIONAL and should be rare (BITSAT style).
// Kept for backward compatibility but intentionally does nothing now.
function ensureDiagram(q,_sub,_topic){
  return q;
}

function makePrompt(sub,topic,diff,seed,sesNum){
  const corrEx=((Number(seed)||0)%4+4)%4;
  const usageHint=DB_USED_TOPICS[sub+':'+topic]>1?` (This topic was seen ${DB_USED_TOPICS[sub+':'+topic]} times before — generate a DIFFERENT angle/problem type this time.)`:'';
  const examId=String(cfg?.exam||'BITSAT');
  const INDIAN_EXAMS=new Set(['BITSAT','JEE_MAIN','JEE_ADV','CUET','NEET','IISER_IAT','NEST','ISI','IPMAT','JIPMAT','CAT','GATE_2027']);
  const bitsatTrainerRaw=String(APP_SETTINGS?.prompt_training?.bitsat||'').trim();
  const bitsatTrainer=(examId==='BITSAT' && bitsatTrainerRaw) ? bitsatTrainerRaw.slice(0,2200) : '';

  function languageStyleForExam(ex){
    const e=String(ex||'BITSAT');
    if(e==='SAT' || e==='ACT' || e==='TOEFL' || e==='GRE' || e==='GMAT') return {dialect:'American English (US)', note:'Strict US standards. Use US spelling and usage consistently.'};
    if(e==='IELTS') return {dialect:'International English', note:'Accept UK/US variants, but be consistent within the question.'};
    // Default: Indian/UK leaning exams
    return {dialect:'British English (UK)', note:'Use UK spelling and common Indian exam usage consistently.'};
  }
  const langStyle=languageStyleForExam(examId);
  const englishVariant = INDIAN_EXAMS.has(examId)
    ? `ENGLISH STANDARD: Use British English throughout — spellings like "colour", "favour", "organised", "realise", "analyse", "centre", "defence", "practise" (verb), "licence" (noun). Never use American spellings.`
    : (examId==='SAT' || examId==='ACT' || examId==='GRE' || examId==='GMAT')
      ? `ENGLISH STANDARD: Use American English throughout — spellings like "color", "favor", "organized", "realize", "analyze", "center", "defense", "practice", "license".`
      : (examId==='IELTS')
        ? `ENGLISH STANDARD: Use British English throughout (IELTS style).`
        : (examId==='TOEFL')
          ? `ENGLISH STANDARD: Use American English throughout (TOEFL style).`
          : `ENGLISH STANDARD: Use standard academic English.`;
  const languageSections=new Set(['English','Language','SAT_RW','ACT_ENG','ACT_READ','IELTS_LISTEN','IELTS_READ','TOEFL_READ','TOEFL_LISTEN','GRE_VERB','GMAT_VERB','CAT_VARC','APT_VAR']);
  const langBlock = languageSections.has(String(sub||'')) ? `\nLANGUAGE STYLE (exam-specific):\n- Dialect: ${langStyle.dialect}\n- Consistency: ${langStyle.note}\n- ${englishVariant}\n- Avoid culturally obscure slang; prefer standard exam-appropriate wording.\n- If testing idioms/usage, ensure the correct option matches the chosen dialect.\n- IMPORTANT: Prefer EXACTLY ONE correct option. If (rarely) TWO options are both fully correct, then keep type as \"MCQ\" but include \"correct_set\" as [i,j] (2 indices). The explanation must explicitly justify BOTH correct options and state that either is acceptable.\n` : '';
  const indian=isIndianExamId(examId);
  const diagramPolicyIntl={
    Physics:`- Diagrams are RARE in Physics. Omit "diagram" unless the question truly needs one. If you include one for a graph, cycle, circuit, or ray path, prefer kind "svg" (inline <svg>) over ASCII; ASCII only for trivial one-line sketches.`,
    Chemistry:`- Do NOT include any diagram. Omit the "diagram" key entirely.`,
    Math:`- Do NOT include any diagram/graph. Omit the "diagram" key entirely (describe the figure in text if needed).`,
    English:`- Do NOT include any diagram/layout. Omit the "diagram" key entirely.`,
    LR:`- Diagrams/tables are COMMONER in LR. Include "diagram" only when it helps (seating/arrangements, Venn, small deduction table, directions map). Otherwise omit it.`
  };
  const diagramPolicyIndian={
    Physics:`- Indian exam pattern (BITSAT/JEE-style): include a "diagram" on roughly HALF of Physics questions when a figure is natural. For P–V / P–T / V–T plots, thermodynamic cycles, any labelled axes graph, ray optics, and circuit schematics: you MUST use kind "svg" (compact inline <svg>, exam-board clarity) — do NOT use ASCII line art for these. For very simple LR-style sketches only, ASCII is acceptable. Optional kind "image" + https URL if SVG is not feasible. Omit "diagram" for short fact-only recall.`,
    Chemistry:`- Indian exam pattern: include "diagram" when it helps (~35–50%): Fischer/Newman/cyclic structures, apparatus, energy profile, cell/electrode setup — ASCII, compact SVG, or https image as appropriate. Pure drill may omit diagram.`,
    Math:`- Prefer NO diagram; include only if a geometry/vectors sketch is essential (rare). Otherwise omit "diagram".`,
    English:`- Do NOT include any diagram. Omit the "diagram" key entirely.`,
    LR:`- Indian exam pattern: include "diagram" often (~55–70%): seating rows/circle, Venn, direction map, calendar/table, family tree, number pyramid, arrangement sketch.`,
    Biology:`- Indian exam pattern: include diagram when helpful (cell/cross-section/pathway/pedigree) using ASCII, compact SVG, or https image; omit if unnecessary.`,
    General:`- Include a clean diagram/table when it helps (puzzle, arrangement, data).`,
    APT_DILR:`- Include diagram/table often when the puzzle benefits from a sketch (charts, arrangements, routes).`,
    CAT_DILR:`- Include diagram/table when it helps (charts, arrangements, routes).`,
    GATE_CORE:`- Include diagram when a circuit/block diagram clarifies the question: ASCII, compact SVG, or https image (common in GATE-style stems).`,
    GATE_MATH:`- Diagram only if essential (rare).`,
    GATE_GA:`- Small diagram/table only when it helps (rare).`,
    ACT_SCI:`- Optional small ASCII figure for data/graph questions when helpful.`,
    CAT_QA:`- Prefer NO diagram; include only if a geometry sketch is essential (rare).`,
    APT_QA:`- Prefer NO diagram; include only if a geometry sketch is essential (rare).`,
    GRE_QUANT:`- Prefer NO diagram; include only if essential (rare).`,
    GMAT_QUANT:`- Prefer NO diagram; include only if essential (rare).`,
    ACT_MATH:`- Prefer NO diagram; include only if essential (rare).`,
    SAT_MATH:`- Prefer NO diagram; include only if essential (rare).`
  };
  const diagramPolicyLine=(indian?diagramPolicyIndian:diagramPolicyIntl)[sub]||(indian?diagramPolicyIndian.Physics:diagramPolicyIntl.Physics);
  const diagSize=indian?'12–36 lines, <= 56 chars/line (exam-paper readable)':'4–16 lines, <= 52 chars/line';
  const diagramBlock=[
    'DIAGRAM RULES (very important):',
    '- The "diagram" field is OPTIONAL. If omitted, do NOT include it as null.',
    diagramPolicyLine,
    '- If you include "diagram", use EXACTLY ONE of: (1) kind "ascii" + caption + ascii (monospace, no markdown fences), OR (2) kind "svg" + caption + svg as a single self-contained <svg>...</svg> (no scripts, no external URLs, no style= attributes), OR (3) kind "image" + caption + url as https://... to PNG/JPEG/WebP/GIF only (no http, no arbitrary domains if unsure—prefer svg).',
    `- For ASCII: keep it readable on screen: ${diagSize}. Use only printable ASCII + newlines.`,
    '- For SVG: use xmlns="http://www.w3.org/2000/svg", set viewBox, use stroke="currentColor" (and light fill if needed), <text> for axis/state labels, <line>/<path> for curves and cycle legs; keep under ~10k characters; stem must still state all numeric givens.',
    '- The question must still be fully understandable from the text; do not hide essential givens only in the figure.'
  ].join('\n');
  const physicsDiagramHint=(String(sub||'')==='Physics')
    ? `\nPHYSICS FIGURE PRIORITY:\n- Thermodynamics (P–V / P–T / V–T cycles, isotherms/isobars/isochores), waves on axes, circuits, ray diagrams, collision/FBD sketches with axes: output diagram.kind \"svg\" with one root <svg> (not ASCII grids).\n- Match labels in the SVG to the same letters/values referenced in the stem (e.g. states A,B,C; axis P, V, or T as appropriate).\n`
    : '';
  const gateBlock = (String(cfg?.exam||'')==='GATE_2027' || String(sub||'').startsWith('GATE_')) ? `\nGATE RULES:\n- Question type must be ONE of: \"MCQ\", \"MSQ\", \"NAT\".\n- For MCQ: include \"options\" (4) and \"correct\" in {0,1,2,3}.\n- For MSQ: include \"options\" (4) and \"correct_set\" as an array of 2-3 distinct indices.\n- For NAT: do NOT include \"options\"; include \"answer\" as a number or numeric string (no units).\n- \"marks\" must be 1 or 2.\n` : '';
  const bitsatBlock = bitsatTrainer ? `\nBITSAT PATTERN TRAINING (admin):\n${bitsatTrainer}\n` : '';
  const indianFracHint=indian?`\nFRACTIONS (Indian mock / NCERT style): Write ratios as plain a/b (e.g. 1/7, 2/7, π/4) or use \\frac{a}{b} in LaTeX (normalized to a/b). The live player renders these as stacked fractions with a horizontal bar. Reserve / only for SI compound units (m/s, kg/m³, J/K) — not for dividing two numbers.\n`:'';
  const symbolSystemBlock=[
    'SYMBOL SYSTEM (all subjects):',
    '',
    'MANDATORY SYMBOL RULES — INDIAN EXAM STANDARD:',
    '',
    'FRACTIONS:',
    '- Always render as proper fraction with bar',
    '- mv²/r means m×v² on top, r on bottom — NOT mv^2/r',
    '- nh/2πr means nh on top, 2πr on bottom — NOT nh/2*pi*r',
    '- GMm/r² means GMm on top, r² on bottom',
    '- ALL fractions in question AND all 4 options must use this style',
    '',
    'POWERS AND SUPERSCRIPTS:',
    '- v²  not  v^2',
    '- r³  not  r^3',
    '- 10⁻⁵  not  10^-5',
    '- e⁻ˣ  not  e^-x',
    '- sin²x  not  sin^2(x)',
    '- nᵗʰ  not  nth',
    '- 1s²2s²2p⁶  not  1s^2 2s^2 2p^6',
    '- H⁺  not  H+',
    '- SO₄²⁻  not  SO4 2-',
    '',
    'GREEK SYMBOLS — use actual unicode character ALWAYS:',
    '- π  not  pi or 3.14 or PI',
    '- ω  not  omega or w',
    '- λ  not  lambda or L',
    '- μ  not  mu or u',
    '- α  not  alpha or a',
    '- β  not  beta or b',
    '- θ  not  theta or Q',
    '- φ  not  phi',
    '- ε₀  not  epsilon naught or e0',
    '- μ₀  not  mu naught or u0',
    '- ρ  not  rho',
    '- τ  not  tau',
    '- ν  not  nu or v (for frequency)',
    '- η  not  eta',
    '- Δ  not  delta or D (for change)',
    '- Σ  not  sigma or S (for summation)',
    '- ∞  not  infinity',
    '- ∝  not  proportional to',
    '',
    'UNITS — negative superscript ALWAYS:',
    '- ms⁻¹  not  m/s or mps',
    '- ms⁻²  not  m/s²',
    '- Jmol⁻¹  not  J/mol',
    '- Jmol⁻¹K⁻¹  not  J/mol/K',
    '- Nm⁻²  not  N/m²',
    '- kgm⁻³  not  kg/m³',
    '- Wm⁻²  not  W/m²',
    '- Cs⁻¹  not  C/s',
    '- molL⁻¹  not  mol/L or M',
    '- Lmol⁻¹  not  L/mol',
    '',
    'VECTORS — bar notation only:',
    '- v̄  not  →v  or  v→  or  vec(v)',
    '- F̄  not  →F  or  F with arrow',
    '- ā, B̄, Ē, p̄  (overbar ALWAYS)',
    '- Unit vectors: î  ĵ  k̂  (hat notation)',
    '',
    'ROOTS — root symbol only:',
    '- √(3RT/M)  not  sqrt(3RT/M)  or  (3RT/M)^0.5',
    '- ∛x  not  x^(1/3)',
    '- √(μrg)  not  root(u.r.g)',
    '',
    'CHEMICAL EQUATIONS:',
    '- One-way reaction →  not  -->  or  =>',
    '- Reversible ⇌  not  <-->  or  =',
    '- State symbols (s) (l) (g) (aq)  always lowercase in brackets',
    '- 1s²2s²2p⁶3s¹  no spaces between subshells',
    '',
    'MATHEMATICAL NOTATION:',
    '- sin⁻¹x  not  arcsin(x)',
    '- cos⁻¹x  not  arccos(x)',
    '- tan⁻¹x  not  arctan(x)',
    '- cosec  not  csc',
    '- log x = log₁₀x  (base 10 is default in India)',
    '- ln x = logₑx  (natural log — always write ln NOT log)',
    '- |x|  for modulus  not  mod(x)',
    '- n!  for factorial',
    '- ⁿCᵣ  not  C(n,r)  or  nCr',
    '- ⁿPᵣ  not  P(n,r)  or  nPr',
    '- ∫₀^π  with limits as subscript/superscript',
    '- dy/dx  not  dy÷dx  or  d(y)/d(x)',
    '- ∂f/∂x  for partial derivatives',
    '- lim(x→a)  not  lim x->a',
    '- n ∈ I  not  n ∈ Z  (use I for integers in Indian exams)',
    '- ∀  for "for all"',
    '- ∃  for "there exists"',
    '- ∈  for "belongs to"',
    '- ⇒  for "implies"',
    '- ⟺  for "if and only if"',
    '',
    'SOLUTION STEPS NOTATION:',
    '- ∴  for Therefore  not  "therefore"  or  ".."',
    '- ∵  for Because  not  "because"  or  "::"',
    '- ⇒  for Hence/Implies  not  "=>"  or  "->"',
    '- ≈  for Approximately  not  "~"  or  "approx"',
    '- ≡  for Identical to',
    '- ≠  for Not equal to',
    '',
    'ANSWER OPTIONS FORMAT:',
    '- Always: (a)  (b)  (c)  (d) in the option TEXT when labeling in prose; JSON must still use the 4-string "options" array in order.',
    '- Never:  A.   B.   C.   D.  as the only label inside option strings (platform shows A–D separately).',
    '- Never:  1)   2)   3)   4)',
    '- Numerical options include units: 13 ms⁻¹  not  13 m/s',
    '- Fraction options use proper bar style in display',
    '',
    'GIVEN VALUES FORMAT:',
    '- [Take g = 10 ms⁻²]',
    '- (Given: R = 0.082 L atm K⁻¹ mol⁻¹)',
    '- [Use g = 10 ms⁻²]',
    '- Always in square or round brackets at end of question'
  ].join('\n');
  const englishLockBlock=[
    'ENGLISH & PUNCTUATION — ABSOLUTE LOCK — NEVER CHANGE THESE',
    '',
    'The following are NEVER converted to any other format under ANY circumstance in ANY subject:',
    '',
    '?   →  stays as  ?   (question mark in English text)',
    '.   →  stays as  .   (full stop)',
    ',   →  stays as  ,   (comma)',
    "'   →  stays as  '   (apostrophe)",
    '"   →  stays as  "   (quotation mark)',
    ':   →  stays as  :   (colon in English sentences)',
    ';   →  stays as  ;   (semicolon)',
    '-   →  stays as  -   (hyphen in words)',
    '!   →  stays as  !   (exclamation in English)',
    '( ) →  stays as  ( ) (brackets around English words)',
    '__  →  stays as  __________ (fill in the blank underline)',
    '',
    'THIS RULE APPLIES TO:',
    '- All English Proficiency questions',
    '- All Logical Reasoning question text',
    '- All instructions and directions text',
    '- All answer options written in plain English words',
    '- Passage text in comprehension questions',
    '- Idiom/phrase sentences',
    '',
    'EXAMPLES OF WHAT MUST NOT CHANGE:',
    '',
    '"By criticizing the local authorities, the journalist stirred a hornet\'s nest."',
    '→ Every punctuation stays exactly as above',
    '',
    '"2, 5, 10, 17, 26, ?"',
    '→ The ? stays as plain ? — it means find next term',
    '',
    '"MANGO : FRUIT :: ROSE : ?"',
    '→ The : and ? stay as plain ASCII characters',
    '',
    '"Despite being an expert, she remained __________ and always credited her team."',
    '→ The __________ stays as underscores, comma stays',
    '',
    '"X told Y, \'Though I am the son of your father, you are not my brother.\' How is X related to Y?"',
    '→ Every \' , . ? stays exactly as written'
  ].join('\n');
  const finalSymbolCheckBlock=[
    'FINAL SYMBOL CHECK BEFORE RETURNING JSON:',
    '✓ All fractions have proper numerator/denominator bar',
    '✓ All powers are superscript (v² not v^2)',
    '✓ All Greek letters are actual symbols (π not pi)',
    '✓ All units use negative superscript (ms⁻¹ not m/s)',
    '✓ All vectors use bar notation (v̄ not →v)',
    '✓ All roots use √ symbol (not sqrt)',
    '✓ English punctuation ? . , \' unchanged',
    '✓ Options formatted as (a) (b) (c) (d) in text where appropriate; JSON "options" array of 4 strings',
    '✓ Return ONLY valid JSON — no markdown fences',
    '✓ correct index is 0, 1, 2, or 3 only'
  ].join('\n');
  const diagramExample=(String(sub||'')==='Physics')
    ? `Example MCQ with Physics-style SVG diagram (same pattern for MSQ/NAT):\n{\"type\":\"MCQ\",\"question\":\"...\",\"diagram\":{\"kind\":\"svg\",\"caption\":\"P–V diagram\",\"svg\":\"<svg xmlns=\\\"http://www.w3.org/2000/svg\\\" viewBox=\\\"0 0 220 160\\\"><line x1=\\\"40\\\" y1=\\\"120\\\" x2=\\\"200\\\" y2=\\\"120\\\" stroke=\\\"currentColor\\\"/><line x1=\\\"40\\\" y1=\\\"40\\\" x2=\\\"40\\\" y2=\\\"120\\\" stroke=\\\"currentColor\\\"/><text x=\\\"105\\\" y=\\\"145\\\" font-size=\\\"11\\\">V</text><text x=\\\"18\\\" y=\\\"85\\\" font-size=\\\"11\\\">P</text><path d=\\\"M 70 100 L 150 60 L 150 100 Z\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.5\\\"/></svg>\"},\"options\":[\"...\",\"...\",\"...\",\"...\"],\"correct\":${corrEx},\"explanation\":\"...\",\"difficulty\":\"${diff}\",\"topic\":\"${topic}\"}`
    : `Example MCQ with diagram (same pattern for MSQ/NAT):\n{\"type\":\"MCQ\",\"question\":\"...\",\"diagram\":{\"kind\":\"ascii\",\"caption\":\"...\",\"ascii\":\"...\\n...\"},\"options\":[\"...\",\"...\",\"...\",\"...\"],\"correct\":${corrEx},\"explanation\":\"...\",\"difficulty\":\"${diff}\",\"topic\":\"${topic}\"}`;
  const numericStemSubjects=new Set(['Physics','Chemistry','Math']);
  const numericSelfCheckBlock=numericStemSubjects.has(String(sub||'').trim())?`\nNUMERIC / PROBABILITY SELF-CHECK (mandatory before JSON):\n- Recompute every sum, product, and ratio implied by the stem from first principles.\n- For probability/Bayes: write P(event) as an explicit sum of positive terms, reduce to one rational/decimal, then form conditionals.\n- Pick EXACTLY ONE final numerical result; it must match EXACTLY one of the four option strings after simplification.\n- Do NOT write contradictory lines like \"answer is 10 g... however correct option is 20 g\". If your working suggests two different values, STOP and recompute until consistent.\n- Only state the final result once, and it must match the option text you intend to mark correct.\n- If your correct value is not present among options, rewrite the stem numbers and/or regenerate all four options so the invariant holds.\n- For counting/isomer questions: the exact integer must appear verbatim as one option string.\n`:'';
  const mcqInvariantBlock='\nMCQ INVARIANT (basic principle — every MCQ):\n- Unless this exam type explicitly allows MSQ/dual-correct (see LANGUAGE STYLE / MSQ rules above), exactly ONE of the four option strings must be unambiguously correct for the stem as written.\n- If the correct answer is not among the four options, or two or more options are equally correct when only one is allowed, do NOT ship that draft: rewrite stem, data, or all four options until the invariant holds, then output valid JSON.\n';
  const footer=`\n${symbolSystemBlock}\n\n${englishLockBlock}\n\n${finalSymbolCheckBlock}\n\nCRITICAL RULES:\n- Return ONLY valid JSON. No markdown fences.\n${gateBlock}${langBlock}\n- Explanation must be crisp (3–7 lines) and must justify ONLY the correct answer.\n- Explanation must NOT rely on labels like \"Option A/B/C/D\" or fixed positions; refer to the correct option by its exact text content.\n- Explanation must state EXACTLY ONE final answer and it must match the chosen option text; never mention a second conflicting value.\n- All 4 options must be distinct and plausible (if applicable).\n- Wrong options must reflect common student mistakes.\n${mcqInvariantBlock}${numericSelfCheckBlock}\n${diagramBlock}${physicsDiagramHint}${indianFracHint}\n${bitsatBlock}- Uniqueness: seed=${seed}, session=${sesNum}${usageHint}\n\nJSON shapes:\nMCQ:\n{\"type\":\"MCQ\",\"question\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"correct\":${corrEx},\"explanation\":\"...\",\"difficulty\":\"${diff}\",\"topic\":\"${topic}\"}\nMSQ:\n{\"type\":\"MSQ\",\"question\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"correct_set\":[0,2],\"explanation\":\"...\",\"marks\":2,\"difficulty\":\"${diff}\",\"topic\":\"${topic}\"}\nNAT:\n{\"type\":\"NAT\",\"question\":\"...\",\"answer\":\"12.5\",\"explanation\":\"...\",\"marks\":2,\"difficulty\":\"${diff}\",\"topic\":\"${topic}\"}\n\nIf (and only if) a diagram helps, add a \"diagram\" object using ONE of:\n- {\"kind\":\"ascii\",\"caption\":\"...\",\"ascii\":\"line1\\nline2\"}\n- {\"kind\":\"svg\",\"caption\":\"...\",\"svg\":\"<svg xmlns=\\\"http://www.w3.org/2000/svg\\\" viewBox=\\\"0 0 200 120\\\">...</svg>\"}\n- {\"kind\":\"image\",\"caption\":\"...\",\"url\":\"https://example.com/figure.png\"}\n${diagramExample}`;
  const prompts={
    Physics:`You are a BITSAT Physics expert with 15 years of paper-setting experience.\nGenerate 1 original Physics MCQ:\nTopic: ${topic}\nDifficulty: ${diff} — ${DS[diff]}\nSeed: ${seed} | Session: ${sesNum}\nRules: Use SPECIFIC numbers, include units, no trivial "which law states" questions, wrong options = classic calculation errors.\nFigures: If the problem needs a process or graph diagram (P–V/P–T cycles, circuits, rays, labelled axes), include diagram.kind \"svg\" with a clear compact <svg> — not ASCII box drawings.\nTypography (important): Do NOT use LaTeX or \\(...\\). Do NOT use ^ or *. Use ²/³/ⁿ for powers when possible, √( ) for square root, × for multiplication, and π for pi.${footer}`,
    Chemistry:`You are a BITSAT Chemistry expert in Physical and Organic chemistry.\nGenerate 1 original Chemistry MCQ:\nTopic: ${topic}\nDifficulty: ${diff} — ${DS[diff]}\nSeed: ${seed} | Session: ${sesNum}\nRules: Use real compound names, specify reagents/conditions for organic, include all given data for numerical.\nTypography (important): Do NOT use LaTeX or \\(...\\). Do NOT use ^ or *. Use ²/³/ⁿ for powers when possible, √( ) for square root, × for multiplication, and π for pi.${footer}`,
    Math:`You are a BITSAT Mathematics expert in JEE-level problem design.\nGenerate 1 original Math MCQ:\nTopic: ${topic}\nDifficulty: ${diff} — ${DS[diff]}\nSeed: ${seed} | Session: ${sesNum}\nRules: State all conditions explicitly.\nTypography (important): Do NOT use LaTeX or \\(...\\). Do NOT use ^ or *. Use ²/³/ⁿ for powers when possible, √( ) for square root, × for multiplication, and π for pi.${footer}`,
    English:`You are a BITSAT English expert following British English standards.\n${englishVariant}\nGenerate 1 original English MCQ for topic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Use British English spellings and idioms throughout. When testing vocabulary/grammar, use British conventions only. Wrong options should be plausible British-context near-synonyms. Do NOT mention A/B/C/D in the explanation.${footer}`,
    LR:`You are a BITSAT Logical Reasoning expert.\nGenerate 1 original LR MCQ for topic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Self-consistent data, EXACTLY ONE valid answer, original patterns beyond +2/+3.${footer}`,
    Biology:`You are a NEET Biology expert (NCERT-aligned).\nGenerate 1 original Biology MCQ:\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: NCERT-style conceptual clarity; include any necessary facts in the stem; exactly one correct option.${footer}`,
    // CUET extensions
    Language:`You are an exam English/Language expert.\n${englishVariant}\nGenerate 1 original language MCQ for CUET.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Follow the specified English standard consistently. Do NOT mention A/B/C/D. Provide a correct explanation.${footer}`,
    General:`You are an aptitude & reasoning expert for CUET General Aptitude Test.\nGenerate 1 original aptitude MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Data sufficiency / logical reasoning / basic quant; exactly one correct answer.${footer}`
    ,
    // International + aptitude exam prompts (strict MCQ-only)
    SAT_RW:`You are a Digital SAT Reading & Writing question writer.\nGenerate 1 original SAT RW MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: No negative marking context; exactly one correct answer; keep to SAT-style grammar/reading tasks.${footer}`,
    SAT_MATH:`You are a Digital SAT Math question writer.\nGenerate 1 original SAT Math MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: SAT-style, calculator-neutral phrasing, exactly one correct answer.${footer}`,
    ACT_ENG:`You are an ACT English question writer.\nGenerate 1 original ACT English MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Grammar/rhetoric, exactly one correct answer.${footer}`,
    ACT_MATH:`You are an ACT Math question writer.\nGenerate 1 original ACT Math MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: 5 answer choices are typical, but this platform uses 4 — adapt to 4 plausible options, exactly one correct.${footer}`,
    ACT_READ:`You are an ACT Reading question writer.\nGenerate 1 original ACT Reading MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Provide a short passage inside the stem if needed (keep it brief), exactly one correct answer.${footer}`,
    ACT_SCI:`You are an ACT Science question writer.\nGenerate 1 original ACT Science MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Data interpretation; embed a small table/description in the stem; exactly one correct answer.${footer}`,
    IELTS_LISTEN:`You are an IELTS Listening practice question writer.\nGenerate 1 objective listening-style MCQ (simulate an audio scenario in text).\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    IELTS_READ:`You are an IELTS Reading practice question writer.\nGenerate 1 objective reading-style MCQ (include a short passage in the stem if needed).\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    TOEFL_READ:`You are a TOEFL iBT Reading practice question writer.\nGenerate 1 objective reading MCQ (include a short passage in the stem if needed).\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    TOEFL_LISTEN:`You are a TOEFL iBT Listening practice question writer.\nGenerate 1 objective listening MCQ (simulate audio in text).\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    GRE_VERB:`You are a GRE Verbal practice question writer.\nGenerate 1 GRE Verbal MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Text completion / sentence equivalence / RC style; exactly one correct answer (adapt to 4 options).${footer}`,
    GRE_QUANT:`You are a GRE Quant practice question writer.\nGenerate 1 GRE Quant MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    GMAT_VERB:`You are a GMAT Focus Verbal practice question writer.\nGenerate 1 Verbal MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Critical reasoning / RC style; exactly one correct answer.${footer}`,
    GMAT_QUANT:`You are a GMAT Focus Quant practice question writer.\nGenerate 1 Quant MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    GMAT_DI:`You are a GMAT Focus Data Insights practice question writer.\nGenerate 1 DI MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Table/graph interpretation in text; exactly one correct answer.${footer}`,
    CAT_VARC:`You are a CAT VARC practice question writer.\nGenerate 1 VARC MCQ (RC/VA).\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    CAT_DILR:`You are a CAT DILR practice question writer.\nGenerate 1 DILR MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Include all data in stem; exactly one correct answer.${footer}`,
    CAT_QA:`You are a CAT Quant practice question writer.\nGenerate 1 QA MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    APT_QA:`You are an aptitude Quant question writer.\nGenerate 1 MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    APT_DILR:`You are an aptitude DILR question writer.\nGenerate 1 MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`,
    APT_VAR:`You are an aptitude Verbal question writer.\nGenerate 1 MCQ.\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Exactly one correct answer.${footer}`
    ,
    GATE_GA:`You are a GATE 2027 General Aptitude question writer.\nGenerate 1 original GATE objective question.\nSection: General Aptitude\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Allowed types: MCQ/MSQ/NAT. Use marks 1 or 2. For NAT: answer must be numeric only. No ambiguous MSQ.${footer}`,
    GATE_MATH:`You are a GATE 2027 Engineering Mathematics question writer.\nGenerate 1 original GATE objective question.\nSection: Engineering Mathematics\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Allowed types: MCQ/MSQ/NAT. Use marks 1 or 2. For NAT: answer must be numeric only.${footer}`,
    GATE_CORE:`You are a GATE 2027 paper-setter (core subject).\nGenerate 1 original GATE objective question.\nSection: Core\nTopic: ${topic}\nDifficulty: ${diff}\nSeed: ${seed} | Session: ${sesNum}\nRules: Allowed types: MCQ/MSQ/NAT. Use marks 1 or 2. Keep MSQ unambiguous (2-3 correct only when clearly provable).${footer}`
  };
  return prompts[sub]||prompts.Physics;
}

// ══ FALLBACK BANK ══
const FB={
  Physics:[
    {question:"A body of mass 5 kg moving at 10 m/s has a 20 N force applied for 3 s. Final velocity?",options:["16 m/s","22 m/s","12 m/s","30 m/s"],correct:1,explanation:"F×t=m×(v-u) → 20×3=5×(v-10) → v=22 m/s",difficulty:"medium",topic:"Newton Laws"},
    {question:"A projectile launched at 30° with 40 m/s. Max height? (g=10)",options:["20 m","40 m","80 m","10 m"],correct:0,explanation:"H=u²sin²θ/2g=1600×0.25/20=20 m",difficulty:"medium",topic:"Kinematics 2D & Projectile"},
    {question:"A wire of resistance R stretched to 2L. New resistance?",options:["R/2","2R","4R","R/4"],correct:2,explanation:"R=ρL/A, volume constant so A→A/2. New R=ρ(2L)/(A/2)=4R",difficulty:"medium",topic:"Current Electricity & Ohm Law"},
    {question:"In Young's DSE fringe width=0.3 mm. Slit separation halved, λ doubled. New fringe width?",options:["0.6 mm","1.2 mm","0.15 mm","2.4 mm"],correct:1,explanation:"β=λD/d. New β=(2λ)D/(d/2)=4β=1.2 mm",difficulty:"hard",topic:"Wave Optics - Interference"}
  ],
  Chemistry:[
    {question:"pH of 0.1M CH₃COOH + 0.1M CH₃COONa buffer (pKa=4.74)?",options:["3.74","4.74","5.74","7.00"],correct:1,explanation:"Henderson-Hasselbalch: pH=pKa+log([A⁻]/[HA])=4.74+0=4.74",difficulty:"medium",topic:"Ionic Equilibrium pH & Buffers"},
    {question:"Which reagent oxidises primary alcohol to aldehyde ONLY (not acid)?",options:["KMnO₄/H⁺","K₂Cr₂O₇/H₂SO₄","PCC in CH₂Cl₂","Jones reagent"],correct:2,explanation:"PCC is mild oxidant stopping at aldehyde stage.",difficulty:"medium",topic:"Aldehydes Ketones - Nucleophilic Addition"},
    {question:"Osmotic pressure of 0.1M NaCl at 27°C (R=0.082)?",options:["0.82 atm","1.64 atm","4.92 atm","2.46 atm"],correct:2,explanation:"π=iMRT=2×0.1×0.082×300=4.92 atm",difficulty:"medium",topic:"Colligative Properties"}
  ],
  Math:[
    {question:"∫₀^(π/2) sin²x dx equals?",options:["π/2","π/4","1","π/8"],correct:1,explanation:"Using sin²x=(1-cos2x)/2: [x/2-sin2x/4]₀^(π/2)=π/4",difficulty:"medium",topic:"Definite Integration & Properties"},
    {question:"Number of diagonals in a 10-sided convex polygon?",options:["35","40","45","50"],correct:0,explanation:"Diagonals=n(n-3)/2=10×7/2=35",difficulty:"easy",topic:"Permutations & Combinations"},
    {question:"If P(A)=0.6, P(B)=0.4, P(A∩B)=0.2, find P(A|B)?",options:["0.5","0.33","0.75","0.6"],correct:0,explanation:"P(A|B)=P(A∩B)/P(B)=0.2/0.4=0.5",difficulty:"easy",topic:"Probability & Bayes Theorem"}
  ],
  English:[
    {question:"Choose the word most similar to 'EPHEMERAL':",options:["Eternal","Transient","Ancient","Substantial"],correct:1,explanation:"Ephemeral=lasting briefly. Transient is the closest synonym.",difficulty:"medium",topic:"Synonyms in Context"},
    {question:"The idiom 'to burn the midnight oil' means:",options:["Waste energy","Work late into the night","Celebrate excessively","Cause destruction"],correct:1,explanation:"Refers to staying up late working or studying.",difficulty:"easy",topic:"Idioms & Phrases"}
  ],
  LR:[
    {question:"Next in series: 2, 5, 10, 17, 26, ?",options:["35","37","36","38"],correct:1,explanation:"Differences: 3,5,7,9,11 (odd+2). 26+11=37",difficulty:"easy",topic:"Number Series - Arithmetic"},
    {question:"Ravi is 7th from left and 13th from right in a row. Total students?",options:["18","19","20","21"],correct:1,explanation:"Total=7+13-1=19",difficulty:"easy",topic:"Seating Arrangement - Linear"},
    {question:"Clock at 3:15. Angle between hands?",options:["0°","7.5°","15°","22.5°"],correct:1,explanation:"Min hand=90°, Hour hand=90+7.5=97.5°. Diff=7.5°",difficulty:"hard",topic:"Clock & Calendar"}
  ]
};
function getFallback(sub,qi){
  const pool=FB[sub]||FB.Physics;
  const idx=((E.seed*13+qi*7+E.sesNum*3)%pool.length+pool.length)%pool.length;
  const o={...pool[idx],subject:sub};
  o.question=sanitizeApiSymbols(String(o.question||''));
  if(Array.isArray(o.options)) o.options=o.options.map(x=>sanitizeApiSymbols(String(x||'')));
  o.explanation=sanitizeApiSymbols(String(o.explanation||''));
  return o;
}

// ══════════════════════════════════════════════
//  QUESTION GEN: concurrency + prefetch (avoid 100+ parallel API calls)
// ══════════════════════════════════════════════
async function acquireQGenSlot(){
  const maxSlots=Math.max(1, Math.min(4, Number(APP_SETTINGS?.gen_concurrency??2)));
  if(!E._genConc) E._genConc={active:0,max:maxSlots,q:[]};
  E._genConc.max=maxSlots;
  while(E._genConc.active>=E._genConc.max){
    await new Promise(r=>E._genConc.q.push(r));
  }
  E._genConc.active++;
}
function releaseQGenSlot(){
  if(!E._genConc) return;
  E._genConc.active=Math.max(0,E._genConc.active-1);
  const r=E._genConc.q.shift();
  if(r) r();
}
async function boundedGenQ(sub,qi){
  await acquireQGenSlot();
  try{ return await genQ(sub,qi); }
  finally{ releaseQGenSlot(); }
}
function prefetchAhead(centerIdx){
  if(!E||!E.subList||!cfg) return;
  const total=Number(cfg.count)||0;
  const ahead=Math.max(2, Math.min(10, Number(APP_SETTINGS?.prefetch_ahead??6)));
  for(let a=1;a<=ahead;a++){
    const j=centerIdx+a;
    if(j>=total) break;
    if(E.qs[j]) continue;
    ensureQuestionGenerated(j).catch(()=>{});
  }
}

// ══════════════════════════════════════════════
//  GENERATE QUESTION
// ══════════════════════════════════════════════
// Numeric / reasoning MCQs often look consistent while still wrong; always run the
// answer-key verifier once for these sections (not only when letter-mismatch heuristics fire).
const MCQ_ALWAYS_VERIFY_SUBJECTS=new Set(['Physics','Chemistry','Math','LR']);
const STEM_NUMERIC_SELF_CHECK=new Set(['Physics','Chemistry','Math']);

function applyVerifierFixToQ(q, fixed){
  if(!q||!fixed||!fixed.explanation) return;
  if(Array.isArray(fixed.correct_set)&&fixed.correct_set.length===2){
    q.correct_set=fixed.correct_set;
    q.correct=fixed.correct_set[0]??q.correct;
  }else{
    delete q.correct_set;
    q.correct=fixed.correct;
  }
  const isDual=Array.isArray(q.correct_set) && q.correct_set.length>1;
  q.explanation=sanitizeExplanation(String(fixed.explanation||'').trim(), isDual ? 12 : 7, isDual ? 1100 : 700);
}

async function runVerifierPassesOnQ(q, sub, topic, providerHint){
  const subKey=String(sub||'').trim();
  const stemRound=MCQ_ALWAYS_VERIFY_SUBJECTS.has(subKey);
  const strictNum=stemRound && STEM_NUMERIC_SELF_CHECK.has(subKey);
  applyVerifierFixToQ(q, await verifyAndFixMCQViaAPI(q, sub, topic, providerHint, { stemStrict: strictNum }));
  if(!stemRound) return;
  const c1=normalizeCorrectIndex(q.correct,4);
  applyVerifierFixToQ(q, await verifyAndFixMCQViaAPI(q, sub, topic, providerHint, { stemStrict: strictNum, recheck: true, priorIndex: c1 }));
  const c2=normalizeCorrectIndex(q.correct,4);
  if(c1!==c2){
    applyVerifierFixToQ(q, await verifyAndFixMCQViaAPI(q, sub, topic, providerHint, { stemStrict: strictNum, tiebreak: true, indexA: c1, indexB: c2 }));
    const c3=normalizeCorrectIndex(q.correct,4);
    if(c3!==c1 && c3!==c2) throw new Error('STEM verify unstable');
  }
}

async function genQ(sub,qi){
  const topic=pickTopic(sub,qi);
  const diff=getAdaptDiff(qi);
  const seed=((E.seed*1000+qi*97+E.sesNum*31)%999983+1);
  const shuffleSalt=strHash32(`${E.seed}|${qi}|${sub}|${topic}`);

  const apiRatio=Math.max(0,Math.min(1,Number(APP_SETTINGS?.gen_ratio?.api ?? 1.0)));
  const bankRatio=Math.max(0,Math.min(1,Number(APP_SETTINGS?.gen_ratio?.bank ?? (1-apiRatio))));
  const bankEnabled=!!APP_SETTINGS?.bank?.enabled && bankRatio>0;
  const haveAnyKey=!!String(APP_SETTINGS?.api_keys?.anthropic||'').trim() || !!String(APP_SETTINGS?.api_keys?.openai||'').trim();
  // In production we use Netlify Functions, so keys don't exist on the device.
  // Do not pre-block generation based on browser keys; let callAPI() decide.

  // Bank-first when configured or when API keys missing.
  const roll=Math.random();
  const tryBank = bankEnabled && (roll < bankRatio || !haveAnyKey);
  if(tryBank){
    const bq=await fetchBankQuestion(sub, topic, diff, shuffleSalt);
    if(bq && bq.question && Array.isArray(bq.options)){
      const q0=reconcileCorrect({...bq, subject:sub});
      const isDual0=Array.isArray(q0.correct_set) && q0.correct_set.length>1;
      q0.explanation=sanitizeExplanation(q0.explanation, isDual0 ? 12 : 7, isDual0 ? 1100 : 700);
      // Ensure bank content also follows diagram policy.
      stripDiagramBySubject(q0, sub, `${E.seed}|bank|${qi}`);
      const q=shuffleMCQ(q0,shuffleSalt);
      const isDual=Array.isArray(q.correct_set) && q.correct_set.length>1;
      q.explanation=sanitizeExplanation(q.explanation, isDual ? 12 : 7, isDual ? 1100 : 700);
      const preBank=normalizeCorrectIndex(q.correct,4);
      const subKey=String(sub||'').trim();
      const bankNeedsAutoFix = needsAutoFix(q, sub);   // layout/symbol fix only, no API
      if (bankNeedsAutoFix) {
        // reconcileCorrect already ran above; just apply math style
      }
      const bankVerifierOk = true;   // bank rows passed 7-layer gate at insert time

      if(!bankVerifierOk){
        // Do not serve unverified bank rows for STEM; fall through to live generation.
      } else {
        // Bank row failed safety gate — respect gen_ratio setting
        const bankOnly = Number(APP_SETTINGS?.gen_ratio?.bank ?? 0) >= 1.0
                      && Number(APP_SETTINGS?.gen_ratio?.api  ?? 1) <= 0;
        if (bankOnly) {
          // Bank is exhausted or all rows failed gate for this slot — use static fallback
          const fb = getFallback(sub, qi);
          if (fb) {
            applyIndianExamMathStyle(fb, sub);
            if (diff === 'easy') E.easyC++; else if (diff === 'hard') E.hardC++; else E.medC++;
            return fb;
          }
        }
        // Otherwise fall through to live API as normal
      }
  }
  try{
    // Anti-duplicate inside a session: retry a few times with tweaked seeds.
    if(!E._seen) E._seen={};
    let lastErr=null;
    for(let attempt=0; attempt<5; attempt++){
      const seed2=((seed + attempt*7919) % 999983 + 1);
      const salt2=strHash32(`${shuffleSalt}|a${attempt}|${Date.now()%997}`);
      const maxTok=(String(sub)==='Physics')?1500:((String(sub)==='Math')?1300:1100);
      const genTemp=STEM_NUMERIC_SELF_CHECK.has(String(sub||'').trim())?0.55:(MCQ_ALWAYS_VERIFY_SUBJECTS.has(String(sub||'').trim())?0.62:1.0);
      const data=await callAPI({model:MDL,max_tokens:maxTok,temperature:genTemp,messages:[{role:'user',content:makePrompt(sub,topic,diff,seed2,E.sesNum+1)}]});
      const rawText=data?.content?.[0]?.text;
      if(typeof rawText!=='string'||!String(rawText).trim()){
        throw new Error('Question AI returned an unexpected response shape (no text). Check Netlify function logs.');
      }
      const q=shuffleMCQ(reconcileCorrect(parseQ(rawText)),salt2);
      q._provider=String(data?._provider||'')||null;
      q.subject=sub;
      const isDual=Array.isArray(q.correct_set) && q.correct_set.length>1;
      q.explanation=sanitizeExplanation(q.explanation, isDual ? 12 : 7, isDual ? 1100 : 700);
      stripDiagramBySubject(q, sub, `${seed2}|api|${qi}`);
      if(isLikelySectionMismatch(sub,q)) { lastErr=new Error('Section mismatch'); continue; }
      const preCorrect=normalizeCorrectIndex(q.correct,4);
      const hadVerifierPath=MCQ_ALWAYS_VERIFY_SUBJECTS.has(String(sub||'').trim())||needsAutoFix(q, sub);
      // Professional-grade safeguard: prevent wrong learning due to mismatched answer/explanation.
      // STEM sections always get one verifier pass; language sections already do via needsAutoFix.
      if(hadVerifierPath){
        try{
          await runVerifierPassesOnQ(q, sub, topic, q._provider);
        }catch(e){
          // Never ship unverified content for English or STEM when verification was required.
          if(sub==='English'||MCQ_ALWAYS_VERIFY_SUBJECTS.has(String(sub||'').trim())) { lastErr=e; continue; }
        }
      }

      // If still inconsistent (or verifier couldn't fix), retry for English.
      const mustRetryOnMismatch=new Set(['English','Language','SAT_RW','ACT_ENG','ACT_READ','IELTS_LISTEN','IELTS_READ','TOEFL_READ','TOEFL_LISTEN','GRE_VERB','GMAT_VERB','CAT_VARC','APT_VAR','Physics','Chemistry','Math','LR']);
      if(mustRetryOnMismatch.has(sub) && isClearlyInconsistent(q)){
        lastErr=new Error('QA mismatch after verification; retrying');
        continue;
      }

      // Ensure the correct option index is well-distributed.
      // Even if a model/verifier tends to prefer a specific index, a uniform shuffle makes
      // the final `correct` effectively random across 0..3.
      try{
        const salt3=strHash32(`${salt2}|postfix|${Date.now()%997}|${seed2}`);
        shuffleMCQ(q, salt3);
      }catch(_e){}

      applyIndianExamMathStyle(q, sub);
      enqueueIfDoubtful(q, sub, { hadVerifierPath, preVerifierCorrect:preCorrect }, { seed:E.seed, sesNum:E.sesNum+1, qi });

      // Hard safety gate: do not serve invalid/degenerate questions.
      if(!isQuestionSafeToServe(q) || isClearlyInconsistent(q)){
        lastErr=new Error('Unsafe question draft; retrying');
        continue;
      }

      const fp=qFingerprint(q);
      // Prevent repeats across sessions for this user+exam (best-effort).
      if(wasSeenBefore(fp)){
        lastErr=new Error('Repeat across sessions, retrying');
        continue;
      }
      if(E._seen[fp]){
        lastErr=new Error('Duplicate question generated, retrying');
        continue;
      }
      E._seen[fp]=1;
      if(diff==='easy')E.easyC++;else if(diff==='hard')E.hardC++;else E.medC++;
      // Keep saving for admin analytics, but bank is not used for serving questions.
      saveQuestionToBank(q);
      rememberSeen(fp);
      return q;
    }
    throw lastErr || new Error('Could not generate a unique question');
  }catch(err){
    console.warn(`[Q${qi+1}|${sub}] API fail:`,err.message?.slice(0,80));
    // STRICT API-ONLY: do not serve fallback/bank questions.
    throw err;
  }
}

// Expose retry helper for inline onclick buttons
window.retryQuestionAt=retryQuestionAt;

function userSafeTechError(err){
  const msg=String(err?.message||err||'');
  if(/Missing Authorization|Invalid or expired session|401/i.test(msg)){
    return 'Login session expired. Please sign out, sign in again, then retry.';
  }
  if(/No provider keys|No provider keys configured|OpenAI key missing|Anthropic key missing|key missing on server/i.test(msg)){
    return 'Question AI is not configured on the server. In Netlify: Site settings → Environment variables — set ANTHROPIC_KEY and/or OPENAI_KEY for the generate-question function.';
  }
  if(/Auth validation misconfigured/i.test(msg)){
    return 'Question API cannot validate login (Supabase URL/anon key on Netlify). Check SUPABASE_URL and SUPABASE_ANON_KEY match the same Supabase project as this app.';
  }
  if(/Server function failed \(404\)|endpoint not found|not found.*function|invalid JSON.*wrong URL/i.test(msg)){
    return 'Question API was not found. Confirm the site is deployed on Netlify with Functions, or set api_proxy.base_url / QUESTION_PROXY_ORIGIN to the origin that hosts /.netlify/functions/generate-question.';
  }
  if(/OpenAI HTTP 401|Anthropic HTTP 401/i.test(msg)){
    return 'Question AI key is invalid or expired on the server.';
  }
  if(/OpenAI HTTP 429|Anthropic HTTP 429/i.test(msg)){
    return 'Question AI is rate-limited. Please retry after a minute.';
  }
  if(/Anthropic HTTP|OpenAI HTTP/i.test(msg)){
    return 'The AI provider rejected or failed the request (see browser console / Netlify logs). Retry shortly; if it persists, check model access and API keys.';
  }
  if(/Cannot reach question API|Failed to fetch|NetworkError|Load failed/i.test(msg)){
    return msg.length<220?msg:'Cannot reach the question API. Check your connection and that Netlify Functions are deployed.';
  }
  if(/invalid JSON|HTML instead of JSON|unexpected response shape|Bad options|No question|Unexpected token|JSON\.parse/i.test(msg)){
    return 'The question service returned data this app could not parse. Retry once; if it keeps happening, check Netlify function logs.';
  }
  if(/Verifier rejected|STEM verify unstable/i.test(msg)){
    return 'A safety check on the generated question failed. Click Retry to generate again.';
  }
  if(/timed out|timeout|AbortError/i.test(msg)){
    return 'Question generation timed out. Please retry.';
  }
  const cleaned=msg.replace(/Bearer\s+[^\s]+/gi,'Bearer …').replace(/<[^>]{0,200}>/g,'').trim().slice(0,200);
  if(cleaned.length>12) return cleaned+(msg.length>200?'…':'');
  return 'Some technical issue — contact administrator.';
}

async function retryQuestionAt(idx){
  try{
    if(!E || !E.subList || !E.subList[idx]) throw new Error('Session not ready');
    setLoading(true,`Retrying Q${idx+1}…`,'Regenerating question');
    // Force a fresh regeneration for this index.
    if(!E._pendingGen) E._pendingGen={};
    delete E._pendingGen[idx];
    const q=await boundedGenQ(E.subList[idx], idx);
    E.qs[idx]=q;
    navLoaded(idx);
    renderQ(idx);
  }catch(e){
    console.warn('Retry failed:', e?.message||e);
    const safe=userSafeTechError(e);
    setLoading(true,'Technical issue',safe);
    showToast(safe,'error');
  }
}

// ══════════════════════════════════════════════
//  START EXAM
// ══════════════════════════════════════════════
async function startExam(){
  if(cfg.subjects.length===0){showToast('Select at least one subject','error');return;}
  const r=examRules();
  if(r.id==='CUET' && (cfg.cuet?.domains||[]).length!==3){showToast('CUET needs exactly 3 domain subjects.','error');return;}
  const btn=document.getElementById('startBtn');
  btn.disabled=true;btn.textContent='Preparing…';
  const seed=Date.now()%999983+1;
  E={subList:[],qs:[],ans:{},mks:{},tt:{},rev:{},cur:0,correct:0,wrong:0,score:0,startT:Date.now(),tInt:null,tLeft:120,sesNum:DB_SESSIONS.length,seed,tu:[],easyC:0,medC:0,hardC:0,_seen:{}, exam:r.id, _genConc:{active:0,max:2,q:[]}};
  E.subList=buildSubList();
  E.qs=new Array(cfg.count).fill(null);
  syncExamUiAttr();
  showScreen('s-exam');
  buildNav();
  setLoading(true,'Generating Q1…',`Unique seed · ${r.name} standard`);
  try{
    E.qs[0]=await boundedGenQ(E.subList[0],0);
    renderQ(0);
    prefetchAhead(0);
  }catch(e){
    console.warn('Start exam generation failed:', e?.message||e);
    const safe=userSafeTechError(e);
    setLoading(true,'Technical issue',safe+` Click Retry.`);
    // Replace loader with a retry CTA (no secrets in UI)
    const load=document.getElementById('qLoad');
    if(load){
      load.innerHTML=`<div style="text-align:center"><div class="ititle" style="margin-bottom:6px">Some technical issue</div><div class="ibody" style="color:var(--t2);margin-bottom:12px">${escapeHtml(safe)}</div><button class="btn btn-p" onclick="retryQuestionAt(0)">Retry</button></div>`;
    }
    showToast(safe,'error');
    btn.disabled=false;btn.textContent='Launch Exam →';
    return;
  }
  if(!E._pendingGen) E._pendingGen={};
  if(!E._renderTok) E._renderTok=0;
  // Do NOT fan-out genQ for every index (e.g. 130 parallel calls) — that causes 429s, cold-start pileups,
  // and timeouts. Sliding-window prefetch runs from renderQ + prefetchAhead(0) after Q1.
  btn.disabled=false;btn.textContent='Launch Exam →';
}

function ensureQuestionGenerated(idx){
  if(!E) return Promise.reject(new Error('Session missing'));
  if(E.qs && E.qs[idx]) return Promise.resolve(E.qs[idx]);
  if(!E._pendingGen) E._pendingGen={};
  if(!E._pendingGen[idx]){
    E._pendingGen[idx]=boundedGenQ(E.subList[idx], idx)
      .then(q=>{E.qs[idx]=q; navLoaded(idx); return q;})
      .catch(e=>{delete E._pendingGen[idx]; throw e;});
  }
  return E._pendingGen[idx];
}

// ══════════════════════════════════════════════
//  RENDER QUESTION
// ══════════════════════════════════════════════
async function renderQ(idx){
  if(!E) return;
  if(!E._renderTok) E._renderTok=0;
  const tok=++E._renderTok; // used to ignore stale async renders
  E.cur=idx;
  navHighlight(idx);
  document.getElementById('progFill').style.width=((idx+1)/cfg.count*100)+'%';
  document.getElementById('tb-qnum').textContent=`Q ${idx+1}/${cfg.count}`;
  document.getElementById('qPanel').scrollTop=0;
  if(!E.qs[idx]){
    setLoading(true,`Loading Q${idx+1}…`,'Generating in background');
    try{
      // Start generation if it isn't already running, then await it with a timeout.
      await Promise.race([
        ensureQuestionGenerated(idx),
        (async()=>{ await sleep(90000); throw new Error('timeout'); })()
      ]);
    }catch(e){
      if(tok!==E._renderTok) return; // user navigated away; ignore
      console.warn(`Q${idx+1} not generated in time`, e?.message||e);
      const safe=userSafeTechError(e);
      setLoading(true,`Technical issue`,safe+` Click Retry.`);
      const load=document.getElementById('qLoad');
      if(load){
        load.innerHTML=`<div style="text-align:center"><div class="ititle" style="margin-bottom:6px">Some technical issue</div><div class="ibody" style="color:var(--t2);margin-bottom:12px">${escapeHtml(safe)}</div><button class="btn btn-p" onclick="retryQuestionAt(${idx})">Retry Q${idx+1}</button></div>`;
      }
      showToast(safe,'error');
      return;
    }
  }
  if(tok!==E._renderTok) return; // stale render; don't overwrite UI
  setLoading(false);
  const q=E.qs[idx];const sub=q.subject||E.subList[idx];const diff=(q.difficulty||'medium').toLowerCase();
  const tb=document.getElementById('tb-subj');tb.textContent=sub;tb.className='tb-badge '+(TC[sub]||'tb-phy');
  document.getElementById('qnumLbl').textContent=`Q${idx+1}`;
  const qt=document.getElementById('qTag');qt.textContent=sub;qt.className='q-tag '+(QT[sub]||'qt-phy');
  const dd=document.getElementById('dDot');dd.className='diff-dot '+(diff==='easy'?'dd-easy':diff==='hard'?'dd-hard':'dd-med');
  document.getElementById('dLbl').textContent=diff.charAt(0).toUpperCase()+diff.slice(1);
  document.getElementById('topicChip').textContent=q.topic||'';
  const qTextEl=document.getElementById('qText');
  if(qTextEl) qTextEl.innerHTML=examRichTextHtml(q.question);
  const diag=document.getElementById('qDiag');
  const dh=document.querySelector('#qDiag .qdiag-h');
  const pre=document.getElementById('qDiagPre');
  const media=document.getElementById('qDiagMedia');
  if(diag&&dh&&pre){
    const d=q.diagram;
    pre.textContent='';
    pre.style.display='';
    if(media){ media.style.display='none'; media.innerHTML=''; }
    let shown=false;
    if(d&&typeof d==='object'){
      const kind=String(d.kind||'ascii').toLowerCase();
      if(kind==='ascii'&&d.ascii){
        dh.textContent=String(d.caption||'Diagram');
        pre.textContent=String(d.ascii||'');
        shown=true;
      }else if(kind==='svg'&&d.svg){
        dh.textContent=String(d.caption||'Diagram');
        pre.style.display='none';
        if(media){
          const clean=sanitizeSvgForExam(d.svg);
          if(clean){
            media.innerHTML=clean;
            media.style.display='block';
            shown=true;
          }
        }
      }else if((kind==='image'||kind==='png'||kind==='jpg'||kind==='jpeg'||kind==='webp'||kind==='gif')&&(d.url||d.src)){
        const url=coerceAllowedDiagramImageUrl(d.url||d.src);
        if(url&&media){
          dh.textContent=String(d.caption||'Diagram');
          pre.style.display='none';
          const im=document.createElement('img');
          im.className='qdiag-img';
          im.src=url;
          im.alt=String(d.caption||'Figure');
          im.loading='lazy';
          im.decoding='async';
          im.referrerPolicy='no-referrer';
          media.appendChild(im);
          media.style.display='block';
          shown=true;
        }
      }
    }
    if(shown) diag.classList.add('show');
    else diag.classList.remove('show');
  }
  const ol=document.getElementById('optsList');
  if(!ol){console.error('optsList missing from DOM');return;}
  ol.innerHTML='';
  const qType=String(q.type||'MCQ').toUpperCase();
  const labs=['A','B','C','D'];
  if(qType==='NAT'){
    const wrap=document.createElement('div');
    wrap.style.display='flex';
    wrap.style.gap='10px';
    wrap.style.flexWrap='wrap';
    const inp=document.createElement('input');
    inp.className='inp';
    inp.id='natInp';
    inp.placeholder='Enter numeric answer (NAT)';
    inp.inputMode='decimal';
    inp.style.flex='1';
    inp.style.minWidth='160px';
    const btn=document.createElement('button');
    btn.className='btn btn-p';
    btn.textContent=(E.ans[idx]!==undefined)?'Locked':'Submit';
    btn.disabled=E.ans[idx]!==undefined;
    btn.onclick=()=>submitNAT(idx);
    wrap.appendChild(inp);
    wrap.appendChild(btn);
    ol.appendChild(wrap);
    if(E.ans[idx]!==undefined) inp.value=String(E.ans[idx]||'');
  }else if(qType==='MSQ'){
    const chosen=Array.isArray(E.ans[idx])?E.ans[idx]:[];
    (q.options||[]).slice(0,4).forEach((opt,i)=>{
      const b=document.createElement('button');
      const picked=chosen.includes(i);
      b.className='opt'+(E.ans[idx]!==undefined?' locked':'')+(picked?' picked':'');
      b.innerHTML=`<span class="olbl">${labs[i]}</span><span class="opt-txt">${examRichTextHtml(opt)}</span>`;
      b.onclick=()=>toggleMSQPick(idx,i);
      ol.appendChild(b);
    });
    const row=document.createElement('div');
    row.style.display='flex';row.style.gap='10px';row.style.justifyContent='flex-end';row.style.marginTop='10px';row.style.flexWrap='wrap';
    const submit=document.createElement('button');
    submit.className='btn btn-p';
    submit.textContent=(E.ans[idx]!==undefined)?'Locked':'Submit MSQ';
    submit.disabled=E.ans[idx]!==undefined;
    submit.onclick=()=>submitMSQ(idx);
    row.appendChild(submit);
    ol.appendChild(row);
  }else{
    (q.options||[]).slice(0,4).forEach((opt,i)=>{
      const b=document.createElement('button');
      b.className='opt'+(E.ans[idx]!==undefined?' locked':'');
      b.innerHTML=`<span class="olbl">${labs[i]}</span><span class="opt-txt">${examRichTextHtml(opt)}</span>`;
      if(E.ans[idx]===i)b.classList.add('picked');
      b.onclick=()=>pick(idx,i);
      ol.appendChild(b);
    });
  }
  if(E.ans[idx]!==undefined){doReveal(idx);document.getElementById('expBody').innerHTML=examRichTextHtml(q.explanation||'');document.getElementById('expBox').style.display='block';document.getElementById('nextBtn').style.display='inline-flex';}
  else{document.getElementById('expBox').style.display='none';document.getElementById('nextBtn').style.display='none';}
  const chBtn=document.getElementById('chBtn');
  const isMCQ=String(q.type||'MCQ').toUpperCase()==='MCQ';
  const hasMultiCorrect=Array.isArray(q.correct_set) && q.correct_set.length>1;
  // Challenge flow expects exactly 1 correct answer; hide when multi-correct is allowed.
  if(chBtn) chBtn.style.display=(E.ans[idx]!==undefined && isMCQ && !hasMultiCorrect)?'inline-flex':'none';
  prefetchAhead(idx);
  startTimer(idx);
}

function pick(qIdx,optIdx){
  if(E.ans[qIdx]!==undefined)return;
  E.ans[qIdx]=optIdx;
  const q=E.qs[qIdx];
  const r=examRules();
  const corrSet = (Array.isArray(q?.correct_set) && q.correct_set.length)
    ? new Set((q.correct_set||[]).map(x=>normalizeCorrectIndex(x,4)))
    : null;
  if(r.id==='GATE_2027'){
    // GATE MCQ marking: negative only for MCQ; mark weight is 1 or 2
    const marks=Number(q.marks||1);
    const ok=corrSet ? corrSet.has(optIdx) : (optIdx===q.correct);
    const neg=marks===2 ? (-2/3) : (-1/3);
    const delta=ok ? marks : neg;
    if(ok) E.correct++; else E.wrong++;
    E.score+=delta;
    E.mks[qIdx]=delta;
  }else{
    const ok=corrSet ? corrSet.has(optIdx) : (optIdx===q.correct);
    if(ok){E.correct++;E.score+=r.correct;E.mks[qIdx]=r.correct;}else{E.wrong++;E.score+=r.wrong;E.mks[qIdx]=r.wrong;}
  }
  updateTopScore();doReveal(qIdx);
  const dualNote = (Array.isArray(q.correct_set) && q.correct_set.length > 1 && corrSet && corrSet.has(optIdx))
    ? `<div style="margin-bottom:8px;padding:6px 10px;border-radius:6px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.22);font-size:12px;color:#4ade80;font-weight:600;">
        ✓ Both options ${q.correct_set.map(i=>['A','B','C','D'][normalizeCorrectIndex(i,4)]).join(' and ')} are accepted for this question.
       </div>` : '';
  document.getElementById('expBody').innerHTML=dualNote + examRichTextHtml(q.explanation||'');
  document.getElementById('expBox').style.display='block';
  document.getElementById('nextBtn').style.display='inline-flex';
  const chBtn=document.getElementById('chBtn');
  if(chBtn){
    const hasMultiCorrect=Array.isArray(q.correct_set) && q.correct_set.length>1;
    chBtn.style.display=(!hasMultiCorrect)?'inline-flex':'none';
  }
  setNavState(qIdx,'ans');stopTimer();E.tt[qIdx]=120-E.tLeft;
}

function toggleMSQPick(qIdx,optIdx){
  if(E.ans[qIdx]!==undefined) return;
  const cur=new Set(Array.isArray(E._msq?.[qIdx])?E._msq[qIdx]:[]);
  if(cur.has(optIdx)) cur.delete(optIdx); else cur.add(optIdx);
  if(!E._msq) E._msq={};
  E._msq[qIdx]=[...cur].sort((a,b)=>a-b);
  // re-render just selection state
  const q=E.qs[qIdx];
  const ol=document.getElementById('optsList');
  if(!q||!ol) return;
  const btns=[...ol.querySelectorAll('button.opt')];
  btns.forEach((b,i)=>{b.classList.toggle('picked', cur.has(i));});
}

function submitMSQ(qIdx){
  if(E.ans[qIdx]!==undefined) return;
  const q=E.qs[qIdx];
  const picked=(E._msq?.[qIdx]||[]).slice(0,4).map(Number).filter(x=>Number.isFinite(x));
  E.ans[qIdx]=picked;
  const r=examRules();
  const marks=Number(q.marks||1);
  const corr=[...new Set((q.correct_set||[]).map(x=>normalizeCorrectIndex(x,4)))].sort((a,b)=>a-b);
  const ok=(picked.length===corr.length && picked.every((v,i)=>v===corr[i]));
  const delta= ok ? marks : 0; // no negative for MSQ
  if(ok) E.correct++; else E.wrong++;
  E.score+=delta;
  E.mks[qIdx]=delta;
  updateTopScore();doReveal(qIdx);
  document.getElementById('expBody').innerHTML=examRichTextHtml(q.explanation||'');
  document.getElementById('expBox').style.display='block';
  document.getElementById('nextBtn').style.display='inline-flex';
  setNavState(qIdx,'ans');stopTimer();E.tt[qIdx]=120-E.tLeft;
}

function _natEqual(userAns, correctAns){
  const a=String(userAns||'').trim();
  const b=String(correctAns||'').trim();
  if(!a||!b) return false;
  const na=Number(a), nb=Number(b);
  if(Number.isFinite(na) && Number.isFinite(nb)){
    const tol=Math.max(1e-6, Math.abs(nb)*1e-4); // relative tolerance
    return Math.abs(na-nb) <= tol;
  }
  return a===b;
}

function submitNAT(qIdx){
  if(E.ans[qIdx]!==undefined) return;
  const q=E.qs[qIdx];
  const inp=document.getElementById('natInp');
  const val=String(inp?.value||'').trim();
  if(!val){showToast('Enter a numeric answer.','error');return;}
  E.ans[qIdx]=val;
  const marks=Number(q.marks||1);
  const ok=_natEqual(val, q.answer);
  const delta= ok ? marks : 0; // no negative for NAT
  if(ok) E.correct++; else E.wrong++;
  E.score+=delta;
  E.mks[qIdx]=delta;
  updateTopScore();doReveal(qIdx);
  document.getElementById('expBody').innerHTML=examRichTextHtml(q.explanation||'');
  document.getElementById('expBox').style.display='block';
  document.getElementById('nextBtn').style.display='inline-flex';
  setNavState(qIdx,'ans');stopTimer();E.tt[qIdx]=120-E.tLeft;
}

// ══════════════════════════════════════════════
//  CHALLENGE FLOW (AI adjudication + score adjust)
// ══════════════════════════════════════════════
let __CH={qIdx:null,pick:null};
function openChallenge(){
  const qIdx=E.cur;
  if(E.ans[qIdx]===undefined){showToast('Answer first, then challenge.','error');return;}
  __CH={qIdx, pick:null};
  document.getElementById('chReason').value='';
  ['A','B','C','D'].forEach((l,i)=>{
    const b=document.getElementById('chOpt'+l);
    if(b) b.className='btn';
  });
  const m=document.getElementById('challengeModal');
  if(m){m.style.display='flex';}
}
function closeChallenge(){
  const m=document.getElementById('challengeModal');
  if(m) m.style.display='none';
  __CH={qIdx:null,pick:null};
}
function setChallengePick(i){
  __CH.pick=i;
  ['A','B','C','D'].forEach((l,idx)=>{
    const b=document.getElementById('chOpt'+l);
    if(!b) return;
    b.className='btn'+(idx===i?' btn-p':'');
  });
}

function marksFor(chosenIdx, correctIdx){
  if(chosenIdx===undefined || chosenIdx===null) return 0;
  const r=examRules();
  if(r.id==='GATE_2027'){
    // For legacy uses (challenge correction): treat as 1-mark MCQ default
    return chosenIdx===correctIdx ? 1 : (-1/3);
  }
  return chosenIdx===correctIdx ? r.correct : r.wrong;
}
function applyCorrectionWithDelta(qIdx, newCorrect){
  const q=E.qs[qIdx];
  if(!q) return {ok:false,delta:0};
  const chosen=E.ans[qIdx];
  if(chosen===undefined) return {ok:false,delta:0};

  const oldCorrect=normalizeCorrectIndex(q.correct,4);
  const oldMarks=Number(E.mks[qIdx] ?? marksFor(chosen, oldCorrect));
  const newMarks=marksFor(chosen, newCorrect);
  const delta=newMarks-oldMarks;

  // Update aggregate counters based on old vs new correctness.
  const r=examRules();
  const wasCorrect=oldMarks===r.correct;
  const nowCorrect=newMarks===r.correct;
  if(wasCorrect && !nowCorrect){ E.correct=Math.max(0,E.correct-1); E.wrong+=1; }
  else if(!wasCorrect && nowCorrect){ E.correct+=1; E.wrong=Math.max(0,E.wrong-1); }

  // Apply score delta and update per-question state.
  E.score += delta;
  E.mks[qIdx]=newMarks;
  q.correct=newCorrect;
  updateTopScore();
  doReveal(qIdx);
  return {ok:true,delta};
}

async function adjudicateCorrectViaAPI(q){
  // Returns {correct, reason} or throws
  const stem=String(q?.question||'').trim();
  const opts=(q?.options||[]).slice(0,4).map(o=>String(o||'').trim());
  const expl=String(q?.explanation||'').trim();
  if(!stem || opts.length!==4) throw new Error('Bad question payload');

  const prompt=
`You are an exam answer-key verifier.

Task: Determine the single correct option index (0-3) for the question.
- Use ONLY the question stem and options as the source of truth.
- If the explanation conflicts with the stem/options, ignore the explanation.
- Return ONLY valid JSON.

JSON:
{"correct":<0|1|2|3>,"reason":"1-2 sentences"}

QUESTION:
${stem}

OPTIONS:
0) ${opts[0]}
1) ${opts[1]}
2) ${opts[2]}
3) ${opts[3]}

EXPLANATION (may be wrong):
${expl || "(none)"}`
  ;

  const body={model:MDL,max_tokens:260,temperature:0.0,messages:[{role:'user',content:prompt}]};
  const prov=String(q?._provider||'').trim();
  const data=prov ? await callAPIProviderOnly(prov, body) : await callAPI(body);
  const txt=String(data?.content?.[0]?.text||'').trim();
  const jsonStr=txt
    .replace(/^```(?:json)?[\r\n]*/,'')
    .replace(/[\r\n]*```$/,'')
    .trim()
    .replace(/.*?({[\s\S]*}).*/,'$1');
  const out=JSON.parse(jsonStr);
  const c=normalizeCorrectIndex(out?.correct,4);
  const reason=String(out?.reason||'').trim();
  return {correct:c, reason};
}

function _explanationMentionsOptionLetter(expl){
  const s=String(expl||'');
  return /\b(correct|answer)\b/i.test(s) && /\b(option\s*)?\(?\s*[ABCD]\s*\)?\b/i.test(s);
}
function _longestPrefixOfOptionInExpl(o, e){
  if(!o || !e) return 0;
  let lo=0, hi=o.length, best=0;
  while(lo<=hi){
    const mid=(lo+hi)>>1;
    const pref=o.slice(0, mid);
    if(mid===0 || e.includes(pref)){ best=mid; lo=mid+1; }
    else hi=mid-1;
  }
  return best;
}
function _explanationStronglyMentionsSomeOption(expl, options){
  const e=normalizeForMatch(expl||'');
  if(!e) return null;
  let bestIdx=null, bestPref=0;
  for(let i=0;i<Math.min(4, options.length);i++){
    const o=normalizeForMatch(options[i]||'');
    if(!o || o.length<10) continue;
    const prefLen=_longestPrefixOfOptionInExpl(o, e);
    if(prefLen>bestPref){
      bestPref=prefLen;
      bestIdx=i;
    }else if(prefLen===bestPref && prefLen>0 && bestIdx!==null){
      const prev=normalizeForMatch(options[bestIdx]||'');
      if(o.length>prev.length) bestIdx=i;
    }
  }
  // Require a substantial overlap so we do not fire on generic stems alone.
  if(bestPref<24) return null;
  return bestIdx;
}

function needsAutoFix(q, subject){
  const sub=String(subject||q?.subject||'').trim();
  const expl=String(q?.explanation||'');
  const opts=(q?.options||[]).slice(0,4);
  const c=normalizeCorrectIndex(q?.correct,4);

  // Language-heavy sections must be near-perfect; always verify once.
  if(sub==='English' || sub==='SAT_RW' || sub==='ACT_ENG' || sub==='ACT_READ' || sub==='IELTS_LISTEN' || sub==='IELTS_READ' || sub==='TOEFL_READ' || sub==='TOEFL_LISTEN' || sub==='GRE_VERB' || sub==='GMAT_VERB' || sub==='CAT_VARC' || sub==='APT_VAR') return true;
  if(_explanationMentionsOptionLetter(expl)) return true;

  const inferredLetter=inferCorrectFromExplanation(expl);
  const inferredText=inferCorrectFromExplanationText(expl, opts);
  const inferred=(inferredLetter!==null)?inferredLetter:(inferredText!==null?inferredText:null);
  if(inferred!==null && inferred!==c) return true;

  const mentioned=_explanationStronglyMentionsSomeOption(expl, opts);
  if(mentioned!==null && mentioned!==c) return true;
  return false;
}

function stripDiagramBySubject(q, subject, seedish){
  if(!q || typeof q!=='object') return q;
  const sub=String(subject||q.subject||'').trim();
  if(!q.diagram) return q;

  const examId=String((typeof E!=='undefined' && E && E.exam) || cfg?.exam || 'BITSAT');
  const indian=isIndianExamId(examId);

  const noDiagLang=new Set(['English','Language','SAT_RW','ACT_ENG','ACT_READ','IELTS_LISTEN','IELTS_READ','TOEFL_READ','TOEFL_LISTEN','GRE_VERB','GMAT_VERB','CAT_VARC','APT_VAR']);
  if(noDiagLang.has(sub)){
    delete q.diagram;
    return q;
  }

  // India-pattern mocks: keep ASCII "figure" diagrams for Physics/LR/PCB etc. (Math stays text-only).
  if(indian){
    if(sub==='Math'){delete q.diagram;return q;}
    return q;
  }

  // International / other exams: previous conservative behaviour
  if(sub==='Chemistry' || sub==='Math'){
    delete q.diagram;
    return q;
  }
  if(sub==='LR') return q;
  if(sub==='Physics'){
    const h=strHash32(`${seedish||''}|keepDiag|${qFingerprint(q)}`);
    const keep=((h>>>0)%100) < 12;
    if(!keep) delete q.diagram;
    return q;
  }
  delete q.diagram;
  return q;
}

function isClearlyInconsistent(q){
  if(!q || !Array.isArray(q.options) || q.options.length<4) return false;
  const expl=String(q.explanation||'');
  const c=normalizeCorrectIndex(q.correct,4);
  const inferredLetter=inferCorrectFromExplanation(expl);
  const inferredText=inferCorrectFromExplanationText(expl, q.options||[]);
  const inferred=(inferredLetter!==null)?inferredLetter:(inferredText!==null?inferredText:null);
  if(inferred!==null && inferred!==c) return true;
  const mentioned=_explanationStronglyMentionsSomeOption(expl, q.options||[]);
  if(mentioned!==null && mentioned!==c) return true;
  // STEM safety: if the explanation explicitly mentions multiple different option texts,
  // it often means the model mixed up calculations (e.g. computes 10g then claims 20g).
  // Treat that as inconsistent so we regenerate rather than teaching the wrong key.
  const sub=String(q.subject||'').trim();
  const stemSubjects=new Set(['Physics','Chemistry','Math','LR']);
  if(stemSubjects.has(sub)){
    const hits=mentionedOptionIndicesInText(expl, q.options||[]);
    if(hits.length>=2) return true;
  }
  return false;
}

// When heuristics disagree or the verifier moved the answer key, queue for human admin review (no blocking of the live exam).
function collectDoubtReasons(q, subject, ctx){
  const reasons=[];
  const sub=String(subject||q?.subject||'').trim();
  const expl=String(q?.explanation||'');
  const opts=(q?.options||[]).slice(0,4);
  const c=normalizeCorrectIndex(q?.correct,4);
  const hadVerifierPath=!!ctx?.hadVerifierPath;
  const pre=normalizeCorrectIndex(ctx?.preVerifierCorrect,4);
  if(hadVerifierPath && pre!==c) reasons.push('Verifier or post-check changed the keyed answer from the first-pass model output.');

  const letter=inferCorrectFromExplanation(expl);
  const text=inferCorrectFromExplanationText(expl, opts);
  const quoted=inferCorrectFromQuotedOptionText(expl, opts);
  const vals=[];
  if(letter!==null) vals.push(letter);
  if(text!==null) vals.push(text);
  if(quoted!==null) vals.push(quoted);
  const uniq=new Set(vals);
  if(uniq.size>1) reasons.push('Explanation heuristics (letter / text / quote) disagree on the correct option.');

  const nset=new Set(opts.map(o=>normalizeForMatch(o)));
  if(nset.size<4) reasons.push('Two or more options are near-duplicates after normalization.');

  const minExpl=(sub==='English'||sub==='LR')?28:48;
  if(expl.trim().length>0 && expl.trim().length<minExpl) reasons.push('Explanation is shorter than the automated threshold for this subject.');

  const stem=String(q?.question||'').trim();
  if(stem.length>0 && stem.length<28) reasons.push('Question stem is very short (possible incomplete prompt).');

  if(quoted!==null && quoted!==c) reasons.push('Quoted-option alignment does not match the final keyed answer.');

  return{doubt:reasons.length>0,reasons};
}

async function submitQuestionHumanReviewQueue(q, reasons, subject, meta){
  if(!sb||!USER?.id||!reasons?.length||!q) return;
  const fp=qFingerprint(q);
  try{
    const {data:ex}=await sb.from('question_review_queue').select('id').eq('question_fingerprint',fp).eq('status','pending').maybeSingle();
    if(ex?.id) return;
    const payload={...q,subject:String(subject||q.subject||'')};
    delete payload._humanReview;
    await sb.from('question_review_queue').insert({
      question_fingerprint:fp,
      subject:String(subject||q.subject||'')||null,
      topic:String(q.topic||'')||null,
      difficulty:String(q.difficulty||'medium').toLowerCase()||null,
      payload,
      doubt_reasons:reasons,
      status:'pending',
      user_id:USER.id,
      session_seed:meta?.seed!=null?Number(meta.seed):null,
      session_num:meta?.sesNum!=null?Number(meta.sesNum):null,
      q_index:meta?.qi!=null?Number(meta.qi):null
    });
  }catch(_e){}
}

function enqueueIfDoubtful(q, subject, ctx, meta){
  try{
    const r=collectDoubtReasons(q, subject, ctx);
    if(!r.doubt||!r.reasons.length) return;
    q._humanReview='pending';
    void submitQuestionHumanReviewQueue(q, r.reasons, subject, meta);
  }catch(_e){}
}

async function verifyAndFixMCQViaAPI(q, subject, topic, providerHint, vflags){
  vflags=vflags||{};
  // Returns a corrected {correct, explanation} aligned to the CURRENT options order.
  const stem=String(q?.question||'').trim();
  const opts=(q?.options||[]).slice(0,4).map(o=>String(o||'').trim());
  if(!stem || opts.length!==4) throw new Error('Bad question for verification');
  const sub=String(subject||q?.subject||'').trim() || 'General';
  const top=String(topic||q?.topic||'').trim();

  const allowDual = new Set(['English','Language','SAT_RW','ACT_ENG','ACT_READ','IELTS_LISTEN','IELTS_READ','TOEFL_READ','TOEFL_LISTEN','GRE_VERB','GMAT_VERB','CAT_VARC','APT_VAR']).has(sub);
  const stemStrict=!!vflags.stemStrict;
  const universalVerifierBlock=`\nVALID OPTION SET (mandatory — every MCQ):\n- Unless "correct_set" is allowed for this subject, exactly ONE of options[0]..[3] must be fully correct for the stem.\n- If the true answer is not listed among the four options, OR more than one option is fully correct when dual answers are not allowed, return ONLY (no "correct" / "correct_set"):\n  {"reject":true,"true_value":"...","reason":"one line"}\n`;
  const stemNumericBlock=stemStrict?`\nNUMERIC / STRUCTURE INTEGRITY (mandatory for this verification pass):\n- Recompute from the stem only. Expand every intermediate sum/product/probability before simplifying.\n- For Bayes / law of total probability: compute the denominator as an explicit sum, simplify, then the numerator — show that the final reduced fraction is exactly one of the four option texts.\n- Never assert a chain of equalities unless each step is valid after reduction (e.g. do not claim a/b = c/d unless cross-multiplication holds).\n- For counting questions (stereoisomers, isomers, resonance forms, etc.): derive the exact integer. It must match one option string exactly (same digits). If the true count is 1 but no option is \"1\", the item is INVALID — use reject JSON from VALID OPTION SET above.\n`:'';
  const recheckBlock=vflags.recheck?`\nINDEPENDENT RECHECK (mandatory):\n- Ignore any prior draft. Re-derive from the stem and options only.\n- A previous pass suggested index ${Number(vflags.priorIndex)} — treat that as untrusted; confirm or replace using fresh arithmetic.\n`:'';
  const tieBlock=vflags.tiebreak?`\nTIE-BREAK (mandatory):\n- Two independent passes disagreed: index ${Number(vflags.indexA)} vs index ${Number(vflags.indexB)}.\n- Recompute once more from the stem only and return EXACTLY ONE final "correct" in {0,1,2,3} with a short justification that resolves the disagreement.\n`:'';
  const prompt=
`You are an exam answer-key checker.
Your task: determine the correct option(s) and provide a correct explanation.

Hard requirements:
- Use ONLY the given options (0..3). Exactly ONE must be correct.
- For language-only ambiguity (if truly unavoidable), you may allow EXACTLY TWO correct options by returning "correct_set":[i,j] (2 indices). Otherwise return a single "correct".
- Return ONLY valid JSON. No markdown fences.
- If using "correct": it must be an integer in {0,1,2,3}.
- If using "correct_set": it must be an array of exactly 2 distinct indices.
- Explanation must be conceptually correct and match the chosen option.
- Do NOT say "Option A/B/C/D". Do NOT refer to positions/letters. Refer to the correct option by its exact text.
- Keep explanation 3–7 lines (unless dual-correct is used). For English/LR, justify briefly; for numeric questions, show key steps.
${allowDual
  ? `- DUAL-CORRECT RULE: If (and only if) EXACTLY TWO options are genuinely correct, return "correct_set":[i,j] where i is the STRONGER/MORE PREFERRED answer and j is the acceptable alternative.
- Explanation MUST: (1) clearly state BOTH options are acceptable, (2) explain WHY option i is primary/preferred (~60% of text), (3) briefly explain why option j is also valid (~40%).
- Do NOT mark two options if one is clearly better — use single "correct" instead.`
  : `- Do NOT return "correct_set" for this subject.`}
${universalVerifierBlock}${stemNumericBlock}${recheckBlock}${tieBlock}

SUBJECT: ${sub}${top?`\nTOPIC: ${top}`:''}

QUESTION:
${stem}

OPTIONS:
0) ${opts[0]}
1) ${opts[1]}
2) ${opts[2]}
3) ${opts[3]}

JSON (normal):
{"correct":<0|1|2|3>,"explanation":"..."}
or (rare, only if allowed):
{"correct_set":[0,2],"explanation":"..."}
or (only if stem rules above require it — impossible option set):
{"reject":true,"true_value":"...","reason":"..."}`
  ;

  const maxTok=vflags.tiebreak?560:(stemStrict?620:420);
  const body={model:MDL,max_tokens:maxTok,temperature:0.0,messages:[{role:'user',content:prompt}]};
  const data=providerHint ? await callAPIProviderOnly(providerHint, body) : await callAPI(body);
  const txt=String(data?.content?.[0]?.text||'').trim();
  const jsonStr=txt
    .replace(/^```(?:json)?[\r\n]*/,'')
    .replace(/[\r\n]*```$/,'')
    .trim()
    .replace(/.*?({[\s\S]*}).*/,'$1');
  const out=JSON.parse(jsonStr);
  if(out && out.reject===true){
    throw new Error('Verifier rejected: correct value not among options — '+String(out.reason||out.true_value||'reject').slice(0,180));
  }
  const outSet=Array.isArray(out?.correct_set)?out.correct_set:null;
  const outExpl=sanitizeExplanation(String(out?.explanation||'').trim(), outSet && allowDual ? 12 : 7, outSet && allowDual ? 1100 : 700);
  if(outSet && allowDual){
    const set=[...new Set(outSet.map(x=>normalizeCorrectIndex(x,4)))].sort((a,b)=>a-b);
    if(set.length===2){
      return { correct_set:set, correct:set[0]??0, explanation: outExpl };
    }
  }
  return { correct: normalizeCorrectIndex(out?.correct,4), explanation: outExpl };
}

async function submitChallenge(){
  const btn=document.getElementById('chSubmitBtn');
  const qIdx=__CH.qIdx;
  const pickIdx=__CH.pick;
  if(qIdx===null || pickIdx===null){showToast('Select A/B/C/D first.','error');return;}
  const q=E.qs[qIdx];
  if(!q){showToast('Question not found.','error');return;}
  const reason=String(document.getElementById('chReason')?.value||'').trim();

  if(btn){btn.disabled=true;btn.textContent='Verifying…';}
  const oldCorrect=normalizeCorrectIndex(q.correct,4);
  const chosen=E.ans[qIdx];

  // Quick local auto-resolve if explanation explicitly declares a letter or option text.
  const inferredLetter=inferCorrectFromExplanation(q.explanation);
  const inferredText=inferCorrectFromExplanationText(q.explanation, q.options||[]);
  const inferred=(inferredLetter!==null)?inferredLetter:(inferredText!==null?inferredText:null);

  let finalCorrect=null;
  let adjudReason='';
  let status='resolved_api';
  try{
    if(inferred!==null){
      finalCorrect=inferred;
      adjudReason='Resolved from explanation text.';
      status='resolved_local';
    }else{
      const r=await adjudicateCorrectViaAPI(q);
      finalCorrect=r.correct;
      adjudReason=r.reason||'Verified by AI adjudication.';
      status='resolved_api';
    }

    // If user picked “claimed correct”, but API says otherwise, we still use API result.
    const res=applyCorrectionWithDelta(qIdx, finalCorrect);
    closeChallenge();
    const d=res.delta||0;
    const msg=d>0?`Challenge verified ✓ +${d} marks`:(d<0?`Challenge verified ✓ ${d} marks`:'Challenge verified ✓ no score change');
    showToast(msg,'success');

    // Optional: update bank correct for future users (best-effort)
    try{
      if(sb) await sb.from('question_bank').update({correct:finalCorrect}).eq('id', qFingerprint(q));
    }catch(_e){}

    // Log to DB for auditing
    if(sb && USER){
      try{
        await sb.from('question_challenges').insert({
          user_id:USER.id,
          session_seed:E.seed,
          session_num:E.sesNum+1,
          q_index:qIdx,
          subject:q.subject||E.subList[qIdx],
          topic:q.topic||'',
          question_id:qFingerprint(q),
          chosen,
          current_correct:oldCorrect,
          claimed_correct:pickIdx,
          reason,
          status,
          delta_marks:d,
          adjudication_reason:adjudReason
        });
      }catch(_e){}
    }
  }catch(e){
    const em=String(e?.message||e||'').slice(0,120);
    showToast('Challenge verify failed: '+em,'error');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Submit challenge';}
  }
}

function isQuestionSafeToServe(q){
  if(!q || typeof q!=='object') return false;
  if(!q.question || typeof q.question!=='string' || !String(q.question).trim()) return false;
  const t=String(q.type||'MCQ').toUpperCase();
  if(t==='NAT') return !!String(q.answer||'').trim();
  if(!Array.isArray(q.options) || q.options.length<4) return false;
  const opts=q.options.slice(0,4).map(o=>normalizeForMatch(String(o||''))).filter(Boolean);
  const uniqueOpts=new Set(opts);
  if(uniqueOpts.size<3) return false; // degenerate / duplicate-heavy
  const c=normalizeCorrectIndex(q.correct,4);
  if(!(c>=0 && c<=3)) return false;
  if(!q.explanation || String(q.explanation).trim().length<20) return false;
  return true;
}
function doReveal(qIdx){
  const q=E.qs[qIdx];const chosen=E.ans[qIdx];
  const ol=document.getElementById('optsList');
  const btns=ol?ol.querySelectorAll('button.opt'):document.querySelectorAll('#optsList button.opt');
  const t=String(q?.type||'MCQ').toUpperCase();
  if(t==='NAT'){
    // no option buttons to mark; just lock input if present
    const inp=document.getElementById('natInp');
    if(inp) inp.disabled=true;
    return;
  }
  if(t==='MSQ'){
    const corr=new Set((q.correct_set||[]).map(x=>normalizeCorrectIndex(x,4)));
    btns.forEach((b,i)=>{
      b.classList.add('locked');b.onclick=null;
      if(corr.has(i)) b.classList.add('rc');
      const picked=Array.isArray(chosen)?chosen.includes(i):false;
      if(picked && !corr.has(i)) b.classList.add('rw');
    });
    return;
  }
  const corrSet=(Array.isArray(q?.correct_set) && q.correct_set.length)
    ? new Set((q.correct_set||[]).map(x=>normalizeCorrectIndex(x,4)))
    : null;
  btns.forEach((b,i)=>{
    b.classList.add('locked');b.onclick=null;
    const isCorrect = corrSet ? corrSet.has(i) : (i===q.correct);
    if(isCorrect) b.classList.add('rc');
    else if(i===chosen) b.classList.add('rw');
  });
}
function updateTopScore(){
  document.getElementById('sc-c').textContent='✓ '+E.correct;
  document.getElementById('sc-w').textContent='✗ '+E.wrong;
  document.getElementById('sc-m').textContent=E.score+' pts';
}
function goNext(){if(E.cur<cfg.count-1)renderQ(E.cur+1);else endExam();}
function skipQ(){stopTimer();E.tt[E.cur]=120;setNavState(E.cur,'skip');if(E.cur<cfg.count-1)renderQ(E.cur+1);else endExam();}
function markRev(){E.rev[E.cur]=true;setNavState(E.cur,'rev');}
function jumpTo(i){stopTimer();renderQ(i);}
function confirmEnd(){if(confirm('End exam? Unanswered questions will be skipped.'))endExam();}

function buildNav(){
  const g=document.getElementById('navGrid');g.innerHTML='';let last='';
  E.subList.forEach((sub,i)=>{
    if(sub!==last){const d=document.createElement('div');d.className='nsec';d.textContent={Physics:'PHY',Chemistry:'CHE',Math:'MAT',English:'ENG',LR:'LR',Language:'LANG',General:'GEN',Biology:'BIO',Economics:'ECO',History:'HIS',Geography:'GEO','Political Science':'POL',Accountancy:'ACC','Business Studies':'BST','Computer Science':'CS',
      SAT_RW:'SAT-RW',SAT_MATH:'SAT-M',ACT_ENG:'ACT-E',ACT_MATH:'ACT-M',ACT_READ:'ACT-R',ACT_SCI:'ACT-S',
      IELTS_LISTEN:'IEL-L',IELTS_READ:'IEL-R',TOEFL_READ:'TOE-R',TOEFL_LISTEN:'TOE-L',
      GRE_VERB:'GRE-V',GRE_QUANT:'GRE-Q',GMAT_VERB:'GMA-V',GMAT_QUANT:'GMA-Q',GMAT_DI:'GMA-DI',
      CAT_VARC:'VARC',CAT_DILR:'DILR',CAT_QA:'QA',APT_QA:'QA',APT_DILR:'DILR',APT_VAR:'VA'
    }[sub]||String(sub||'').slice(0,3).toUpperCase();g.appendChild(d);last=sub;}
    const b=document.createElement('button');b.className='nbtn';b.id='nb-'+i;b.textContent=i+1;b.onclick=()=>jumpTo(i);g.appendChild(b);
  });
}
function navLoaded(i){const b=document.getElementById('nb-'+i);if(b)b.classList.add('loaded');}
function setNavState(i,st){const b=document.getElementById('nb-'+i);if(!b)return;b.className='nbtn loaded';if(st==='ans')b.classList.add('n-ans');else if(st==='skip')b.classList.add('n-skip');}
function navHighlight(i){document.querySelectorAll('.nbtn').forEach(b=>b.classList.remove('n-cur'));const b=document.getElementById('nb-'+i);if(b){b.classList.add('n-cur','loaded');b.scrollIntoView({block:'nearest',behavior:'smooth'});}}

function startTimer(qi){
  stopTimer();E.tLeft=120;drawTimer();
  E.tInt=setInterval(()=>{E.tLeft--;drawTimer();if(E.tLeft<=0){stopTimer();E.tt[qi]=120;setNavState(qi,E.ans[qi]!==undefined?'ans':'skip');setTimeout(()=>{if(E.cur<cfg.count-1)renderQ(E.cur+1);else endExam();},600);}},1000);
}
function stopTimer(){if(E.tInt){clearInterval(E.tInt);E.tInt=null;}}
function drawTimer(){
  const t=E.tLeft,m=Math.floor(t/60),s=t%60;
  document.getElementById('timerTxt').textContent=`${m}:${s<10?'0':''}${s}`;
  const pct=t/120*100;const col=t<=20?'#ef4444':t<=60?'#f59e0b':'#3b82f6';
  document.getElementById('timer').style.background=`conic-gradient(${col} ${pct.toFixed(1)}%,#1e2535 0%)`;
  document.getElementById('timerTxt').style.color=t<=20?'#ef4444':t<=60?'#f59e0b':null;
}
function setLoading(v,txt,sub){
  document.getElementById('qLoad').style.display=v?'flex':'none';
  document.getElementById('qContent').style.display=v?'none':'block';
  if(txt)document.getElementById('loadTxt').textContent=txt;
  if(sub)document.getElementById('loadSub').textContent=sub;
}

// ══════════════════════════════════════════════
//  END EXAM — SAVE TO SUPABASE
// ══════════════════════════════════════════════
async function endExam(){
  stopTimer();
  showScreen('s-results');
  const r=examRules();
  const attempted=Object.keys(E.ans).length;
  const skipped=cfg.count-attempted;
  const acc=attempted>0?Math.round(E.correct/attempted*100):0;
  const elapsed=Math.round((Date.now()-E.startT)/1000);
  const avgT=attempted>0?Math.round(elapsed/attempted):0;
  const maxPts=(r.id==='GATE_2027')
    ? E.qs.reduce((a,q)=>a + (Number(q?.marks||1)||1),0)
    : cfg.count*Number(r.correct||3);
  const pct=Math.max(0,E.score/maxPts);
  const scaled=(r.id==='BITSAT')?Math.round(pct*390):Math.round(E.score);
  const gap=(r.id==='BITSAT')?(350-scaled):0;

  // ── Donut animation ──
  const fg=document.getElementById('donutFg');
  const offset=CIRC-(CIRC*Math.max(0,pct));
  const scoreCol=pct>=.75?'#22c55e':pct>=.5?'#f59e0b':'#ef4444';
  fg.style.stroke=scoreCol;fg.style.strokeDashoffset=CIRC;
  setTimeout(()=>{fg.style.strokeDashoffset=offset;},200);
  document.getElementById('dScore').textContent=E.score;
  document.getElementById('dMax').textContent=maxPts;

  const gradeMap=[[.92,'Outstanding 🏆','34,197,94'],[.78,'Excellent ⭐','34,197,94'],[.65,'Good 👍','59,130,246'],[.50,'Average 📈','245,158,11'],[0,'Keep Going 💪','239,68,68']];
  const [,grade,gc]=gradeMap.find(([t])=>pct>=t)||gradeMap[gradeMap.length-1];
  const gp=document.getElementById('gradePill');gp.textContent=grade;
  gp.style.cssText=`background:rgba(${gc},.12);color:rgb(${gc});border:1px solid rgba(${gc},.3);padding:5px 20px;border-radius:50px;font-weight:700;font-size:12px;letter-spacing:.8px;display:inline-block`;
  document.getElementById('pctEst').textContent=pct>=.9?'Top 1% percentile':pct>=.75?'Top 5–10% percentile':pct>=.6?'Top 20–30% percentile':'Keep practising!';
  document.getElementById('tgtTxt').innerHTML=(r.id==='BITSAT')
    ? (gap>0?`Need <b>${gap} more marks</b> to hit 350 · Projected: <b>${scaled}/390</b>`:`<b>Above target!</b> Projected full BITSAT: <b>${scaled}/390</b>`)
    : (`${escapeHtml(r.name)} score: <b>${E.score}</b> / <b>${maxPts}</b> · Accuracy: <b>${acc}%</b>`);
  ['r-tot','r-cor','r-wrg','r-skp','r-acc','r-avg'].forEach((id,i)=>{document.getElementById(id).textContent=[E.score,E.correct,E.wrong,skipped,acc+'%',avgT+'s'][i];});

  // ── Save to Supabase ──
  if(USER){
    try{
      const basePayload={
        student_id:USER.id,session_num:E.sesNum+1,
        subjects:cfg.subjects,q_count:cfg.count,difficulty:cfg.diff,seed:E.seed,
        score:E.score,max_score:maxPts,correct:E.correct,wrong:E.wrong,
        skipped,accuracy:acc,avg_time_s:avgT,elapsed_s:elapsed,
        scaled_390:scaled,topics_used:E.tu,
        exam:r.id
      };
      const nameSnap=String(PROFILE?.full_name||USER?.user_metadata?.full_name||USER?.user_metadata?.fullName||'').trim();
      const emailSnap=String(PROFILE?.email||USER?.email||USER?.user_metadata?.email||'').trim();

      let session=null, error=null;
      // Best-effort: save denormalized name/email for admin reporting even if profiles RLS blocks reads.
      ({data:session, error}=await sb.from('test_sessions').insert({
        ...basePayload,
        ...(nameSnap?{student_name:nameSnap}:{}),
        ...(emailSnap?{student_email:emailSnap}:{}),
      }).select().single());
      if(error){
        const msg=String(error.message||'');
        // If the DB schema doesn't have these columns yet, retry without them.
        if(msg.toLowerCase().includes('student_name') || msg.toLowerCase().includes('student_email') || msg.toLowerCase().includes('exam')){
          ({data:session, error}=await sb.from('test_sessions').insert(basePayload).select().single());
        }
      }

      if(!error&&session){
        // Save per-question details
        const rows=E.qs.map((q,i)=>({
          session_id:session.id,q_index:i,
          subject:q?.subject||E.subList[i],topic:q?.topic||'Unknown',
          difficulty:q?.difficulty||'medium',
          answered:E.ans[i]!==undefined,correct:E.mks[i]===3,
          skipped:E.ans[i]===undefined,time_taken_s:E.tt[i]||0,marks:E.mks[i]||0
        }));
        await sb.from('session_questions').insert(rows);
        DB_SESSIONS=[session,...DB_SESSIONS];
        showToast('Results saved to your profile ✓','success');
      }
    }catch(err){console.warn('Save failed:',err.message);}
  }

  // Subject stats
  const sw={};
  E.qs.forEach((q,i)=>{
    if(!q)return;const s=q.subject||E.subList[i];
    if(!sw[s])sw[s]={c:0,w:0,s:0,t:0};sw[s].t++;
    const m=Number(E.mks[i]||0);
    if(m>0) sw[s].c++;
    else if(m<0) sw[s].w++;
    sw[s].s+=m;
  });
  buildMarksTable(sw);
  await buildInsights(acc,skipped,avgT,pct,maxPts,sw,elapsed,scaled,gap);
}

function buildMarksTable(sw){
  if(!Object.keys(sw).length)return;
  let rows='';
  Object.entries(sw).forEach(([s,d])=>{
    const p=d.t>0?Math.round(d.c/d.t*100):0;
    rows+=`<tr><td style="color:${SC[s]||'#60a5fa'};font-weight:700">${s}</td><td>${d.t}</td><td class="pos">${d.c}</td><td class="neg">${d.w}</td><td class="neu">${d.t-d.c-d.w}</td><td style="font-family:var(--mono)">${p}%</td><td class="${d.s>=0?'pos':'neg'}">${d.s>0?'+':''}${d.s}</td></tr>`;
  });
  document.getElementById('insSec').innerHTML=`<div class="icard"><div class="ititle">📊 Subject-wise Breakdown</div><table class="marks-table"><thead><tr><th>Subject</th><th>Total</th><th>Correct</th><th>Wrong</th><th>Skip</th><th>Acc.</th><th>Marks</th></tr></thead><tbody>${rows}</tbody></table></div><div style="text-align:center;padding:30px"><div class="spin" style="margin:auto"></div><div style="color:var(--t2);font-size:13px;margin-top:12px">Generating RankGate Insight…</div></div>`;
}

async function buildInsights(acc,skipped,avgT,pct,maxPts,sw,elapsed,scaled,gap){
  const r=examRules();
  const subjLines=Object.entries(sw).map(([s,d])=>`${s}: ${d.c}/${d.t} (${d.t>0?Math.round(d.c/d.t*100):0}%, ${d.s} marks)`).join(' | ');
  const weakSubs=Object.entries(sw).filter(([,d])=>d.t>0&&d.c/d.t<.5).map(([s])=>s).join(', ')||'None';
  const strongSubs=Object.entries(sw).filter(([,d])=>d.t>0&&d.c/d.t>=.7).map(([s])=>s).join(', ')||'None';
  const projectedTxt=(r.id==='BITSAT')?`Projected: ${scaled}/390`:`Score: ${E.score}/${maxPts}`;
  const targetTxt=(r.id==='BITSAT')?`Target: 350/390 | Gap: ${gap>0?gap+' marks needed':'ACHIEVED'}`:`Target: improve accuracy and maximize net score`;
  const prompt=`You are India's top exam coaching expert for ${r.name}.\n\nSTUDENT PERFORMANCE:\n- Test #${E.sesNum+1} | ${projectedTxt} (${Math.round(pct*100)}%)\n- Correct:${E.correct} Wrong:${E.wrong} Skipped:${skipped} Accuracy:${acc}%\n- Marking: +${r.correct} for correct, ${r.wrong} for wrong\n- Subjects: ${subjLines}\n- Strong: ${strongSubs} | Weak: ${weakSubs}\n- ${targetTxt}\n\nReturn ONLY valid JSON:\n{\"verdict\":\"one sharp sentence with numbers\",\"strengthAnalysis\":\"2 sentences naming strong topics/scores\",\"weaknessAnalysis\":\"2 sentences naming exact weak topics and error types\",\"timeAnalysis\":\"2 sentences comparing ${avgT}s/Q to ideal 84s\",\"negativePenalty\":\"1 sentence on negative impact\",\"actionPlan\":[\"Daily action with resource\",\"Topic to master this week\",\"Exam-day strategy change\",\"Formula to memorize\",\"Target breakdown\"],\"targetStrategy\":\"3 sentences weekly plan\",\"encouragement\":\"1 powerful personalised sentence\"}`;
  try{
    const data=await callAPI({model:MDL,max_tokens:1400,temperature:0.7,messages:[{role:'user',content:prompt}]});
    const ins=JSON.parse(data.content[0].text.replace(/^```(?:json)?[\r\n]*/,'').replace(/[\r\n]*```$/,'').trim().replace(/.*?({[\s\S]*}).*/,'$1'));
    renderInsights(ins,sw);
  }catch(e){renderFallbackInsights(sw,acc,avgT,scaled,gap);}
}

function renderInsights(ins,sw){
  const existing=document.getElementById('insSec').innerHTML;
  const tableCard=existing.includes('marks-table')?existing.split('<div style="text-align:center')[0]:'';
  const r=examRules();
  let h=tableCard;
  h+=`<div class="icard" style="border-color:rgba(245,158,11,.22);background:rgba(245,158,11,.04)"><div class="ititle" style="color:var(--amber)">📊 Performance Verdict</div><div class="ibody" style="font-size:14px;color:var(--text)">${esc(ins.verdict)}</div><div class="ibody" style="margin-top:8px;font-style:italic;color:var(--t2)">${esc(ins.encouragement)}</div></div>`;
  h+=`<div class="icard"><div class="ititle">💪 Strengths</div><div class="ibody">${esc(ins.strengthAnalysis)}</div></div>`;
  h+=`<div class="icard" style="border-color:rgba(239,68,68,.18)"><div class="ititle">⚠️ Weaknesses</div><div class="ibody">${esc(ins.weaknessAnalysis)}</div></div>`;
  h+=`<div class="icard"><div class="ititle">📚 Subject Analysis</div><div class="subj-bars">`;
  Object.entries(sw).forEach(([s,d])=>{
    const p=d.t>0?Math.round(d.c/d.t*100):0;const col=SC[s]||'#60a5fa';
    h+=`<div class="sbw"><div class="sbt"><span class="sbn" style="color:${col}">${s}</span><span class="sbp">${d.c}/${d.t} · ${p}%</span></div><div class="sbtrack"><div class="sbfill" style="width:${p}%;background:${col}"></div></div></div>`;
  });
  h+=`</div></div>`;
  h+=`<div class="icard"><div class="ititle">⏱️ Time Management</div><div class="ibody">${esc(ins.timeAnalysis)}</div></div>`;
  h+=`<div class="icard" style="border-color:rgba(239,68,68,.15)"><div class="ititle">⚡ Negative Marking</div><div class="ibody">${esc(ins.negativePenalty)}</div></div>`;
  h+=`<div class="icard" style="border-color:rgba(59,130,246,.22)"><div class="ititle">🎯 5-Step Action Plan</div><ul class="plan-list">`;
  (ins.actionPlan||[]).slice(0,5).forEach((item,i)=>{h+=`<li class="plan-item"><div class="plan-n">${i+1}</div><span>${esc(item)}</span></li>`;});
  h+=`</ul></div>`;
  if(r.id==='BITSAT'){
    h+=`<div class="icard" style="border-color:rgba(6,182,212,.22);background:rgba(6,182,212,.03)"><div class="ititle" style="color:var(--cyan)">🚀 Road to 350+ on Full BITSAT</div><div class="ibody" style="color:var(--text)">${esc(ins.targetStrategy)}</div></div>`;
  }else{
    h+=`<div class="icard" style="border-color:rgba(6,182,212,.22);background:rgba(6,182,212,.03)"><div class="ititle" style="color:var(--cyan)">🚀 Improvement Strategy</div><div class="ibody" style="color:var(--text)">${esc(ins.targetStrategy||'Focus on accuracy, reduce negatives, and strengthen weak sections weekly.')}</div></div>`;
  }
  document.getElementById('insSec').innerHTML=h;
}
function renderFallbackInsights(sw,acc,avgT,scaled,gap){
  const r=examRules();
  const existing=document.getElementById('insSec').innerHTML;
  const tableCard=existing.includes('marks-table')?existing.split('<div style="text-align:center')[0]:'';
  let h=tableCard+`<div class="icard"><div class="ititle">💡 Quick Analysis</div><div class="ibody">Accuracy: <b>${acc}%</b> · Avg time: <b>${avgT}s/Q</b> (ideal: 84s)<br><br>${r.id==='BITSAT'?`Projected BITSAT: <b>${scaled}/390</b><br><br>${gap>0?`Need <b>${gap} more marks</b> to hit 350.`:`Above target! Aim for 360+.`}`:`${escapeHtml(r.name)}: keep reducing negatives (−1) and improve accuracy for higher net score.`}<br><br><b>Golden rule:</b> Skip if less than 60% confident to protect against negative marking.</div></div>`;
  document.getElementById('insSec').innerHTML=h;
}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function goToConfig(){
  cfg={
    exam:'BITSAT',
    subjects:['Physics','Chemistry','Math','English','LR'],
    count:5,
    diff:'adaptive',
    cuet:{domains:['Physics','Chemistry','Math'], language:'English'}
  };
  // UI will be rebuilt by exam render
  const firstChip=document.querySelector('#cntRow .chip');
  document.querySelectorAll('#cntRow .chip').forEach(c=>c.classList.remove('sel-n','sel-q'));
  if(firstChip) firstChip.classList.add('sel-q');
  document.querySelectorAll('.dbtn').forEach(b=>b.className='dbtn');
  document.querySelector('.dbtn:last-child').className='dbtn d-adaptive';
  document.getElementById('adaptHint').style.display='block';
  enforceCountLock();
  setExam('BITSAT');
  goToConfig_internal();
}
function goToConfig_internal(){
  syncExamUiAttr();
  showScreen('s-welcome');
  try{ renderWelcomeByExam(); }catch(_e){}

  const sesBanner=document.getElementById('sesBanner');
  const sesBannerTxt=document.getElementById('sesBannerTxt');
  const repeatWarn=document.getElementById('repeatWarn');
  const repeatWarnTxt=document.getElementById('repeatWarnTxt');
  startHeroPunchRotator();

  const n=DB_SESSIONS.length;
  if(n>0){
    sesBanner.style.display='flex';
    sesBannerTxt.textContent=`${n} test${n>1?'s':''} completed — fresh questions guaranteed via DB-tracked topics`;
  }else{
    sesBanner.style.display='none';
    sesBannerTxt.textContent='';
  }

  const heavyTopics=Object.values(DB_USED_TOPICS).filter(v=>v>=3).length;
  if(heavyTopics>5){
    repeatWarn.style.display='block';
    repeatWarnTxt.textContent=`${heavyTopics} topics used 3+ times — AI will prioritise fresh angles`;
  }else{
    repeatWarn.style.display='none';
    repeatWarnTxt.textContent='';
  }
}

let __punchInt=null;
function startHeroPunchRotator(){
  const el=document.getElementById('heroPunchTxt');
  if(!el) return;

  const n=(DB_SESSIONS||[]).length;
  const lastScore=Number(DB_SESSIONS?.[0]?.scaled_390)||0;
  const lines=[
    `🚀 20Q today. 40Q tomorrow. <b>130Q full mock</b> to become unstoppable.`,
    `🏆 Full mocks build rank. <b>Attempt + Review</b> is the real toppers’ routine.`,
    `⚡ Speed is a skill. Do <b>3 full mocks</b> daily and watch confidence explode.`,
    `🎯 Target BITS Pilani? Don’t negotiate with comfort — pick <b>40Q/130Q</b>.`,
    `🔥 Every mock is a step closer. Stay consistent — <b>rank will follow</b>.`,
  ];
  let idx=(n + Math.floor(lastScore/10)) % lines.length;

  function setTxt(){
    // Restart animation by toggling a class on the container
    el.innerHTML=lines[idx];
    el.classList.remove('mot-anim');
    // Force reflow
    void el.offsetWidth;
    el.classList.add('mot-anim');
  }

  // initial line changes after each completed mock (n shifts idx)
  setTxt();

  if(__punchInt) clearInterval(__punchInt);
  __punchInt=setInterval(()=>{
    // only rotate while welcome screen is active
    const scr=document.getElementById('s-welcome');
    if(!scr || !scr.classList.contains('active')) return;
    idx=(idx+1)%lines.length;
    setTxt();
  }, 4500);
}

// ══════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════
function showScreen(id){
  const target=document.getElementById(id);
  if(!target){
    // Never blank the UI by deactivating all screens.
    const fallback=document.getElementById('s-auth');
    if(fallback) fallback.classList.add('active');
    showToast(`Screen not found: ${id}`,'error');
    return;
  }
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  target.classList.add('active');
  window.scrollTo(0,0);
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function showToast(msg,type=''){
  const t=document.getElementById('toast');t.textContent=msg;t.className='toast'+(type?' '+type:'');t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3500);
}

// ══════════════════════════════════════════════
//  CROSS-PAGE BRIDGE  (index.html ↔ admin.html ↔ bank.html)
// ══════════════════════════════════════════════
function _saveSessionToStorage(){
  try{
    const state={
      user: USER ? {id:USER.id, email:USER.email} : null,
      profile: PROFILE || null,
      settings: APP_SETTINGS || null,
      sessions_count: (DB_SESSIONS||[]).length,
      cfg: typeof cfg !== 'undefined' ? cfg : null
    };
    localStorage.setItem('rg_session_state', JSON.stringify(state));
  }catch(_e){}
}
// Call before navigating away
function openAdminPage(){
  _saveSessionToStorage();
  window.open('admin.html','_self');
}
function openBankPage(){
  _saveSessionToStorage();
  window.open('bank.html','_self');
}
window.openAdminPage = openAdminPage;
window.openBankPage  = openBankPage;
