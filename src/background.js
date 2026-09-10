/*
 * MR.MOO Ticket Scanner - service worker
 *
 * วิเคราะห์เนื้อหาโพสต์ว่า "คนนี้กำลังหาตั๋ว" หรือ "กำลังขายตั๋ว"
 * รองรับหลายผู้ให้บริการ เลือกได้ในหน้าตั้งค่า:
 *   gemini — Google AI Studio (คือ key เดียวกับที่ใส่ใน Antigravity)
 *   openai — OpenAI / ChatGPT API
 *   custom — endpoint อื่นที่ใช้รูปแบบเดียวกับ OpenAI chat completions
 *
 * ต้องเรียกจากตรงนี้ (ไม่ใช่ content script) เพราะ:
 *   1. API key จะได้ไม่หลุดไปอยู่ใน context ของหน้า Facebook
 *   2. fetch จาก service worker ใช้สิทธิ์ host_permissions ของส่วนขยาย จึงข้าม CORS ได้
 */
'use strict';

const DEFAULT_PROVIDER = 'gemini';

const DEFAULT_MODEL = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  custom: 'gpt-4o-mini',
};

/*
 * ราคาโดยประมาณ USD ต่อ 1 ล้าน token ใช้ประเมินค่าใช้จ่ายคร่าว ๆ เท่านั้น
 * ราคาจริงดูที่หน้า pricing ของแต่ละเจ้า โมเดลนอกตารางจะใช้ FALLBACK_PRICE
 */
const PRICING = {
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40 },
  'gemini-2.5-flash':      { in: 0.30, out: 2.50 },
  'gemini-2.5-pro':        { in: 1.25, out: 10.00 },
  'gpt-4.1-nano':          { in: 0.10, out: 0.40 },
  'gpt-4o-mini':           { in: 0.15, out: 0.60 },
  'gpt-4.1-mini':          { in: 0.40, out: 1.60 },
  'gpt-4.1':               { in: 2.00, out: 8.00 },
  'gpt-4o':                { in: 2.50, out: 10.00 },
};
const FALLBACK_PRICE = { in: 1.00, out: 4.00 };

/* โมเดลที่ไม่ควร/ไม่รับ temperature=0 — ปล่อยให้ใช้ค่าเริ่มต้นของมันเอง */
const KEEP_DEFAULT_TEMP = /^(o\d|gpt-5|gemini-3)/i;

const SYSTEM_PROMPT = [
  'คุณคือตัวคัดกรองโพสต์ในกลุ่ม Facebook ภาษาไทยเกี่ยวกับโรงภาพยนตร์',
  'งานของคุณคือตัดสินว่าผู้เขียนโพสต์ "กำลังตามหา/อยากได้" สินค้าของโรงหนังหรือไม่',
  '',
  'สินค้าที่นับว่าเกี่ยวข้อง มี 2 กลุ่ม',
  '  1. ตั๋ว/บัตรชมภาพยนตร์ในโรง ทุกเครือ (Major, SF, House, Lido, Icon, IMAX, 4DX)',
  '  2. ชุดป๊อปคอร์นและเครื่องดื่มของโรงหนัง คนไทยเรียกสั้น ๆ ว่า "ป๊อบน้ำ"',
  '     สะกดได้หลายแบบ: ป๊อบน้ำ ป๊อปน้ำ ป็อบน้ำ ปอบน้ำ ชุดป๊อบ เซ็ตป๊อบ คอมโบ',
  '     คำว่า "ป๊อบน้ำ" หมายถึงป๊อปคอร์นบวกน้ำเป็นชุด ไม่ใช่ขนมทั่วไป',
  '',
  'ให้ is_seeker = true เมื่อผู้เขียนต้องการได้ของพวกนี้มาครอบครอง เช่น',
  '  "หาตั๋วหนัง SF 2 ที่", "ใครมีตั๋ว Major ปล่อยบ้าง", "รับซื้อตั๋วรอบพรุ่งนี้",',
  '  "ตามหาบัตรหนังเรื่อง... ใครขายต่อบ้าง", "หาป๊อบน้ำ Major ราคาถูก",',
  '  "ใครมีชุดป๊อบคอร์นเหลือมั้ย"',
  'ให้ is_seeker = false เมื่อผู้เขียนเป็นฝ่ายขาย/ปล่อย/แจก/รับจอง หรือโพสต์ไม่เกี่ยวเลย เช่น',
  '  "ขายตั๋ว SF 2 ใบ", "ปล่อยที่นั่งรอบ 19:00", "รับจองตั๋วหนังเมเจอร์ 158 บาท",',
  '  "ขายป๊อบน้ำราคาส่ง", "รีวิวหนังเรื่องนี้", "ขายตั๋วคอนเสิร์ต"',
  '',
  'ข้อควรระวัง: ประโยคอย่าง "หาตั๋วหนัง ใครขายต่อบ้าง" มีคำว่า "ขาย" อยู่ก็จริง',
  'แต่ผู้เขียนคือผู้ซื้อ ให้ is_seeker = true',
  'ถ้าเป็นตั๋วคอนเสิร์ต ละคร หรืออีเวนต์ที่ไม่ใช่หนังในโรง ให้ is_seeker = false',
  '',
  'confidence คือความมั่นใจ 0.0-1.0 ถ้าข้อความกำกวมหรือสั้นเกินไปให้ค่าต่ำ',
  'cinema ให้ตอบเป็นชื่อเครือโรงหนังที่ระบุในโพสต์ เช่น SF, Major, House, Lido, Icon',
  'ถ้าไม่ระบุให้ตอบสตริงว่าง',
  'movie ใส่ชื่อเรื่องถ้ามี ถ้าเป็นโพสต์หาป๊อบน้ำให้ใส่ว่า "ป๊อบน้ำ"',
  'reason ให้อธิบายสั้น ๆ ไม่เกิน 20 คำเป็นภาษาไทย',
].join('\n');

