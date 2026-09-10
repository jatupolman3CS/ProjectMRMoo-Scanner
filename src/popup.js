/* MR.MOO Ticket Scanner - popup / หน้าตั้งค่า */
'use strict';

const DEFAULT_CFG = {
  autoSend: false,
  onlyGroups: true,
  expandSeeMore: true,
  scrollStep: 650,
  scrollInterval: 1400,
  minGapSec: 90,
  jitterSec: 45,
  maxPerHour: 15,
  maxPerSession: 40,
  maxAgeHours: 24,
  skipIfCommented: true,
  debugLog: true,
  aiMode: 'off',
  provider: 'gemini',
  apiKey: '',
  customUrl: '',
  aiModel: 'gemini-2.5-flash',
  aiMinConfidence: 0.6,
  maxAiCalls: 60,
  priceLookup: false,
  priceApiUrl: '',
  priceApiKey: '',
  priceMode: 'append',
  priceTimeoutSec: 8,
  rotateGroups: false,
  groupUrls: [],
  perGroupMinutes: 5,
  idleScrollsToRotate: 10,
  maxTabs: 10,
  autoPost: false,
  postsPerDay: 3,
  postGapMinutes: 120,
  postPerGroupHours: 24,
  postApprove: true,
  maxFailStreak: 3,
  posts: [],
  notifyChannel: 'off',
  webhookUrl: '',
  tgToken: '',
  tgChatId: '',
  notifyComment: true,
  notifyPost: false,
  notifyError: false,
  statusEveryMin: 15,
  qrEnabled: true,
  qrImage: null,
  qrText: '',
  globalExclude: ['ขายตั๋ว', 'ปล่อยตั๋ว', 'ส่งต่อตั๋ว', 'มีตั๋วขาย', 'ปล่อยที่นั่ง'],
  rules: [{
    id: 'r1',
    name: 'คนหาตั๋วหนัง',
    enabled: true,
    keywords: ['หาตั๋ว', 'ตามหาตั๋ว', 'รับตั๋ว', 'ขอตั๋ว', 'อยากได้ตั๋ว', 'ใครมีตั๋ว',
               'ต้องการตั๋ว', 'มีตั๋วมั้ย', 'มีตั๋วไหม', 'รับซื้อตั๋ว', 'หาบัตร', 'ตามหาบัตร',
               'major', 'เมเจอร์', 'sf', 'เอสเอฟ', 'sfx', 'sfw', 'ควอเทียร์',
               'ไอคอน', 'พารากอน', 'imax', '4dx', 'screenx', 'honeymoon',
               'โรงหนัง', 'รอบหนัง', 'รอบฉาย'],
    exclude: [],
    text: '',
    image: null,
  }],
};

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, r)),
  set: (o) => new Promise((r) => chrome.storage.local.set(o, r)),
  remove: (k) => new Promise((r) => chrome.storage.local.remove(k, r)),
};

let cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
const imageCache = {};          // key -> { dataUrl, name, size }

const BOOL_FIELDS = ['autoSend', 'onlyGroups', 'expandSeeMore', 'skipIfCommented',
                     'debugLog', 'rotateGroups', 'autoPost', 'postApprove', 'qrEnabled',
                     'notifyComment', 'notifyPost', 'notifyError', 'priceLookup'];
const NUM_FIELDS = ['minGapSec', 'maxPerHour', 'maxPerSession', 'maxAgeHours',
                    'scrollStep', 'scrollInterval', 'maxAiCalls',
                    'perGroupMinutes', 'idleScrollsToRotate', 'maxTabs',
                    'postsPerDay', 'postGapMinutes', 'postPerGroupHours', 'maxFailStreak', 'statusEveryMin',
                    'priceTimeoutSec'];
const TEXT_FIELDS = ['aiMode', 'provider', 'apiKey', 'customUrl', 'aiModel', 'webhookUrl', 'qrText',
                     'notifyChannel', 'tgToken', 'tgChatId',
                     'priceApiUrl', 'priceApiKey', 'priceMode'];
const FLOAT_FIELDS = ['aiMinConfidence'];

/* ข้อมูลเฉพาะของแต่ละผู้ให้บริการ ใช้ปรับหน้าตาช่องกรอก */
const PROVIDER_UI = {
  gemini: {
    keyLabel: 'Gemini',
    keyPlaceholder: 'AIza...',
    keyHint: 'สร้างที่ aistudio.google.com → Get API key · เป็น key ตัวเดียวกับที่ใส่ใน Antigravity',
    defaultModel: 'gemini-2.5-flash',
    models: [
      ['gemini-2.5-flash-lite', 'ถูกสุด เร็วสุด ~$0.10/$0.40 ต่อล้าน token'],
      ['gemini-2.5-flash', 'สมดุล ~$0.30/$2.50'],
      ['gemini-2.5-pro', 'แม่นสุด ~$1.25/$10'],
    ],
  },
  openai: {
    keyLabel: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keyHint: 'สร้างที่ platform.openai.com → API keys (คนละระบบกับ ChatGPT Plus)',
    defaultModel: 'gpt-4o-mini',
    models: [
      ['gpt-4o-mini', 'ถูกและเร็ว ~$0.15/$0.60'],
      ['gpt-4.1-mini', 'แม่นขึ้น ~$0.40/$1.60'],
      ['gpt-4o', '~$2.50/$10'],
      ['gpt-4.1', '~$2/$8'],
    ],
  },
  custom: {
    keyLabel: 'Bearer',
    keyPlaceholder: 'token ของบริการนั้น',
    keyHint: 'ส่งเป็น Authorization: Bearer <token> ไปยัง URL ที่ระบุ',
    defaultModel: '',
    models: [],
  },
};

const splitList = (s) => (s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const joinList = (a) => (a || []).join(', ');

/*
 * คำแนะนำสำหรับกฎ "คนหาตั๋วหนัง" — ใช้กับปุ่ม "เพิ่มคำแนะนำ"
 * จำเป็นเพราะค่าเริ่มต้นใหม่จะไม่ไปถึงคนที่บันทึกกฎของตัวเองไว้แล้ว
 */
const SUGGESTED_KEYWORDS = [
  'หาตั๋ว', 'ตามหาตั๋ว', 'รับตั๋ว', 'ขอตั๋ว', 'อยากได้ตั๋ว', 'ใครมีตั๋ว',
  'ต้องการตั๋ว', 'มีตั๋วมั้ย', 'มีตั๋วไหม', 'รับซื้อตั๋ว', 'หาบัตร', 'ตามหาบัตร',
  'major', 'เมเจอร์', 'sf', 'เอสเอฟ', 'sfx', 'sfw', 'ควอเทียร์',
  'ไอคอน', 'พารากอน', 'imax', '4dx', 'screenx', 'honeymoon',
  'โรงหนัง', 'รอบหนัง', 'รอบฉาย',
  'ป๊อบน้ำ', 'ป๊อปน้ำ', 'ป็อบน้ำ', 'ป็อปน้ำ', 'ปอบน้ำ', 'ปอปน้ำ',
  'ป๊อบคอร์น', 'ป๊อปคอร์น', 'ป็อบคอร์น', 'ป็อปคอร์น', 'popcorn',
  'ชุดป๊อบ', 'ชุดป๊อป', 'เซ็ตป๊อบ', 'เซตป๊อบ', 'คอมโบ', 'combo',
];

/* ------------------------------------------------------------------ รูปภาพ */

const MAX_EDGE = 1600;
const MAX_BYTES = 2 * 1024 * 1024;

function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    fr.readAsDataURL(file);
  });
}