const FIELDS = ['is_seeker', 'confidence', 'cinema', 'movie', 'seats', 'reason'];

/* schema แบบ JSON Schema — OpenAI strict mode บังคับ additionalProperties: false */
const SCHEMA_OPENAI = {
  type: 'object',
  properties: {
    is_seeker: { type: 'boolean' },
    confidence: { type: 'number' },
    cinema: { type: 'string' },
    movie: { type: 'string' },
    seats: { type: 'string' },
    reason: { type: 'string' },
  },
  required: FIELDS,
  additionalProperties: false,
};

/* schema แบบ OpenAPI ของ Gemini — ไม่รู้จัก additionalProperties แต่มี propertyOrdering */
const SCHEMA_GEMINI = {
  type: 'OBJECT',
  properties: {
    is_seeker: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    cinema: { type: 'STRING' },
    movie: { type: 'STRING' },
    seats: { type: 'STRING' },
    reason: { type: 'STRING' },
  },
  required: FIELDS,
  propertyOrdering: FIELDS,
};

/* ------------------------------------------------------------------ storage */

const store = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, r)),
  set: (o) => new Promise((r) => chrome.storage.local.set(o, r)),
};

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'c' + (h >>> 0).toString(36);
}

/* เก็บผลวิเคราะห์ไว้ ไม่ต้องจ่ายซ้ำเมื่อเจอโพสต์เดิมอีกรอบ */
async function cacheGet(key) {
  const out = await store.get(['aicache']);
  return (out.aicache || {})[key] || null;
}

async function cachePut(key, value) {
  const out = await store.get(['aicache']);
  const c = out.aicache || {};
  c[key] = value;
  const keys = Object.keys(c);
  if (keys.length > 500) keys.slice(0, keys.length - 400).forEach((k) => { delete c[k]; });
  await store.set({ aicache: c });
}

async function addStats(model, usage) {
  const out = await store.get(['aiStats']);
  const s = out.aiStats || { calls: 0, inTokens: 0, outTokens: 0, usd: 0 };
  const price = PRICING[model] || FALLBACK_PRICE;
  s.calls += 1;
  s.inTokens += usage.in;
  s.outTokens += usage.out;
  s.usd += (usage.in / 1e6) * price.in + (usage.out / 1e6) * price.out;
  await store.set({ aiStats: s });
  return s;
}

/* --------------------------------------------------------------- providers */

const USER_PREFIX = 'โพสต์:\n"""\n';
const USER_SUFFIX = '\n"""';

const PROVIDERS = {
  /* Google AI Studio — key เดียวกับที่ใส่ใน Antigravity */
  gemini: {
    label: 'Google Gemini',
    /*
     * key ของ AI Studio ขึ้นต้น AIza เสมอ ส่วน token ที่ขึ้นต้น "AQ." หรือ "ya29."
     * คือ OAuth ของบัญชี Google (เช่นที่ Antigravity ใช้ล็อกอิน) ซึ่ง endpoint นี้ไม่รับ
     */
    validateKey(key) {
      if (/^(AQ\.|ya29\.)/.test(key)) {
        return 'นี่คือ OAuth token ของบัญชี Google (แบบที่ Antigravity ใช้ล็อกอิน) ' +
               'ไม่ใช่ API key — ขอ key ที่ขึ้นต้นด้วย AIza ที่ aistudio.google.com/apikey';
      }
      if (!/^AIza/.test(key)) {
        return 'Gemini API key ต้องขึ้นต้นด้วย AIza — ขอได้ที่ aistudio.google.com/apikey';
      }
      return null;
    },
    build(model, key, text) {
      const gen = {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA_GEMINI,
        maxOutputTokens: 2048,       // เผื่อ thinking token ของรุ่นที่คิดก่อนตอบ
      };
      if (!KEEP_DEFAULT_TEMP.test(model)) gen.temperature = 0;
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models/' +
             encodeURIComponent(model) + ':generateContent',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: USER_PREFIX + text + USER_SUFFIX }] }],
          generationConfig: gen,
        },
      };
    },
    parse(json) {
      if (json.promptFeedback && json.promptFeedback.blockReason) {
        throw new Error('คำขอถูกบล็อก: ' + json.promptFeedback.blockReason);
      }
      const cand = (json.candidates || [])[0];
      if (!cand) throw new Error('ไม่มีคำตอบกลับมา');
      if (cand.finishReason === 'MAX_TOKENS') throw new Error('คำตอบถูกตัดกลางคัน (maxOutputTokens ไม่พอ)');
      if (cand.finishReason === 'SAFETY') throw new Error('คำตอบถูกกรองด้วยเหตุผลด้านความปลอดภัย');
      const part = ((cand.content && cand.content.parts) || []).find((p) => typeof p.text === 'string');
      if (!part) throw new Error('ไม่มีข้อความในคำตอบ');
      const u = json.usageMetadata || {};
      return {
        text: part.text,
        usage: { in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0 },
      };
    },
    errorMessage(status, detail, model) {
      if (status === 400 && /API key/i.test(detail)) return 'API key ไม่ถูกต้อง (400)';
      if (status === 403) return 'key ไม่มีสิทธิ์เรียก Generative Language API (403)';
      if (status === 404) return 'ไม่มีโมเดลชื่อ "' + model + '" (404)';
      if (status === 429) return 'เรียกถี่เกินโควตา (429) รอสักครู่';
      return null;
    },
  },

  /* OpenAI chat completions — ใช้ร่วมกับ custom ได้เพราะรูปแบบเดียวกัน */
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    validateKey(key) {
      return /^sk-/.test(key) ? null
        : 'OpenAI API key ต้องขึ้นต้นด้วย sk- — ขอได้ที่ platform.openai.com/api-keys';
    },
    build(model, key, text, cfg) {
      const body = {
        model,
        max_completion_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PREFIX + text + USER_SUFFIX },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'ticket_post', strict: true, schema: SCHEMA_OPENAI },
        },
      };
      if (!KEEP_DEFAULT_TEMP.test(model)) body.temperature = 0;
      return {
        url: (cfg && cfg.customUrl) || this.url,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body,
      };
    },
    parse(json) {
      const choice = (json.choices || [])[0];
      if (!choice) throw new Error('ไม่มีคำตอบกลับมา');
      if (choice.message && choice.message.refusal) {
        throw new Error('โมเดลปฏิเสธคำขอนี้: ' + choice.message.refusal);
      }
      if (choice.finish_reason === 'length') {
        throw new Error('คำตอบถูกตัดกลางคัน (max_completion_tokens ไม่พอ)');
      }
      const u = json.usage || {};
      return {
        text: choice.message.content,
        usage: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 },
      };
    },
    errorMessage(status, detail, model) {
      if (status === 401) return 'API key ไม่ถูกต้อง (401)';
      if (status === 404) return 'ไม่มีโมเดลชื่อ "' + model + '" หรือบัญชียังเข้าไม่ถึง (404)';
      if (status === 429) return 'เรียกถี่เกินไปหรือเครดิตหมด (429)';
      return null;
    },
  },
};

PROVIDERS.custom = Object.assign({}, PROVIDERS.openai, {
  label: 'Custom (OpenAI-compatible)',
  validateKey: () => null,          // ไม่รู้รูปแบบ token ของบริการปลายทาง
});

/* ----------------------------------------------------------------- classify */

/*
 * free tier ของ Gemini จำกัดจำนวนคำขอต่อนาที เปิดหลายแท็บพร้อมกันจะชน 429 ทันที
 * จึงเข้าคิวเรียกทีละคำขอ เว้นระยะขั้นต่ำระหว่างกัน และถ้าโดน 429 ให้พักยาวขึ้น
 */
let aiChain = Promise.resolve();
let lastAiCall = 0;
let cooldownUntil = 0;

function queueAi(fn) {
  const run = aiChain.then(async () => {
    const now = Date.now();
    if (now < cooldownUntil) {
      const sec = Math.ceil((cooldownUntil - now) / 1000);
      throw new Error('พักการเรียก AI อยู่ อีก ' + sec + ' วินาที (โดนจำกัดอัตรา)');
    }
    const cfg = await getCfg();
    const minGap = (cfg.aiMinGapSec || 6) * 1000;      // 6 วินาที ≈ 10 ครั้ง/นาที
    const wait = minGap - (Date.now() - lastAiCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAiCall = Date.now();
    return fn();
  });
  aiChain = run.catch(() => {});                        // คำขอถัดไปต้องไม่ตายตามกัน
  return run;
}

async function classify(text, opts) {
  const cfg = (await store.get(['cfg'])).cfg || {};
  const name = PROVIDERS[cfg.provider] ? cfg.provider : DEFAULT_PROVIDER;
  const provider = PROVIDERS[name];

  const apiKey = (cfg.apiKey || '').trim();
  if (!apiKey) throw new Error('ยังไม่ได้ใส่ API key');
  const badKey = provider.validateKey(apiKey);
  if (badKey) throw new Error(badKey);            // บอกตั้งแต่ต้น ไม่ต้องรอ API ตอบ error
  if (name === 'custom' && !(cfg.customUrl || '').trim()) {
    throw new Error('โหมด custom ต้องใส่ URL ปลายทางด้วย');
  }

  const model = (cfg.aiModel || DEFAULT_MODEL[name]).trim();
  const clipped = String(text || '').slice(0, 2000);
  const key = hash(name + '|' + model + '|' + clipped);

  if (!(opts && opts.noCache)) {
    const hit = await cacheGet(key);
    if (hit) return Object.assign({}, hit, { cached: true });
  }

  const req = provider.build(model, apiKey, clipped, cfg);

  let res;
  try {
    res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
    });
  } catch (err) {
    throw new Error('ต่อ ' + provider.label + ' ไม่ได้: ' + (err.message || err));
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j.error && (j.error.message || j.error.status)) || '';
    } catch (_) { /* ไม่ใช่ JSON */ }
    if (res.status === 429) {
      // พักยาวขึ้นเรื่อย ๆ แทนที่จะยิงซ้ำจนโดนจำกัดหนักกว่าเดิม
      const cool = (await getCfg()).aiCooldownSec || 60;
      cooldownUntil = Date.now() + cool * 1000;
    }
    const friendly = provider.errorMessage(res.status, detail, model);
    throw new Error(friendly || ('API ตอบ ' + res.status + (detail ? ': ' + detail : '')));
  }

  const parsed = provider.parse(await res.json());

  let data;
  try {
    data = JSON.parse(parsed.text);
  } catch (_) {
    throw new Error('อ่าน JSON จากคำตอบไม่ได้');
  }

  const stats = await addStats(model, parsed.usage);
  await cachePut(key, Object.assign({}, data, { model, provider: name }));
  return Object.assign({}, data, { model, provider: name, cached: false, stats });
}

/* ------------------------------------------------- ตัวขับจังหวะ + วนกลุ่ม */