function loadImg(dataUrl) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพที่อ่านได้'));
    im.src = dataUrl;
  });
}

/* ย่อรูปให้ด้านยาวสุดไม่เกิน MAX_EDGE และบีบให้ไม่เกิน ~2MB ก่อนเก็บลง storage */
async function processImage(file) {
  const raw = await readFile(file);
  const img = await loadImg(raw);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const needResize = scale < 1;
  const needCompress = raw.length * 0.75 > MAX_BYTES;

  if (!needResize && !needCompress) {
    return { dataUrl: raw, name: file.name, size: Math.round(raw.length * 0.75) };
  }

  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, cv.width, cv.height);

  let out = cv.toDataURL('image/jpeg', 0.92);
  let q = 0.92;
  while (out.length * 0.75 > MAX_BYTES && q > 0.5) {
    q -= 0.1;
    out = cv.toDataURL('image/jpeg', q);
  }
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { dataUrl: out, name, size: Math.round(out.length * 0.75) };
}

/* ------------------------------------------------------------------- render */

function ruleTemplate(rule, idx) {
  const img = imageCache[rule.image];
  const el = document.createElement('div');
  el.className = 'rule';
  el.innerHTML =
    '<div class="rule-hd">' +
      '<input type="checkbox" data-f="enabled" ' + (rule.enabled ? 'checked' : '') + '>' +
      '<input type="text" data-f="name" placeholder="ชื่อกฎ" value="">' +
      '<button class="small danger" data-act="del">ลบ</button>' +
    '</div>' +
    '<div class="field">' +
      '<label>คำที่ต้องเจอ (เจอคำใดคำหนึ่งก็ถือว่าตรง)</label>' +
      '<textarea data-f="keywords" placeholder="หาตั๋ว, ตามหาตั๋ว, ใครมีตั๋ว"></textarea>' +
      '<button class="small" data-act="suggest" style="margin-top:4px">' +
        '+ เพิ่มคำแนะนำ (ตั๋ว, โรงหนัง, ป๊อบน้ำ)</button>' +
    '</div>' +
    '<div class="field">' +
      '<label>คำที่ห้ามเจอ (เฉพาะกฎนี้)</label>' +
      '<input type="text" data-f="exclude" placeholder="เว้นว่างได้">' +
    '</div>' +
    '<div class="field">' +
      '<label>ข้อความที่จะคอมเมนต์คู่กับรูป</label>' +
      '<textarea data-f="text" placeholder="เช่น ทักแชทได้เลยครับ มีตั๋วรอบนี้"></textarea>' +
    '</div>' +
    '<div class="field">' +
      '<label>รูปที่จะคอมเมนต์</label>' +
      '<input type="file" accept="image/*" data-act="pick">' +
      '<div class="thumb">' +
        (img ? '<img src="' + img.dataUrl + '" alt="">' : '<img alt="">') +
        '<div class="meta">' +
          (img ? img.name + ' — ' + Math.round(img.size / 1024) + ' KB' : 'ยังไม่ได้เลือกรูป') +
        '</div>' +
        (img ? '<button class="small" data-act="rmimg">ลบรูป</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="sends" data-el="sends"></div>';

  el.querySelector('[data-f="name"]').value = rule.name || '';
  el.querySelector('[data-f="keywords"]').value = joinList(rule.keywords);
  el.querySelector('[data-f="exclude"]').value = joinList(rule.exclude);
  el.querySelector('[data-f="text"]').value = rule.text || '';

  /* สรุปให้เห็นชัดว่าคอมเมนต์ที่จะส่งจริงประกอบด้วยอะไรบ้าง */
  const sends = el.querySelector('[data-el="sends"]');
  function renderSends() {
    const hasText = !!(rule.text || '').trim();
    const hasImg = !!imageCache[rule.image];
    if (hasText && hasImg) {
      sends.className = 'sends ok';
      sends.textContent = 'จะคอมเมนต์: รูป 1 ใบ + ข้อความ ' +
        rule.text.trim().length + ' ตัวอักษร (ในคอมเมนต์เดียว)';
    } else if (hasImg) {
      sends.className = 'sends warn';
      sends.textContent = 'จะคอมเมนต์: รูปอย่างเดียว — ใส่ข้อความด้วยไหม?';
    } else if (hasText) {
      sends.className = 'sends warn';
      sends.textContent = 'จะคอมเมนต์: ข้อความอย่างเดียว — ยังไม่ได้เลือกรูป';
    } else {
      sends.className = 'sends bad';
      sends.textContent = 'กฎนี้ยังไม่มีทั้งรูปและข้อความ จะถูกข้าม';
    }
  }
  renderSends();

  el.querySelector('[data-f="enabled"]').onchange = (e) => { rule.enabled = e.target.checked; };
  el.querySelector('[data-f="name"]').oninput = (e) => { rule.name = e.target.value; };
  el.querySelector('[data-f="keywords"]').oninput = (e) => { rule.keywords = splitList(e.target.value); };
  el.querySelector('[data-f="exclude"]').oninput = (e) => { rule.exclude = splitList(e.target.value); };
  el.querySelector('[data-f="text"]').oninput = (e) => { rule.text = e.target.value; renderSends(); };

  /* รวมคำแนะนำเข้ากับของเดิม ไม่ลบคำที่ผู้ใช้เพิ่มไว้เอง */
  el.querySelector('[data-act="suggest"]').onclick = async () => {
    const have = (rule.keywords || []).map((k) => k.toLowerCase());
    const added = SUGGESTED_KEYWORDS.filter((k) => have.indexOf(k.toLowerCase()) === -1);
    if (!added.length) return flash('มีคำแนะนำครบแล้ว');
    rule.keywords = (rule.keywords || []).concat(added);
    el.querySelector('[data-f="keywords"]').value = joinList(rule.keywords);
    await save(true);
    flash('เพิ่ม ' + added.length + ' คำ');
  };

  el.querySelector('[data-act="del"]').onclick = async () => {
    if (rule.image) await store.remove(rule.image);
    cfg.rules.splice(idx, 1);
    if (!cfg.rules.length) cfg.rules = JSON.parse(JSON.stringify(DEFAULT_CFG.rules));
    renderRules();
  };

  el.querySelector('[data-act="pick"]').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    flash('กำลังประมวลผลรูป...', false);
    try {
      const data = await processImage(file);
      if (rule.image) await store.remove(rule.image);
      const key = 'img:' + rule.id + ':' + Date.now();
      await store.set({ [key]: data });
      imageCache[key] = data;
      rule.image = key;
      await save(true);
      renderRules();
      flash('บันทึกรูปแล้ว');
    } catch (err) {
      flash('รูปมีปัญหา: ' + err.message, true);
    }
  };

  const rm = el.querySelector('[data-act="rmimg"]');
  if (rm) rm.onclick = async () => {
    await store.remove(rule.image);
    delete imageCache[rule.image];
    rule.image = null;
    await save(true);
    renderRules();
  };

  return el;
}