/*
 * Chrome หน่วง setTimeout ของแท็บที่ถูกซ่อนเหลือ ~1 ครั้ง/นาที ถ้าให้ content script
 * จับเวลาเอง พอผู้ใช้สลับไปแท็บอื่นการสแกนจะหยุดนิ่ง จึงย้ายตัวจับจังหวะมาไว้ที่นี่
 * แล้วส่ง 'tick' เข้าไปแทน — ข้อความจากส่วนขยายถึง content script ไม่โดนหน่วง
 *
 * service worker เองก็ถูกปิดเมื่อว่าง 30 วินาที จึงตั้ง alarm ทุกครึ่งนาทีไว้ปลุก
 * ให้กลับมาตั้งตัวจับจังหวะใหม่ถ้าโดนปิดไประหว่างทาง
 */
const RUN_KEY = 'run';
const QUOTA_KEY = 'quota';
const KEEPALIVE = 'mrmoo-keepalive';
const MAX_TABS = 10;
let ticker = null;

const getRun = async () => (await store.get([RUN_KEY]))[RUN_KEY] || { active: false, tabIds: [] };
const setRun = (r) => store.set({ [RUN_KEY]: r });
const getCfg = async () => (await store.get(['cfg'])).cfg || {};

/*
 * โควตาคอมเมนต์อยู่ตรงนี้ที่เดียว ไม่ใช่ในแต่ละแท็บ
 * เพราะเปิดหลายกลุ่มพร้อมกันแล้วต่างคนต่างนับ อัตราคอมเมนต์จะทวีคูณตามจำนวนแท็บ
 * ทุกแท็บต้องมาขอสิทธิ์ที่นี่ก่อนคอมเมนต์ทุกครั้ง service worker ทำงานทีละคำขอ
 * จึงไม่มีปัญหาสองแท็บได้สิทธิ์พร้อมกัน
 */
const getQuota = async () =>
  (await store.get([QUOTA_KEY]))[QUOTA_KEY] || { stamps: [], session: 0 };

async function quotaRequest() {
  const cfg = await getCfg();
  const minGap = (cfg.minGapSec || 90) * 1000;
  const perHour = cfg.maxPerHour || 15;
  const perSession = cfg.maxPerSession || 40;

  const q = await getQuota();
  const now = Date.now();
  q.stamps = (q.stamps || []).filter((t) => now - t < 3600e3);

  if (q.session >= perSession) {
    return { ok: false, stop: 'ครบโควตาต่อรอบแล้ว (' + perSession + ')' };
  }
  if (q.stamps.length >= perHour) {
    const waitSec = Math.ceil((3600e3 - (now - q.stamps[0])) / 1000);
    return { ok: false, waitSec, reason: 'ครบโควตาต่อชั่วโมง (' + perHour + ')' };
  }
  const last = q.stamps.length ? q.stamps[q.stamps.length - 1] : 0;
  const gap = minGap - (now - last);
  if (last && gap > 0) {
    return { ok: false, waitSec: Math.ceil(gap / 1000), reason: 'เว้นระยะระหว่างคอมเมนต์' };
  }

  q.stamps.push(now);
  q.session += 1;
  await store.set({ [QUOTA_KEY]: q });
  return { ok: true, session: q.session, perSession };
}

const resetQuota = () => store.set({ [QUOTA_KEY]: { stamps: [], session: 0 } });

/*
 * ทะเบียนโพสต์ที่จัดการไปแล้ว ต้องอยู่ที่นี่ที่เดียวเหมือนโควตา
 * ถ้าให้แต่ละแท็บอ่าน-แก้-เขียนเอง แท็บที่เขียนทีหลังจะทับของแท็บอื่น
 * ทำให้บันทึกหาย แล้วโพสต์เดิมโดนคอมเมนต์ซ้ำ
 * รับได้หลายกุญแจต่อโพสต์ (id จากลิงก์ + แฮชเนื้อหา) กันกรณีอ่านลิงก์ไม่ได้
 */
async function markDone(keys) {
  const done = (await store.get(['done'])).done || {};
  const now = Date.now();
  (keys || []).filter(Boolean).forEach((k) => { done[k] = now; });

  const all = Object.keys(done);
  if (all.length > 5000) {
    all.sort((a, b) => done[a] - done[b]).slice(0, 2000).forEach((k) => { delete done[k]; });
  }
  await store.set({ done });
  return { ok: true, total: Object.keys(done).length };
}

/*
 * โควตาการโพสต์แยกจากคอมเมนต์คนละชุด นับเป็นรายวันตามเวลาเครื่อง
 * และจำว่าโพสต์กลุ่มไหนไปเมื่อไหร่ เพื่อไม่ให้ยิงซ้ำกลุ่มเดิมในวันเดียวกัน
 */
const POSTQ_KEY = 'postq';
const today = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD ตามเวลาเครื่อง

async function getPostQuota() {
  const q = (await store.get([POSTQ_KEY]))[POSTQ_KEY] || {};
  if (q.day !== today()) return { day: today(), count: 0, last: 0, groups: q.groups || {} };
  return q;
}

async function postQuotaRequest(groupKey) {
  const cfg = await getCfg();
  const perDay = cfg.postsPerDay || 3;
  const gapMs = (cfg.postGapMinutes || 120) * 60000;
  const groupMs = (cfg.postPerGroupHours || 24) * 3600e3;

  const q = await getPostQuota();
  const now = Date.now();

  if (q.count >= perDay) {
    return { ok: false, stop: 'โพสต์ครบ ' + perDay + ' โพสต์ของวันนี้แล้ว' };
  }
  if (q.last && now - q.last < gapMs) {
    return {
      ok: false,
      waitSec: Math.ceil((gapMs - (now - q.last)) / 1000),
      reason: 'เว้นระยะระหว่างโพสต์',
    };
  }
  const lastHere = (q.groups || {})[groupKey] || 0;
  if (lastHere && now - lastHere < groupMs) {
    const hrs = Math.ceil((groupMs - (now - lastHere)) / 3600e3);
    return { ok: false, reason: 'กลุ่มนี้เพิ่งโพสต์ไป รออีก ' + hrs + ' ชม.' };
  }

  q.day = today();
  q.count += 1;
  q.last = now;
  q.groups = q.groups || {};
  q.groups[groupKey] = now;
  await store.set({ [POSTQ_KEY]: q });
  return { ok: true, count: q.count, perDay };
}