function renderRules() {
  const box = $('rules');
  box.innerHTML = '';
  cfg.rules.forEach((r, i) => box.appendChild(ruleTemplate(r, i)));
}

/* ------------------------------------------------- เทมเพลตโพสต์อัตโนมัติ */

function postTemplate(tpl, idx) {
  const img = imageCache[tpl.image];
  const el = document.createElement('div');
  el.className = 'rule';
  el.innerHTML =
    '<div class="rule-hd">' +
      '<input type="checkbox" data-f="enabled" ' + (tpl.enabled ? 'checked' : '') + '>' +
      '<input type="text" data-f="name" placeholder="ชื่อเทมเพลต">' +
      '<button class="small danger" data-act="del">ลบ</button>' +
    '</div>' +
    '<div class="field">' +
      '<label>ข้อความที่จะโพสต์</label>' +
      '<textarea data-f="text" placeholder="เช่น รับจองตั๋วหนัง Major / SF ราคาพิเศษ ทักแชทได้เลย"></textarea>' +
    '</div>' +
    '<div class="field">' +
      '<label>รูปที่จะแนบไปกับโพสต์</label>' +
      '<input type="file" accept="image/*" data-act="pick">' +
      '<div class="thumb">' +
        (img ? '<img src="' + img.dataUrl + '" alt="">' : '<img alt="">') +
        '<div class="meta">' +
          (img ? img.name + ' — ' + Math.round(img.size / 1024) + ' KB' : 'ยังไม่ได้เลือกรูป') +
        '</div>' +
        (img ? '<button class="small" data-act="rmimg">ลบรูป</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="sends" data-el="sends"></div>';

  el.querySelector('[data-f="name"]').value = tpl.name || '';
  el.querySelector('[data-f="text"]').value = tpl.text || '';

  const sends = el.querySelector('[data-el="sends"]');
  function renderSends() {
    const hasText = !!(tpl.text || '').trim();
    const hasImg = !!imageCache[tpl.image];
    if (hasText || hasImg) {
      sends.className = 'sends ok';
      sends.textContent = 'จะโพสต์: ' +
        [hasImg ? 'รูป 1 ใบ' : '', hasText ? 'ข้อความ ' + tpl.text.trim().length + ' ตัวอักษร' : '']
          .filter(Boolean).join(' + ');
    } else {
      sends.className = 'sends bad';
      sends.textContent = 'เทมเพลตนี้ยังว่าง จะถูกข้าม';
    }
  }
  renderSends();

  el.querySelector('[data-f="enabled"]').onchange = (e) => { tpl.enabled = e.target.checked; };
  el.querySelector('[data-f="name"]').oninput = (e) => { tpl.name = e.target.value; };
  el.querySelector('[data-f="text"]').oninput = (e) => { tpl.text = e.target.value; renderSends(); };

  el.querySelector('[data-act="del"]').onclick = async () => {
    if (tpl.image) await store.remove(tpl.image);
    cfg.posts.splice(idx, 1);
    await save(true);
    renderPosts();
  };

  el.querySelector('[data-act="pick"]').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    flash('กำลังประมวลผลรูป...', false);
    try {
      const data = await processImage(file);
      if (tpl.image) await store.remove(tpl.image);
      const key = 'img:' + tpl.id + ':' + Date.now();
      await store.set({ [key]: data });
      imageCache[key] = data;
      tpl.image = key;
      await save(true);
      renderPosts();
      flash('บันทึกรูปแล้ว');
    } catch (err) {
      flash('รูปมีปัญหา: ' + err.message, true);
    }
  };

  const rm = el.querySelector('[data-act="rmimg"]');
  if (rm) rm.onclick = async () => {
    await store.remove(tpl.image);
    delete imageCache[tpl.image];
    tpl.image = null;
    await save(true);
    renderPosts();
  };

  return el;
}

function renderPosts() {
  const box = $('posts');
  box.innerHTML = '';
  (cfg.posts || []).forEach((t, i) => box.appendChild(postTemplate(t, i)));
  if (!cfg.posts || !cfg.posts.length) {
    box.innerHTML = '<div class="sends warn">ยังไม่มีเทมเพลตโพสต์ — กดปุ่มด้านล่างเพื่อเพิ่ม</div>';
  }
}

/* รูป QR เป็นรูปเดี่ยว ไม่ได้อยู่ในรายการเหมือนเทมเพลต จึงมีตัวจัดการของตัวเอง */
function renderQr() {
  const img = imageCache[cfg.qrImage];
  const thumb = $('qrThumb');
  const hasText = !!(cfg.qrText || '').trim();

  if (img) {
    thumb.src = img.dataUrl;
    thumb.hidden = false;
    $('qrMeta').textContent = img.name + ' — ' + Math.round(img.size / 1024) + ' KB';
    $('qrRemove').hidden = false;
  } else {
    thumb.hidden = true;
    $('qrMeta').textContent = 'ยังไม่ได้เลือกรูป';
    $('qrRemove').hidden = true;
  }

  const el = $('qrSends');
  if (!cfg.qrEnabled) {
    el.className = 'sends';
    el.textContent = 'ปิดอยู่ — จะไม่แนบ QR ใต้โพสต์';
  } else if (img || hasText) {
    el.className = 'sends ok';
    el.textContent = 'จะคอมเมนต์ใต้โพสต์ตัวเอง: ' +
      [img ? 'รูป QR' : '', hasText ? 'ข้อความ' : ''].filter(Boolean).join(' + ');
  } else {
    el.className = 'sends bad';
    el.textContent = 'เปิดไว้แต่ยังไม่มีทั้งรูปและข้อความ — จะข้ามไป';
  }
}

async function refreshPostUsage() {
  const res = await chrome.runtime.sendMessage({ type: 'post-stats' }).catch(() => null);
  $('postUsage').value = res && res.ok
    ? res.count + '/' + res.perDay + ' โพสต์'
    : '-';
}

function renderAll() {
  BOOL_FIELDS.forEach((f) => { $(f).checked = !!cfg[f]; });
  NUM_FIELDS.forEach((f) => { $(f).value = cfg[f]; });
  TEXT_FIELDS.forEach((f) => { $(f).value = cfg[f] || ''; });
  FLOAT_FIELDS.forEach((f) => { $(f).value = cfg[f]; });
  $('globalExclude').value = joinList(cfg.globalExclude);
  $('groupUrls').value = (cfg.groupUrls || []).join('\n');
  renderGroupCount();
  renderProvider(true);
  renderRules();
  renderPosts();
  renderQr();
  renderNotify();
}

/* ---------------------------------------------------------- วนหลายกลุ่ม */

const groupList = () => $('groupUrls').value.split('\n')
  .map((x) => x.trim())
  .filter((x) => /^https?:\/\//.test(x));

function renderGroupCount() {
  const urls = groupList();
  const max = parseInt($('maxTabs').value, 10) || 10;
  const el = $('groupCount');
  if (!urls.length) { el.textContent = 'ยังไม่ได้ใส่ลิงก์'; return; }
  el.textContent = urls.length + ' กลุ่ม' +
    (urls.length > max ? ' — เปิดพร้อมกันจะได้แค่ ' + max + ' กลุ่มแรก' : '');
}

async function renderRunState() {
  const el = $('runState');
  if (!el) return;
  const res = await chrome.runtime.sendMessage({ type: 'run-state' }).catch(() => null);
  const run = res && res.run;
  if (!run || !run.active) {
    el.className = 'sends';
    el.textContent = 'ยังไม่ได้เริ่มทำงาน';
    return;
  }
  el.className = 'sends ok';
  el.textContent = 'กำลังทำงาน ' + (run.tabIds || []).length + ' แท็บ' +
    (run.mode === 'parallel' ? ' (เปิดพร้อมกัน)' : ' (วนทีละกลุ่ม)');
}

/* ตรวจรูปแบบ key ให้ตรงกับที่ background.js ตรวจ จะได้เตือนตั้งแต่ตอนพิมพ์ */
function keyProblem(provider, key) {
  if (!key) return '';
  if (provider === 'gemini') {
    if (/^(AQ\.|ya29\.)/.test(key)) {
      return 'นี่คือ OAuth token ของบัญชี Google (แบบที่ Antigravity ใช้ล็อกอิน) ไม่ใช่ API key — ' +
             'ขอ key ที่ขึ้นต้นด้วย AIza ที่ aistudio.google.com/apikey';
    }
    if (!/^AIza/.test(key)) return 'Gemini API key ต้องขึ้นต้นด้วย AIza';
  }
  if (provider === 'openai' && !/^sk-/.test(key)) return 'OpenAI API key ต้องขึ้นต้นด้วย sk-';
  return '';
}

function renderKeyWarning() {
  const problem = keyProblem($('provider').value, $('apiKey').value.trim());
  const el = $('keyWarn');
  el.textContent = problem;
  el.hidden = !problem;
}

const CUSTOM_MODEL = '__custom__';   // ตัวเลือกท้ายดรอปดาวน์ สำหรับพิมพ์ชื่อรุ่นเอง

/*
 * ดรอปดาวน์เก็บแค่ "ตัวเลือกที่แสดง" ส่วนค่าจริงที่บันทึกอยู่ใน #aiModel เสมอ
 * เลือก "พิมพ์ชื่อเอง" เมื่อไหร่ ช่องข้อความจะโผล่มาให้กรอก
 */
function renderModelSelect() {
  const ui = PROVIDER_UI[$('provider').value] || PROVIDER_UI.gemini;
  const current = $('aiModel').value.trim();
  const listed = ui.models.some((m) => m[0] === current);

  $('aiModelSelect').innerHTML =
    ui.models.map((m) =>
      '<option value="' + m[0] + '">' + m[0] + ' — ' + m[1] + '</option>').join('') +
    '<option value="' + CUSTOM_MODEL + '">พิมพ์ชื่อรุ่นเอง...</option>';

  $('aiModelSelect').value = listed ? current : CUSTOM_MODEL;
  $('aiModel').hidden = listed;
}

/* ปรับ label / placeholder / รายการโมเดล ตามผู้ให้บริการที่เลือก */
function renderProvider(keepModel) {
  const name = $('provider').value;
  const ui = PROVIDER_UI[name] || PROVIDER_UI.gemini;

  $('keyLabel').textContent = ui.keyLabel;
  $('apiKey').placeholder = ui.keyPlaceholder;
  $('keyHint').textContent = ui.keyHint;
  $('customUrlField').hidden = name !== 'custom';
  renderKeyWarning();

  // สลับผู้ให้บริการแล้วชื่อโมเดลเดิมใช้ไม่ได้ — เปลี่ยนให้เป็นค่าเริ่มต้นของเจ้าใหม่
  if (!keepModel) {
    const current = $('aiModel').value.trim();
    const known = Object.values(PROVIDER_UI).some((p) =>
      p.models.some((m) => m[0] === current));
    if (!current || known) $('aiModel').value = ui.defaultModel;
  }
  renderModelSelect();
}

/* endpoint แบบ custom อยู่นอก host_permissions ต้องขอสิทธิ์ตอนผู้ใช้กดปุ่ม */
async function ensureCustomPermission() {
  if ($('provider').value !== 'custom') return true;
  const raw = $('customUrl').value.trim();
  if (!raw) { flash('ใส่ URL ปลายทางก่อน', true); return false; }

  let origin;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') { flash('URL ต้องเป็น https', true); return false; }
    origin = u.origin + '/*';
  } catch (_) {
    flash('URL ไม่ถูกต้อง', true);
    return false;
  }

  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) flash('ไม่ได้รับอนุญาตให้เข้าถึง ' + origin, true);
  return granted;
}

/* ------------------------------------------------------------ ตรวจสอบระบบ */

const row = (label, state, value) =>
  '<div><span class="k">' + label + '</span><span class="' + state + '">' + value + '</span></div>';