const resetPostQuota = () => store.set({ [POSTQ_KEY]: { day: today(), count: 0, last: 0, groups: {} } });

function startTicker(intervalMs) {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(sendTick, Math.max(800, intervalMs || 1500));
  chrome.alarms.create(KEEPALIVE, { periodInMinutes: 0.5 });
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  chrome.alarms.clear(KEEPALIVE);
}

async function sendTick() {
  const run = await getRun();
  const tabs = run.tabIds || [];
  if (!run.active || !tabs.length) { stopTicker(); return; }
  for (const id of tabs) {
    try {
      await chrome.tabs.sendMessage(id, { type: 'tick' });
    } catch (_) {
      // แท็บกำลังโหลดหน้าใหม่ หรือถูกปิด — ปล่อยให้รอบหน้าลองใหม่
    }
  }
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== KEEPALIVE) return;
  const run = await getRun();
  if (run.active) startTicker(run.intervalMs);      // ตั้งใหม่หลัง service worker ถูกปลุก
  else stopTicker();
  statusReport(false).catch(() => {});              // ถึงรอบรายงานหรือยัง
});

/* แท็บที่กำลังทำงานถูกปิด — เอาออกจากรายการ ถ้าหมดแล้วก็จบรอบ */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const run = await getRun();
  if (!run.active) return;
  const tabIds = (run.tabIds || []).filter((id) => id !== tabId);
  if (tabIds.length) await setRun(Object.assign({}, run, { tabIds }));
  else { await setRun({ active: false, tabIds: [] }); stopTicker(); }
  await dropBot(tabId);
});

/* พาแท็บเดิมไปกลุ่มถัดไปในรายการ แล้ววนกลับต้นเมื่อครบ (โหมดแท็บเดียว) */
async function nextGroup(tabId) {
  const cfg = await getCfg();
  const urls = (cfg.groupUrls || []).filter(Boolean);
  const run = await getRun();
  if (!run.active) return { ok: false, error: 'ยังไม่ได้เริ่มทำงาน' };
  if (urls.length < 2) return { ok: false, error: 'ต้องมีลิงก์กลุ่มอย่างน้อย 2 กลุ่ม' };

  const index = ((run.index || 0) + 1) % urls.length;
  await setRun(Object.assign({}, run, { index, groupStartedAt: Date.now() }));
  await chrome.tabs.update(tabId || run.tabIds[0], { url: urls[index] });
  return { ok: true, index, url: urls[index], total: urls.length };
}

/* เปิดหลายกลุ่มพร้อมกันคนละแท็บ แล้วให้ทุกแท็บสแกนไปพร้อม ๆ กัน */
async function openGroups() {
  const cfg = await getCfg();
  const urls = (cfg.groupUrls || []).filter(Boolean).slice(0, cfg.maxTabs || MAX_TABS);
  if (!urls.length) return { ok: false, error: 'ยังไม่ได้ใส่ลิงก์กลุ่ม' };

  await stopAll(false);
  await resetQuota();

  const tabIds = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const tab = await chrome.tabs.create({ url: urls[i], active: i === 0 });
      tabIds.push(tab.id);
    } catch (err) {
      return { ok: false, error: 'เปิดแท็บไม่สำเร็จ: ' + (err.message || err) };
    }
  }

  await setRun({
    active: true, mode: 'parallel', tabIds, index: 0,
    groupStartedAt: Date.now(), intervalMs: cfg.scrollInterval,
    ownTabs: true,                        // แท็บพวกนี้เราเปิดเอง ปิดคืนได้ตอนหยุด
  });
  startTicker(cfg.scrollInterval);
  return { ok: true, opened: tabIds.length, urls };
}

/* หยุดทุกแท็บ closeTabs = ปิดแท็บที่เราเปิดเองด้วย */
async function stopAll(closeTabs) {
  const run = await getRun();
  const tabs = run.tabIds || [];
  for (const id of tabs) {
    try { await chrome.tabs.sendMessage(id, { type: 'halt' }); } catch (_) { /* ปิดไปแล้ว */ }
  }
  if (closeTabs && run.ownTabs && tabs.length) {
    try { await chrome.tabs.remove(tabs); } catch (_) { /* ปิดไปแล้ว */ }
  }
  await setRun({ active: false, tabIds: [] });
  stopTicker();
  return { ok: true, stopped: tabs.length };
}

/* ------------------------------------------------------ ข้อมูลสำหรับ dashboard */

/*
 * เก็บสถานะของแต่ละแท็บ (bot) และเหตุการณ์ที่เกิดขึ้น เพื่อให้หน้า dashboard
 * ดูย้อนหลังได้ว่าคอมเมนต์ไปที่โพสต์ไหนบ้าง แต่ละตัวรันมากี่รอบ ตั้งแต่กี่โมง
 */
const BOTS_KEY = 'bots';
const EVENTS_KEY = 'events';
const EVENTS_MAX = 400;

async function saveHeartbeat(tabId, hb) {
  if (!tabId) return { ok: false };
  const bots = (await store.get([BOTS_KEY]))[BOTS_KEY] || {};
  const prev = bots[tabId] || {};
  bots[tabId] = Object.assign({}, prev, hb, {
    tabId,
    lastSeen: Date.now(),
    startedAt: prev.startedAt || hb.startedAt || Date.now(),
  });
  await store.set({ [BOTS_KEY]: bots });
  return { ok: true };
}

async function dropBot(tabId) {
  const bots = (await store.get([BOTS_KEY]))[BOTS_KEY] || {};
  if (bots[tabId]) { delete bots[tabId]; await store.set({ [BOTS_KEY]: bots }); }
}

async function addEvent(tabId, ev) {
  const list = (await store.get([EVENTS_KEY]))[EVENTS_KEY] || [];
  list.unshift(Object.assign({ tabId, ts: Date.now() }, ev));
  if (list.length > EVENTS_MAX) list.length = EVENTS_MAX;
  await store.set({ [EVENTS_KEY]: list });
  pushWebhook(ev).catch((err) => console.log('[MR.MOO] แจ้งเตือนไม่สำเร็จ:', err.message));
  return { ok: true, total: list.length };
}

/*
 * ส่วนขยายอยู่ในเครื่องนี้เท่านั้น ถ้าอยากดูจากมือถือหรือเครื่องอื่น
 * ต้องมีปลายทางรับข้อมูล — รองรับ Telegram, Discord และ endpoint ของตัวเอง
 *
 * Telegram ใช้รูปแบบต่างจาก Discord: ต้องมีทั้ง bot token และ chat id
 * แล้วยิงไปที่ https://api.telegram.org/bot<TOKEN>/sendMessage
 */
/*
 * ต้องตรวจคำตอบด้วย ไม่ใช่แค่ยิงแล้วจบ
 * Telegram ตอบ HTTP 400 พร้อม {"ok":false,"description":"..."} เมื่อ token
 * หรือ chat_id ผิด ถ้าไม่อ่าน description จะกลายเป็นว่า "ส่งสำเร็จ" ทั้งที่เงียบสนิท
 */
async function postJson(url, body, who) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error('ต่อ ' + who + ' ไม่ได้: ' + (err.message || err));
  }

  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch (_) { /* บางเจ้าไม่ตอบ JSON */ }

  if (json && json.ok === false) {
    throw new Error(who + ' ปฏิเสธ: ' + (json.description || raw.slice(0, 150)));
  }
  if (!res.ok) {
    throw new Error(who + ' ตอบ ' + res.status + ': ' + raw.slice(0, 150));
  }
  return true;
}

/*
 * ถามราคาตั๋ว + ป๊อปคอร์นจาก MR.MOO API แล้วได้ข้อความคอมเมนต์ที่เซิร์ฟเวอร์ประกอบมาให้เลย
 * (SPEC-XT01 / ADR-0041)
 *
 * ต้องยิงจากตรงนี้เท่านั้น ห้ามยิงจาก content script: fetch ใน content script ใช้ origin ของ
 * facebook.com จึงติด CORS ส่วน service worker ใช้ host permission ของส่วนขยายเอง ไม่ผ่าน CORS
 *
 * ทุกทางที่ผิดพลาดคืน { ok:false, error } ไม่โยน exception — ฝั่งเรียกต้องคอมเมนต์ข้อความเดิม
 * ต่อไปได้เสมอแม้ API ล่ม
 */
async function fetchPrice(req) {
  const cfg = await getCfg();
  const base = (cfg.priceApiUrl || '').trim().replace(/\/+$/, '');
  const key = (cfg.priceApiKey || '').trim();
  if (!base) return { ok: false, error: 'ยังไม่ได้ใส่ URL ของ API' };
  if (!key) return { ok: false, error: 'ยังไม่ได้ใส่ API key' };

  let origin;
  try {
    origin = new URL(base).origin + '/*';
  } catch (_) {
    return { ok: false, error: 'URL ของ API ไม่ถูกต้อง' };
  }

  const allowed = await chrome.permissions.contains({ origins: [origin] });
  if (!allowed) {
    return { ok: false, error: 'ยังไม่ได้อนุญาตให้เข้าถึง ' + origin + ' — กดปุ่ม "ขอสิทธิ์เข้าถึง API" ในหน้าตั้งค่า' };
  }

  const seats = Math.min(20, Math.max(1, parseInt(req.seats, 10) || 1));
  const url = base + '/price-lookup' +
    '?cinema=' + encodeURIComponent(String(req.cinema || '').slice(0, 120)) +
    '&movie=' + encodeURIComponent(String(req.movie || '').slice(0, 200)) +
    '&seats=' + seats;

  const timeoutSec = Math.min(30, Math.max(2, parseInt(cfg.priceTimeoutSec, 10) || 8));

  let res;
  try {
    res = await fetch(url, {
      headers: { 'x-extension-api-key': key },
      signal: AbortSignal.timeout(timeoutSec * 1000),
    });
  } catch (err) {
    return {
      ok: false,
      error: err.name === 'TimeoutError'
        ? 'API ตอบช้าเกินไป (' + timeoutSec + ' วินาที)'
        : 'ต่อ API ไม่ได้: ' + (err.message || err),
    };
  }

  if (res.status === 401) return { ok: false, error: 'API key ไม่ถูกต้อง' };
  if (res.status === 429) return { ok: false, error: 'ยิงถี่เกินไป รอสักครู่แล้วลองใหม่' };
  if (!res.ok) return { ok: false, error: 'API ตอบ ' + res.status };

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    return { ok: false, error: 'API ตอบมาไม่ใช่ JSON' };
  }

  /* ข้อความคอมเมนต์ต้องมาจากเซิร์ฟเวอร์เท่านั้น ห้ามประกอบเองที่นี่ (ADR-0041) */
  const comment = data && typeof data.suggestedComment === 'string' ? data.suggestedComment.trim() : '';
  if (!comment) return { ok: false, error: 'API ไม่ได้ส่งข้อความคอมเมนต์กลับมา' };

  return { ok: true, comment, data };
}