async function runDiagnostics() {
  const box = $('diag');
  box.hidden = false;
  box.innerHTML = 'กำลังตรวจ...';

  const lines = [];
  const fixes = [];

  // ชั้นที่ 1 — service worker
  const sw = await chrome.runtime.sendMessage({ type: 'ping' }).catch(() => null);
  lines.push(sw
    ? row('service worker', 'ok', 'ทำงาน')
    : row('service worker', 'bad', 'ไม่ตอบ'));
  if (!sw) fixes.push('ไปที่ chrome://extensions กด Reload ที่ส่วนขยายนี้ และดูว่ามีข้อความ error สีแดงไหม');

  // ชั้นที่ 2 — แท็บที่เปิดอยู่
  const tab = await activeTab();
  const onFb = tab && /facebook\.com/.test(tab.url || '');
  lines.push(onFb
    ? row('แท็บปัจจุบัน', 'ok', 'Facebook')
    : row('แท็บปัจจุบัน', 'bad', 'ไม่ใช่ Facebook'));
  if (!onFb) {
    fixes.push('เปิดแท็บหน้ากลุ่ม Facebook ก่อน แล้วกดตรวจสอบใหม่');
    box.innerHTML = lines.join('') + '<span class="fix">' + fixes.join('<br>') + '</span>';
    return;
  }

  // ชั้นที่ 3 — content script
  let res = null;
  try { res = await chrome.tabs.sendMessage(tab.id, { type: 'diagnose' }); } catch (_) {}
  if (!res || !res.ok) {
    lines.push(row('สคริปต์ในหน้าเว็บ', 'bad', 'ไม่ตอบ'));
    fixes.push('กด Reload ส่วนขยายที่ chrome://extensions แล้ว<b>รีเฟรชหน้า Facebook (F5)</b> ด้วย — ' +
               'สคริปต์จะฝังเข้าหน้าที่เปิดค้างไว้ก่อนติดตั้งไม่ได้');
    box.innerHTML = lines.join('') + '<span class="fix">' + fixes.join('<br>') + '</span>';
    return;
  }

  const r = res.report;
  lines.push(row('สคริปต์ในหน้าเว็บ', 'ok', 'ทำงาน'));
  lines.push(row('แผงควบคุมบนหน้า', r.panel ? 'ok' : 'bad', r.panel ? 'แสดงอยู่' : 'ไม่พบ'));
  lines.push(row('ตัวแปะรูป (MAIN world)', r.bridge ? 'ok' : 'bad', r.bridge ? 'ต่อติด' : 'ต่อไม่ติด'));
  if (!r.bridge) fixes.push('inject.js ไม่ทำงาน — Chrome เวอร์ชันเก่าเกินไปอาจไม่รองรับ world: MAIN');

  lines.push(row('หน้ากลุ่ม', r.isGroup ? 'ok' : 'warn', r.isGroup ? 'ใช่' : r.url));
  if (!r.isGroup) fixes.push('ไม่ได้อยู่ในหน้า /groups/ — เปิดหน้ากลุ่ม หรือปิดตัวเลือก "ทำงานเฉพาะหน้ากลุ่ม"');

  lines.push(row('โพสต์ที่มองเห็น', r.posts ? 'ok' : 'bad', r.posts + ' โพสต์'));
  if (!r.posts) fixes.push('อ่านโพสต์ไม่เจอเลย — เลื่อนหน้าลงสักหน่อยให้โพสต์โหลดขึ้นมาก่อน ' +
                           'ถ้ายังไม่เจอแปลว่า Facebook เปลี่ยน DOM แล้ว');

  lines.push(row('อ่านข้อความออก', r.readable ? 'ok' : 'bad', r.readable + '/' + r.posts));

  if (r.readHow) {
    const how = Object.keys(r.readHow).map((k) => k + '=' + r.readHow[k]).join(', ');
    lines.push(row('วิธีที่อ่านได้', r.readable ? 'ok' : 'warn', how));
  }

  // ผลสำรวจ DOM — บอกได้ว่า Facebook ยังใช้โครงสร้างเดิมอยู่ไหม
  if (r.probe) {
    const hits = Object.keys(r.probe).filter((k) => r.probe[k] > 0);
    lines.push('<span class="fix" style="color:#9aa0a6">selector ที่เจอในหน้านี้:</span>');
    Object.keys(r.probe).forEach((k) => {
      lines.push('<div><span class="k">' + escapeText(k) + '</span><span class="' +
        (r.probe[k] > 0 ? 'ok' : 'bad') + '">' + r.probe[k] + '</span></div>');
    });
    if (!hits.length) {
      fixes.push('ไม่เจอ selector ที่รู้จักเลยสักตัว — หน้านี้อาจยังโหลดไม่เสร็จ หรือไม่ใช่หน้าฟีด');
    }
  }

  if (r.kinds) {
    const k = r.kinds;
    lines.push(row('ตรงเงื่อนไข', k.match ? 'ok' : 'warn', k.match + ' โพสต์'));
    if (k.ambiguous) lines.push(row('กำกวม (ต้องใช้ AI)', 'warn', k.ambiguous + ' โพสต์'));
    if (k.blocked) lines.push(row('ติดคำฝั่งคนขาย', 'warn', k.blocked + ' โพสต์'));
    if (k.hint) lines.push(row('พูดถึงตั๋วแต่คำไม่ตรง', 'warn', k.hint + ' โพสต์'));
    if (!k.match && (k.ambiguous || k.hint)) {
      fixes.push('มีโพสต์ที่น่าสนใจแต่คีย์เวิร์ดไม่ครอบคลุม — เปิดโหมด AI "ช่วยอ่าน" หรือเพิ่มคีย์เวิร์ด');
    }
  }

  // รายการโพสต์ที่มองเห็นจริง พร้อมคำตัดสินของแต่ละอัน
  const dump = await chrome.tabs.sendMessage(tab.id, { type: 'dump' }).catch(() => null);
  if (dump && dump.ok && dump.rows.length) {
    lines.push('<span class="fix" style="color:#9aa0a6">โพสต์ที่เห็นตอนนี้:</span>');
    dump.rows.slice(0, 15).forEach((x) => {
      const good = /^ตรง /.test(x['ผล']);
      lines.push('<div><span class="k">#' + x['ลำดับ'] + ' ' +
        escapeText(x['ข้อความ'].slice(0, 45)) + '</span><span class="' +
        (good ? 'ok' : (x['ผล'] === 'ไม่ตรงคำ' ? '' : 'warn')) + '">' +
        escapeText(x['ผล']) + '</span></div>');
    });
    if (dump.rows.length > 15) {
      lines.push(row('', '', '...อีก ' + (dump.rows.length - 15) + ' โพสต์ (ดูครบใน Console F12)'));
    }
  } else if (r.sample) {
    lines.push(row('ตัวอย่างที่อ่านได้', 'ok', escapeText(r.sample)));
  }
  if (r.commentBtn !== undefined) {
    lines.push(row('ปุ่มคอมเมนต์ในโพสต์แรก', r.commentBtn ? 'ok' : 'bad', r.commentBtn ? 'เจอ' : 'ไม่เจอ'));
    if (!r.commentBtn) fixes.push('หาปุ่มคอมเมนต์ไม่เจอ — Facebook เปลี่ยนป้าย aria-label แล้ว ต้องแก้ COMMENT_BTN_RE');
  }

  lines.push(row('กฎที่พร้อมใช้', r.rulesReady ? 'ok' : 'bad',
                 r.rulesReady + '/' + r.rulesEnabled + ' (มีรูปหรือข้อความ)'));
  if (!r.rulesReady) fixes.push('ยังไม่ได้ใส่รูปหรือข้อความในกฎ — เลื่อนลงไปหัวข้อ "กฎการคอมเมนต์" แล้วใส่ก่อน');

  lines.push(row('โหมด AI', r.aiMode === 'off' ? 'warn' : (r.hasKey ? 'ok' : 'bad'),
                 r.aiMode === 'off' ? 'ปิด' : (r.aiMode + (r.hasKey ? '' : ' — ไม่มี key!'))));
  if (r.aiMode !== 'off' && !r.hasKey) fixes.push('เปิดโหมด AI ไว้แต่ยังไม่ได้ใส่ API key');

  if (r.doneCount) lines.push(row('โพสต์ที่เคยจัดการ', 'warn', r.doneCount + ' รายการ (ถูกข้ามอัตโนมัติ)'));

  box.innerHTML = lines.join('') +
    (fixes.length ? '<span class="fix">' + fixes.join('<br>') + '</span>'
                  : '<span class="fix">ทุกอย่างพร้อม — กด "เริ่มสแกน" ได้เลย</span>');
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ----------------------------------------------------------- แจ้งเตือน */

function showNotifyResult(cls, text) {
  const el = $('notifyResult');
  el.className = 'sends ' + cls;
  el.textContent = text;
}

function renderNotify() {
  const ch = $('notifyChannel').value;
  $('tgFields').hidden = ch !== 'telegram';
  $('hookField').hidden = ch !== 'discord' && ch !== 'custom';

  const el = $('notifyResult');
  if (ch === 'off') {
    el.className = 'sends';
    el.textContent = 'ปิดอยู่ — ไม่ส่งแจ้งเตือนไปไหน';
    return;
  }
  const ready = ch === 'telegram'
    ? !!($('tgToken').value.trim() && $('tgChatId').value.trim())
    : /^https:\/\//.test($('webhookUrl').value.trim());

  const kinds = [
    $('notifyComment').checked ? 'คอมเมนต์' : '',
    $('notifyPost').checked ? 'โพสต์' : '',
    $('notifyError').checked ? 'ข้อผิดพลาด' : '',
  ].filter(Boolean);
  const every = parseInt($('statusEveryMin').value, 10) || 0;

  el.className = 'sends ' + (ready ? 'ok' : 'bad');
  el.textContent = ready
    ? 'จะแจ้ง: ' + (kinds.join(' + ') || 'ไม่มีเหตุการณ์ใดเลย') +
      (every ? ' · รายงานสถานะทุก ' + every + ' นาที' : '')
    : (ch === 'telegram' ? 'ยังใส่ token หรือ chat id ไม่ครบ' : 'ยังไม่ได้ใส่ URL');
}

/* ปลายทางแจ้งเตือนอยู่นอก host_permissions ต้องขอสิทธิ์ตอนผู้ใช้กดปุ่ม */
async function ensureNotifyPermission() {
  const ch = $('notifyChannel').value;
  if (ch === 'off') return true;

  const raw = ch === 'telegram'
    ? 'https://api.telegram.org/'
    : $('webhookUrl').value.trim();
  if (!raw) return true;

  let origin;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') { flash('URL ต้องเป็น https', true); return false; }
    origin = u.origin + '/*';
  } catch (_) {
    flash('URL แจ้งเตือนไม่ถูกต้อง', true);
    return false;
  }

  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) flash('ไม่ได้รับอนุญาตให้เข้าถึง ' + origin, true);
  return granted;
}