async function sendNotify(text) {
  const cfg = await getCfg();
  const ch = cfg.notifyChannel || 'off';
  if (ch === 'off') throw new Error('ยังไม่ได้เลือกช่องทางแจ้งเตือน');

  if (ch === 'telegram') {
    const token = (cfg.tgToken || '').trim();
    const chatId = (cfg.tgChatId || '').trim();
    if (!token) throw new Error('ยังไม่ได้ใส่ bot token');
    if (!chatId) throw new Error('ยังไม่ได้ใส่ chat id');

    const ok = await chrome.permissions.contains({ origins: ['https://api.telegram.org/*'] });
    if (!ok) throw new Error('ยังไม่ได้อนุญาตให้เข้าถึง api.telegram.org — กดปุ่ม "ทดสอบส่ง" แล้วกด Allow');

    return postJson(
      'https://api.telegram.org/bot' + token + '/sendMessage',
      { chat_id: chatId, text, disable_web_page_preview: false },
      'Telegram'
    );
  }

  const url = (cfg.webhookUrl || '').trim();
  if (!/^https:\/\//.test(url)) throw new Error('ยังไม่ได้ใส่ URL ปลายทาง');

  const origin = new URL(url).origin + '/*';
  const ok = await chrome.permissions.contains({ origins: [origin] });
  if (!ok) throw new Error('ยังไม่ได้อนุญาตให้เข้าถึง ' + origin + ' — กดปุ่ม "ทดสอบส่ง" แล้วกด Allow');

  // Discord ใช้ฟิลด์ content ส่วนบริการอื่นมักใช้ text จึงส่งไปทั้งคู่
  return postJson(url, { content: text, text }, 'ปลายทาง');
}

/* ส่งเฉพาะเหตุการณ์ที่ผู้ใช้เลือกไว้ ค่าเริ่มต้นคือเฉพาะตอนคอมเมนต์สำเร็จจริง */
async function pushWebhook(ev) {
  const cfg = await getCfg();
  if (ev.kind === 'comment' && cfg.notifyComment === false) return;
  if (ev.kind === 'post' && !cfg.notifyPost) return;
  if (ev.kind === 'error' && !cfg.notifyError) return;

  const head = ev.kind === 'comment' ? '💬 คอมเมนต์แล้ว'
    : ev.kind === 'post' ? '📣 โพสต์ลงกลุ่ม'
    : '⚠️ ผิดพลาด';

  const lines = [
    '[MR.MOO] ' + head,
    ev.group ? 'กลุ่ม: ' + ev.group : '',
    ev.author ? 'เจ้าของโพสต์: ' + ev.author : '',
    ev.snippet ? 'ข้อความ: ' + ev.snippet : '',
    ev.message ? 'สาเหตุ: ' + ev.message : '',
    ev.url || '',
  ].filter(Boolean);

  await sendNotify(lines.join('\n'));
}

/* สรุปว่าตอนนี้มีบอทกี่ตัว แต่ละตัวสถานะอะไร — ส่งเป็นรอบตามที่ตั้งไว้ */
const STATUS_KEY = 'lastStatusAt';

async function statusReport(force) {
  const cfg = await getCfg();
  const everyMin = cfg.statusEveryMin || 0;
  if (!force && everyMin <= 0) return;

  const run = await getRun();
  if (!force && !run.active) return;

  const now = Date.now();
  const last = (await store.get([STATUS_KEY]))[STATUS_KEY] || 0;
  if (!force && now - last < everyMin * 60000) return;
  await store.set({ [STATUS_KEY]: now });

  const d = await dashData();
  const bots = d.bots || [];
  const running = bots.filter((b) => b.running && b.status !== 'ไม่ตอบสนอง').length;

  const lines = bots.slice(0, 12).map((b) => {
    const mark = b.running && b.status !== 'ไม่ตอบสนอง' ? '🟢' : '🔴';
    return mark + ' ' + (b.group || 'ไม่ทราบกลุ่ม').slice(0, 28) +
      ' — ' + (b.status || '-').slice(0, 34) +
      ' · ' + (b.rounds || 0) + ' รอบ · คอมเมนต์ ' + (b.commented || 0);
  });

  await sendNotify([
    '[MR.MOO] 📊 รายงานสถานะ',
    'กำลังรัน ' + running + '/' + bots.length + ' ตัว',
    '',
    lines.join('\n') || '(ไม่มีบอท)',
    '',
    'คอมเมนต์ชั่วโมงนี้ ' + d.quota.hour + '/' + d.quota.perHour +
      ' · รอบนี้ ' + d.quota.session + '/' + d.quota.perSession +
      ' · โพสต์วันนี้ ' + d.quota.posts + '/' + d.quota.postsPerDay,
  ].join('\n'));
}

async function dashData() {
  const out = await store.get([BOTS_KEY, EVENTS_KEY, QUOTA_KEY, RUN_KEY]);
  const q = await getPostQuota();
  const cfg = await getCfg();
  const now = Date.now();
  const bots = out[BOTS_KEY] || {};

  // แท็บที่เงียบเกิน 30 วินาทีถือว่าหลุดไปแล้ว
  Object.keys(bots).forEach((id) => {
    if (now - (bots[id].lastSeen || 0) > 30000 && bots[id].status !== 'หยุดแล้ว') {
      bots[id].status = 'ไม่ตอบสนอง';
    }
  });

  const cq = out[QUOTA_KEY] || { stamps: [], session: 0 };
  return {
    ok: true,
    now,
    bots: Object.values(bots).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)),
    events: out[EVENTS_KEY] || [],
    run: out[RUN_KEY] || { active: false },
    quota: {
      hour: (cq.stamps || []).filter((t) => now - t < 3600e3).length,
      perHour: cfg.maxPerHour || 15,
      session: cq.session || 0,
      perSession: cfg.maxPerSession || 40,
      posts: q.count || 0,
      postsPerDay: cfg.postsPerDay || 3,
    },
  };
}