/* ------------------------------------------------- สำรอง/กู้คืนเป็นไฟล์ JSON */

const EXPORT_VERSION = 1;

/*
 * รูปภาพถูกเก็บแยกเป็นคีย์ 'img:...' ใน storage ไม่ได้อยู่ใน cfg
 * ตอน export จึงต้องหอบไปด้วย ไม่งั้นย้ายเครื่องแล้วรูปหาย
 */
async function exportSettings() {
  await save(true);
  const all = await store.get(null);
  const images = {};
  Object.keys(all).forEach((k) => {
    if (k.indexOf('img:') === 0) images[k] = all[k];
  });

  const payload = {
    app: 'mrmoo-ticket-scanner',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    cfg: all.cfg || cfg,
    images,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mrmoo-settings-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  const kb = Math.round(blob.size / 1024);
  flash('ดาวน์โหลดแล้ว (' + Object.keys(images).length + ' รูป, ' + kb + ' KB)');
}

async function importSettings(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (_) {
    return flash('ไฟล์นี้ไม่ใช่ JSON ที่อ่านได้', true);
  }
  if (!data || data.app !== 'mrmoo-ticket-scanner' || !data.cfg) {
    return flash('ไม่ใช่ไฟล์ตั้งค่าของส่วนขยายนี้', true);
  }

  // เขียนรูปกลับเข้า storage ก่อน แล้วค่อยเขียน cfg ที่อ้างถึงรูปพวกนั้น
  const images = data.images || {};
  if (Object.keys(images).length) await store.set(images);

  cfg = Object.assign({}, DEFAULT_CFG, data.cfg);
  if (!Array.isArray(cfg.rules) || !cfg.rules.length) {
    cfg.rules = JSON.parse(JSON.stringify(DEFAULT_CFG.rules));
  }
  if (!Array.isArray(cfg.posts)) cfg.posts = [];
  await store.set({ cfg });

  Object.keys(images).forEach((k) => { imageCache[k] = images[k]; });
  renderAll();
  flash('โหลดการตั้งค่าแล้ว (' + cfg.rules.length + ' กฎ, ' +
        cfg.posts.length + ' เทมเพลตโพสต์, ' + Object.keys(images).length + ' รูป)');
}

/* ------------------------------------------------------------------- AI */

async function refreshAiUsage() {
  const res = await chrome.runtime.sendMessage({ type: 'ai-stats' }).catch(() => null);
  const s = res && res.stats;
  $('aiUsage').value = s && s.calls
    ? s.calls + ' ครั้ง · $' + s.usd.toFixed(4)
    : 'ยังไม่ได้เรียก';
}

function showAiResult(cls, text) {
  const el = $('aiResult');
  el.className = 'airesult ' + cls;
  el.textContent = text;
}

function showPriceResult(cls, text) {
  const el = $('priceResult');
  el.className = 'airesult ' + cls;
  el.textContent = text;
}

/* origin ที่ต้องขอสิทธิ์ อ่านจากค่าที่กรอกจริง ไม่ hardcode — ชี้ localhost ก็ได้ */
function priceApiOrigin() {
  try {
    return new URL($('priceApiUrl').value.trim()).origin + '/*';
  } catch (_) {
    return null;
  }
}

async function runAiTest() {
  const text = $('aiTest').value.trim();
  if (!text) return showAiResult('err', 'ใส่ข้อความที่จะทดสอบก่อน');
  if (!$('apiKey').value.trim()) return showAiResult('err', 'ยังไม่ได้ใส่ API key');

  await save(true);                       // ให้ service worker เห็น key/โมเดลล่าสุด
  showAiResult('', 'กำลังถาม AI...');

  const res = await chrome.runtime.sendMessage({ type: 'ai-test', text }).catch((e) => ({
    ok: false, error: String(e && e.message ? e.message : e),
  }));

  if (!res || !res.ok) return showAiResult('err', 'ล้มเหลว: ' + ((res && res.error) || 'ไม่ทราบสาเหตุ'));

  const d = res.data;
  const conf = typeof d.confidence === 'number' ? d.confidence.toFixed(2) : '-';
  const pass = d.is_seeker && d.confidence >= parseFloat($('aiMinConfidence').value || '0.6');
  showAiResult(pass ? 'ok' : 'no', [
    (d.is_seeker ? '✓ เป็นคนหาตั๋ว' : '✗ ไม่ใช่คนหาตั๋ว') + ' · มั่นใจ ' + conf,
    d.cinema ? 'โรง: ' + d.cinema : '',
    d.movie ? 'เรื่อง: ' + d.movie : '',
    d.seats ? 'จำนวน: ' + d.seats : '',
    d.reason ? 'เหตุผล: ' + d.reason : '',
    pass ? 'ผลลัพธ์: จะคอมเมนต์' : 'ผลลัพธ์: จะข้าม',
  ].filter(Boolean).join('\n'));

  refreshAiUsage();
}

/* ------------------------------------------------------------------- บันทึก */

function collect() {
  BOOL_FIELDS.forEach((f) => { cfg[f] = $(f).checked; });
  NUM_FIELDS.forEach((f) => {
    const v = parseInt($(f).value, 10);
    if (!isNaN(v)) cfg[f] = v;
  });
  TEXT_FIELDS.forEach((f) => { cfg[f] = $(f).value.trim(); });
  FLOAT_FIELDS.forEach((f) => {
    const v = parseFloat($(f).value);
    if (!isNaN(v)) cfg[f] = v;
  });
  cfg.globalExclude = splitList($('globalExclude').value);
  cfg.groupUrls = $('groupUrls').value.split('\n')
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//.test(x));
}

let flashTimer = null;
function flash(msg, isErr) {
  const el = $('saved');
  el.textContent = msg;
  el.style.color = isErr ? '#f87171' : '#4ade80';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.textContent = ''; }, 2500);
}

async function save(quiet) {
  if (!(await ensureCustomPermission())) return false;
  if (!(await ensureNotifyPermission())) return false;
  collect();
  await store.set({ cfg });
  if (!quiet) flash('บันทึกแล้ว');
  return true;
}

/* ------------------------------------------------------- คุยกับหน้า Facebook */

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function sendToTab(type) {
  const tab = await activeTab();
  if (!tab || !/facebook\.com/.test(tab.url || '')) {
    flash('เปิดแท็บ Facebook ก่อนนะครับ', true);
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type });
  } catch (_) {
    flash('เชื่อมต่อหน้าเว็บไม่ได้ — ลองรีเฟรชหน้า Facebook', true);
    return null;
  }
}

async function pollStatus() {
  const tab = await activeTab();
  const conn = $('conn');
  if (!tab || !/facebook\.com/.test(tab.url || '')) {
    conn.textContent = 'ไม่ได้อยู่บน Facebook';
    conn.className = 'pill';
    return;
  }
  let res = null;
  try { res = await chrome.tabs.sendMessage(tab.id, { type: 'status' }); } catch (_) {}
  if (!res) {
    conn.textContent = 'ยังไม่เชื่อมต่อ';
    conn.className = 'pill';
    return;
  }
  conn.textContent = res.running ? 'กำลังทำงาน' : 'พร้อมทำงาน';
  conn.className = 'pill' + (res.running ? ' on' : '');
  $('s-scan').textContent = res.scanned;
  $('s-match').textContent = res.matched;
  $('s-sent').textContent = res.sent;
  $('s-skip').textContent = res.skipped;
}

/* --------------------------------------------------------------------- boot */

/*
 * ถ้าโค้ดตอนเริ่มพัง ปุ่มทั้งหมดจะไม่ถูกผูกและหน้าจะดูเหมือน "กดอะไรก็ไม่ติด"
 * จึงดักไว้แล้วแสดงข้อความจริงออกมา แทนที่จะเงียบไปเฉย ๆ
 */
function showBootError(message) {
  const box = $('diag');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = '<div><span class="k">หน้าตั้งค่าโหลดไม่สำเร็จ</span>' +
    '<span class="bad">พัง</span></div>' +
    '<span class="fix">' + escapeText(String(message)) + '</span>';
}

window.addEventListener('error', (e) => showBootError(e.message));