/* ------------------------------------------------------------------ routing */

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'ai-classify' || msg.type === 'ai-test') {
    queueAi(() => classify(msg.text, { noCache: msg.type === 'ai-test' }))
      .then((data) => send({ ok: true, data }))
      .catch((err) => send({ ok: false, error: err.message }));
    return true;          // ตอบแบบ async
  }

  if (msg.type === 'ping') { send({ ok: true }); return true; }

  /* ถามราคาจาก MR.MOO API — ใช้ทั้งตอนคอมเมนต์จริงและปุ่ม "ทดสอบ" ในหน้าตั้งค่า */
  if (msg.type === 'price') {
    fetchPrice(msg)
      .then(send)
      .catch((err) => send({ ok: false, error: err.message || String(err) }));
    return true;          // ตอบแบบ async
  }

  /* content script บอกว่าเริ่มแล้ว — จำแท็บไว้เพื่อส่งจังหวะให้ */
  if (msg.type === 'run-start') {
    const tabId = _sender.tab && _sender.tab.id;
    (async () => {
      const run = await getRun();
      const tabIds = (run.active ? run.tabIds || [] : []).slice();
      if (tabIds.indexOf(tabId) === -1) tabIds.push(tabId);
      if (!run.active) await resetQuota();          // เริ่มรอบใหม่ = นับโควตาใหม่
      await setRun({
        active: true,
        mode: run.active ? run.mode : 'single',
        tabIds,
        index: run.active ? run.index : (msg.index || 0),
        groupStartedAt: run.active ? run.groupStartedAt : Date.now(),
        intervalMs: msg.intervalMs,
        ownTabs: run.active ? run.ownTabs : false,
      });
      startTicker(msg.intervalMs);
      send({ ok: true, tabId, tabs: tabIds.length });
    })();
    return true;
  }

  /* หยุดเฉพาะแท็บนี้ ถ้าเป็นแท็บสุดท้ายก็จบรอบ */
  if (msg.type === 'run-stop') {
    const tabId = _sender.tab && _sender.tab.id;
    (async () => {
      const run = await getRun();
      const tabIds = (run.tabIds || []).filter((id) => id !== tabId);
      if (tabIds.length) await setRun(Object.assign({}, run, { tabIds }));
      else { await setRun({ active: false, tabIds: [] }); stopTicker(); }
      send({ ok: true, left: tabIds.length });
    })();
    return true;
  }

  /* content script ถามตอนโหลดหน้าใหม่ว่า "ฉันคือแท็บที่กำลังทำงานอยู่ไหม" */
  if (msg.type === 'hello') {
    const tabId = _sender.tab && _sender.tab.id;
    getRun().then((run) => send({
      ok: true,
      shouldRun: !!(run.active && (run.tabIds || []).indexOf(tabId) !== -1),
      mode: run.mode || 'single',
      index: run.index || 0,
    }));
    return true;
  }

  /* ขอสิทธิ์คอมเมนต์ — โควตาใช้ร่วมกันทุกแท็บ */
  if (msg.type === 'quota') { quotaRequest().then(send); return true; }

  /* บันทึกว่าจัดการโพสต์นี้แล้ว — เขียนที่เดียวกันทุกแท็บ ไม่ทับกัน */
  if (msg.type === 'mark-done') { markDone(msg.keys).then(send); return true; }

  /* ข้อมูลสำหรับหน้า dashboard */
  if (msg.type === 'heartbeat') {
    saveHeartbeat(_sender.tab && _sender.tab.id, msg.data || {}).then(send);
    return true;
  }
  if (msg.type === 'event') {
    addEvent(_sender.tab && _sender.tab.id, msg.data || {}).then(send);
    return true;
  }
  if (msg.type === 'dash-data') { dashData().then(send); return true; }

  if (msg.type === 'notify-test') {
    sendNotify('[MR.MOO] ✅ ทดสอบการแจ้งเตือน — ต่อสำเร็จแล้ว')
      .then(() => send({ ok: true }))
      .catch((err) => send({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'notify-status') {
    statusReport(true).then(() => send({ ok: true })).catch((e) => send({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'dash-clear') {
    store.set({ [EVENTS_KEY]: [], [BOTS_KEY]: {} }).then(() => send({ ok: true }));
    return true;
  }

  /* ขอสิทธิ์โพสต์ — คนละโควตากับคอมเมนต์ นับเป็นรายวัน */
  if (msg.type === 'post-quota') { postQuotaRequest(msg.group || '').then(send); return true; }
  if (msg.type === 'post-stats') {
    getPostQuota().then((q) => getCfg().then((c) =>
      send({ ok: true, count: q.count || 0, perDay: c.postsPerDay || 3, last: q.last || 0 })));
    return true;
  }
  if (msg.type === 'post-reset') { resetPostQuota().then(() => send({ ok: true })); return true; }

  if (msg.type === 'next-group') {
    nextGroup(_sender.tab && _sender.tab.id).then(send);
    return true;
  }

  if (msg.type === 'open-groups') { openGroups().then(send); return true; }
  if (msg.type === 'stop-all') { stopAll(!!msg.closeTabs).then(send); return true; }
  if (msg.type === 'run-state') { getRun().then((r) => send({ ok: true, run: r })); return true; }

  if (msg.type === 'ai-stats') {
    store.get(['aiStats']).then((o) => send({ ok: true, stats: o.aiStats || null }));
    return true;
  }

  if (msg.type === 'ai-reset') {
    store.set({ aiStats: { calls: 0, inTokens: 0, outTokens: 0, usd: 0 }, aicache: {} })
      .then(() => send({ ok: true }));
    return true;
  }
});