(async () => {
  try {
  const out = await store.get(null);
  cfg = Object.assign({}, DEFAULT_CFG, out.cfg || {});
  if (!Array.isArray(cfg.rules) || !cfg.rules.length) {
    cfg.rules = JSON.parse(JSON.stringify(DEFAULT_CFG.rules));
  }
  Object.keys(out).forEach((k) => {
    if (k.indexOf('img:') === 0) imageCache[k] = out[k];
  });

  renderAll();
  pollStatus();
  refreshAiUsage();
  refreshPostUsage();
  renderRunState();
  setInterval(pollStatus, 1500);
  setInterval(renderRunState, 2000);
  setInterval(refreshPostUsage, 5000);

  $('btn-save').onclick = () => save(false);

  $('notifyChannel').onchange = renderNotify;
  ['tgToken', 'tgChatId', 'webhookUrl', 'statusEveryMin'].forEach((id) => {
    $(id).oninput = renderNotify;
  });
  ['notifyComment', 'notifyPost', 'notifyError'].forEach((id) => {
    $(id).onchange = renderNotify;
  });

  /*
   * ปุ่มของส่วน "ถามราคาจาก MR.MOO" — ขอสิทธิ์เป็นคำสั่งแรกของ handler ด้วยเหตุผลเดียวกับ
   * ปุ่มแจ้งเตือนด้านล่าง (เสีย user gesture ถ้ามี await คั่นก่อน)
   */
  $('btn-priceperm').onclick = async () => {
    const origin = priceApiOrigin();
    if (!origin) return showPriceResult('err', 'URL ของ API ไม่ถูกต้อง');

    const granted = await chrome.permissions.request({ origins: [origin] });
    showPriceResult(granted ? 'ok' : 'err', granted
      ? 'อนุญาตให้เข้าถึง ' + origin + ' แล้ว'
      : 'Chrome ไม่ได้อนุญาตให้เข้าถึง ' + origin);
  };

  $('btn-pricetest').onclick = async () => {
    const origin = priceApiOrigin();
    if (!origin) return showPriceResult('err', 'URL ของ API ไม่ถูกต้อง');
    if (!$('priceApiKey').value.trim()) return showPriceResult('err', 'ยังไม่ได้ใส่ API key');

    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) return showPriceResult('err', 'Chrome ไม่ได้อนุญาตให้เข้าถึง ' + origin);

    collect();
    await store.set({ cfg });          // ให้ service worker เห็น URL/key ล่าสุด
    showPriceResult('', 'กำลังถามราคา...');

    const res = await chrome.runtime.sendMessage({
      type: 'price',
      cinema: $('priceTestCinema').value.trim(),
      movie: '',
      seats: 2,
    }).catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) }));

    if (!res || !res.ok) return showPriceResult('err', 'ไม่สำเร็จ: ' + ((res && res.error) || 'ไม่ทราบสาเหตุ'));

    /* โชว์ข้อความที่เซิร์ฟเวอร์ประกอบมาตรง ๆ นี่คือสิ่งที่จะถูกโพสต์จริง */
    showPriceResult('ok', res.comment);
  };

  /*
   * chrome.permissions.request ต้องถูกเรียก "ทันที" ที่ผู้ใช้คลิก
   * ถ้ามี await อื่นคั่นก่อน Chrome จะถือว่าเสีย user gesture แล้วปฏิเสธเงียบ ๆ
   * จึงต้องขอสิทธิ์เป็นคำสั่งแรกสุดของ handler ก่อนบันทึกค่าใด ๆ
   */
  $('btn-notifytest').onclick = async () => {
    const ch = $('notifyChannel').value;
    if (ch === 'off') return showNotifyResult('bad', 'เลือกช่องทางก่อน');

    let origin = 'https://api.telegram.org/*';
    if (ch !== 'telegram') {
      const raw = $('webhookUrl').value.trim();
      try { origin = new URL(raw).origin + '/*'; }
      catch (_) { return showNotifyResult('bad', 'URL ปลายทางไม่ถูกต้อง'); }
    }

    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) return showNotifyResult('bad', 'Chrome ไม่ได้อนุญาตให้เข้าถึง ' + origin);

    collect();
    await store.set({ cfg });
    showNotifyResult('', 'กำลังส่ง...');

    const res = await chrome.runtime.sendMessage({ type: 'notify-test' }).catch(() => null);
    if (res && res.ok) showNotifyResult('ok', 'ส่งแล้ว — ไปเช็คใน Telegram ได้เลย');
    else showNotifyResult('bad', 'ส่งไม่สำเร็จ: ' + ((res && res.error) || 'ไม่ทราบสาเหตุ'));
  };

  $('btn-notifystatus').onclick = async () => {
    const ch = $('notifyChannel').value;
    if (ch === 'off') return showNotifyResult('bad', 'เลือกช่องทางก่อน');

    let origin = 'https://api.telegram.org/*';
    if (ch !== 'telegram') {
      try { origin = new URL($('webhookUrl').value.trim()).origin + '/*'; }
      catch (_) { return showNotifyResult('bad', 'URL ปลายทางไม่ถูกต้อง'); }
    }
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) return showNotifyResult('bad', 'Chrome ไม่ได้อนุญาตให้เข้าถึง ' + origin);

    collect();
    await store.set({ cfg });
    showNotifyResult('', 'กำลังส่งรายงาน...');
    const res = await chrome.runtime.sendMessage({ type: 'notify-status' }).catch(() => null);
    if (res && res.ok) showNotifyResult('ok', 'ส่งรายงานสถานะแล้ว');
    else showNotifyResult('bad', 'ส่งไม่สำเร็จ: ' + ((res && res.error) || 'ไม่ทราบสาเหตุ'));
  };

  $('btn-export').onclick = exportSettings;
  $('btn-import').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';                       // เลือกไฟล์เดิมซ้ำได้
    if (f) await importSettings(f);
  };
  $('provider').onchange = () => renderProvider(false);

  $('aiModelSelect').onchange = (e) => {
    if (e.target.value === CUSTOM_MODEL) {
      $('aiModel').hidden = false;
      $('aiModel').focus();
    } else {
      $('aiModel').value = e.target.value;
      $('aiModel').hidden = true;
    }
  };
  $('apiKey').oninput = renderKeyWarning;
  $('btn-aitest').onclick = runAiTest;
  $('btn-diag').onclick = runDiagnostics;

  $('btn-dash').onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') });
  };

  $('btn-addpost').onclick = async () => {
    if (!Array.isArray(cfg.posts)) cfg.posts = [];
    cfg.posts.push({
      id: 'p' + Date.now().toString(36),
      name: 'โพสต์ใหม่',
      enabled: true,
      text: '',
      image: null,
    });
    await save(true);
    renderPosts();
  };

  $('qrEnabled').onchange = (e) => { cfg.qrEnabled = e.target.checked; renderQr(); };
  $('qrText').oninput = (e) => { cfg.qrText = e.target.value; renderQr(); };

  $('qrPick').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    flash('กำลังประมวลผลรูป QR...', false);
    try {
      const data = await processImage(file);
      if (cfg.qrImage) await store.remove(cfg.qrImage);
      const key = 'img:qr:' + Date.now();
      await store.set({ [key]: data });
      imageCache[key] = data;
      cfg.qrImage = key;
      await save(true);
      renderQr();
      flash('บันทึกรูป QR แล้ว');
    } catch (err) {
      flash('รูปมีปัญหา: ' + err.message, true);
    }
  };

  $('qrRemove').onclick = async () => {
    if (cfg.qrImage) await store.remove(cfg.qrImage);
    delete imageCache[cfg.qrImage];
    cfg.qrImage = null;
    await save(true);
    renderQr();
  };

  $('btn-postreset').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'post-reset' }).catch(() => {});
    flash('รีเซ็ตตัวนับโพสต์ของวันนี้แล้ว');
    refreshPostUsage();
  };

  $('groupUrls').oninput = renderGroupCount;
  $('maxTabs').oninput = renderGroupCount;

  $('btn-open').onclick = async () => {
    const urls = groupList();
    if (!urls.length) return flash('ใส่ลิงก์กลุ่มก่อน (บรรทัดละ 1 ลิงก์)', true);
    await save(true);
    const max = parseInt($('maxTabs').value, 10) || 10;
    flash('กำลังเปิด ' + Math.min(urls.length, max) + ' แท็บ...');
    const res = await chrome.runtime.sendMessage({ type: 'open-groups' }).catch(() => null);
    if (!res || !res.ok) return flash('เปิดไม่สำเร็จ: ' + ((res && res.error) || '-'), true);
    flash('เปิดแล้ว ' + res.opened + ' กลุ่ม — ทุกแท็บจะเริ่มสแกนเอง');
    renderRunState();
  };

  $('btn-stopall').onclick = async () => {
    const res = await chrome.runtime.sendMessage({ type: 'stop-all', closeTabs: true })
      .catch(() => null);
    flash(res && res.ok ? 'หยุดแล้ว ' + res.stopped + ' แท็บ' : 'สั่งหยุดไม่สำเร็จ', !(res && res.ok));
    renderRunState();
  };
  $('btn-aireset').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'ai-reset' }).catch(() => {});
    showAiResult('', 'ล้างสถิติและแคชแล้ว');
    refreshAiUsage();
  };

  $('btn-add').onclick = () => {
    cfg.rules.push({
      id: 'r' + Date.now().toString(36),
      name: 'กฎใหม่',
      enabled: true,
      keywords: [],
      exclude: [],
      text: '',
      image: null,
    });
    renderRules();
  };

  $('btn-start').onclick = async () => {
    await save(true);
    const res = await sendToTab('start');
    if (res) flash('สั่งเริ่มแล้ว');
  };

  $('btn-stop').onclick = async () => {
    const res = await sendToTab('stop');
    if (res) flash('สั่งหยุดแล้ว');
  };

  $('btn-clear').onclick = async () => {
    await store.set({ done: {} });
    flash('ล้างประวัติโพสต์แล้ว — โพสต์เก่าจะถูกนำมาพิจารณาใหม่');
  };
  } catch (err) {
    showBootError(err && err.stack ? err.stack : err);
  }
})();
