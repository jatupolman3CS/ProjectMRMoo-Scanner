/*
 * MR.MOO Ticket Scanner - content script (ISOLATED world)
 * เลื่อนฟีดกลุ่ม Facebook -> หาโพสต์ที่ "ตามหาตั๋วหนัง" -> คอมเมนต์รูปที่เตรียมไว้
 */
(() => {
  'use strict';
  if (window.__mrmooContent) return;
  window.__mrmooContent = true;

  /* ---------------------------------------------------------------- config */

  const DEFAULT_CFG = {
    autoSend: false,          // false = ขึ้นกล่องให้กดยืนยันก่อนส่งทุกโพสต์
    onlyGroups: true,         // ทำงานเฉพาะ URL /groups/
    expandSeeMore: true,      // กด "ดูเพิ่มเติม" ก่อนอ่านข้อความ
    scrollStep: 650,          // px ต่อการเลื่อน 1 ครั้ง
    scrollInterval: 1400,     // ms ระหว่างการเลื่อน
    minGapSec: 90,            // เว้นระยะขั้นต่ำระหว่างคอมเมนต์
    jitterSec: 45,
    maxPerHour: 15,
    maxPerSession: 40,
    maxAgeHours: 24,          // เลื่อนย้อนหลังไม่เกินกี่ชั่วโมง (0 = ไม่จำกัด)
                              // ใช้ทั้งข้ามโพสต์เก่า และหยุดเลื่อนเมื่อพ้นช่วงนี้
    skipIfCommented: true,    // ข้ามถ้าเหมือนเคยคอมเมนต์ไปแล้ว
    debugLog: true,           // บอกเหตุผลทุกครั้งที่ข้ามโพสต์
    traceLog: false,          // รายงานทุกโพสต์ที่ผ่านสายตา รวมที่ไม่ตรงคำ

    // --- วนหลายกลุ่มอัตโนมัติ ---
    rotateGroups: false,
    maxTabs: 10,              // เปิดพร้อมกันได้สูงสุดกี่กลุ่ม
    groupUrls: [],            // ลิงก์กลุ่ม เรียงตามลำดับที่จะวน
    perGroupMinutes: 5,       // อยู่กลุ่มละกี่นาทีก่อนไปกลุ่มถัดไป
    idleScrollsToRotate: 10,  // หรือไปเลยถ้าไม่เจอโพสต์ใหม่ติดกันเท่านี้ครั้ง

    // --- ให้ AI ช่วยอ่านเนื้อหา ---
    aiMode: 'off',            // off | verify (ตรวจซ้ำที่คีย์เวิร์ดจับได้) | assist (ช่วยดูโพสต์ที่คีย์เวิร์ดไม่ตรงด้วย)
    provider: 'gemini',       // gemini | openai | custom — ดูรายละเอียดใน background.js
    apiKey: '',
    customUrl: '',
    aiModel: 'gemini-2.5-flash',
    aiMinConfidence: 0.6,
    maxAiCalls: 60,           // เพดานการเรียก AI ต่อรอบ กันค่าใช้จ่ายบานปลาย

    // --- ถามราคาจาก MR.MOO API แล้วเอามาคอมเมนต์ (SPEC-XT02) ---
    priceLookup: false,       // ปิดไว้ก่อน ต้องกรอก URL + key ในหน้าตั้งค่าถึงจะทำงาน
    priceApiUrl: '',          // เช่น https://api-mrmoomovie.siristudiophoto.com/api/v1
    priceApiKey: '',          // ค่าเดียวกับ ExtensionApi__ApiKey บนเซิร์ฟเวอร์
    priceMode: 'append',      // append = ต่อท้ายข้อความของ rule · replace = ใช้ของ API อย่างเดียว
    priceTimeoutSec: 8,

    // --- โพสต์อัตโนมัติ (คนละโควตากับคอมเมนต์) ---
    autoPost: false,
    postsPerDay: 3,
    postGapMinutes: 120,      // เว้นระยะระหว่างโพสต์
    postPerGroupHours: 24,    // ไม่โพสต์ซ้ำกลุ่มเดิมภายในกี่ชั่วโมง
    maxFailStreak: 3,         // คอมเมนต์พลาดติดกันกี่ครั้งถึงจะหยุดบอทตัวนั้น
    postApprove: true,        // ยืนยันก่อนโพสต์ทุกครั้ง
    posts: [],                // เทมเพลตโพสต์ {id, name, enabled, text, image}
    qrEnabled: true,          // คอมเมนต์ QR ไลน์ใต้โพสต์ของตัวเองหลังโพสต์เสร็จ
    qrImage: null,
    qrText: '',

    // "ขายต่อ" ถูกถอดออกจากรายการนี้แล้ว เพราะคนหาตั๋วมักเขียนว่า "ใครขายต่อบ้าง"
    globalExclude: ['ขายตั๋ว', 'ปล่อยตั๋ว', 'ส่งต่อตั๋ว', 'มีตั๋วขาย', 'ปล่อยที่นั่ง'],
    rules: [{
      id: 'r1',
      name: 'คนหาตั๋วหนัง',
      enabled: true,
      keywords: ['หาตั๋ว', 'ตามหาตั๋ว', 'รับตั๋ว', 'ขอตั๋ว', 'อยากได้ตั๋ว', 'ใครมีตั๋ว',
                 'ต้องการตั๋ว', 'มีตั๋วมั้ย', 'มีตั๋วไหม', 'รับซื้อตั๋ว', 'หาบัตร', 'ตามหาบัตร',
                 // ชื่อเครือโรงหนัง — คนมักพิมพ์ชื่อโรงแทนคำว่าตั๋ว
                 'major', 'เมเจอร์', 'sf', 'เอสเอฟ', 'sfx', 'sfw', 'ควอเทียร์',
                 'ไอคอน', 'พารากอน', 'imax', '4dx', 'screenx', 'honeymoon',
                 'โรงหนัง', 'รอบหนัง', 'รอบฉาย',
                 // ชุดป๊อปคอร์น+น้ำ สะกดได้หลายแบบ ต้องใส่ให้ครบทุกตัว
                 'ป๊อบน้ำ', 'ป๊อปน้ำ', 'ป็อบน้ำ', 'ป็อปน้ำ', 'ปอบน้ำ', 'ปอปน้ำ',
                 'ป๊อบคอร์น', 'ป๊อปคอร์น', 'ป็อบคอร์น', 'ป็อปคอร์น', 'popcorn',
                 'ชุดป๊อบ', 'ชุดป๊อป', 'เซ็ตป๊อบ', 'เซตป๊อบ', 'คอมโบ', 'combo'],
      exclude: [],
      text: '',
      image: null,           // key ของรูปใน chrome.storage.local
    }],
  };

  let CFG = Object.assign({}, DEFAULT_CFG);

  const state = {
    running: false,
    busy: false,
    stopReason: '',
    lastCommentAt: 0,
    sessionCount: 0,
    hourStamps: [],
    scanned: 0,
    matched: 0,
    skipped: 0,
    aiCalls: 0,
    idleScrolls: 0,
    oldStreak: 0,
    posting: false,
    postIndex: 0,
    failStreak: 0,
    rounds: 0,
    startedAt: 0,
    mode: 'single',
    groupStartedAt: 0,
    groupIndex: 0,
    rotating: false,
    timer: null,
  };

  const seenEls = new WeakSet();
  let doneIds = {};           // postId -> timestamp

  /* --------------------------------------------------------------- storage */

  const store = {
    get: (keys) => new Promise((r) => chrome.storage.local.get(keys, r)),
    set: (obj) => new Promise((r) => chrome.storage.local.set(obj, r)),
  };

  async function loadConfig() {
    const out = await store.get(['cfg', 'done']);
    CFG = Object.assign({}, DEFAULT_CFG, out.cfg || {});
    if (!Array.isArray(CFG.rules) || !CFG.rules.length) CFG.rules = DEFAULT_CFG.rules;
    doneIds = out.done || {};
  }

  /*
   * ให้ service worker เป็นคนเขียนทะเบียน เพราะหลายแท็บเขียนพร้อมกันจะทับกัน
   * แล้วบันทึกหาย ทำให้โพสต์เดิมโดนคอมเมนต์ซ้ำ
   */
  async function markDone(keys) {
    const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    list.forEach((k) => { doneIds[k] = Date.now(); });      // อัปเดตในแท็บนี้ทันที
    const res = await chrome.runtime.sendMessage({ type: 'mark-done', keys: list })
      .catch(() => null);
    if (!res) await store.set({ done: doneIds });            // สำรองถ้าคุยกับ SW ไม่ได้
  }

  const isDone = (keys) => keys.some((k) => k && doneIds[k]);

  /* -------------------------------------------------- รายงานไปหน้า dashboard */

  let lastBeat = 0;

  function heartbeat(force) {
    const now = Date.now();
    if (!force && now - lastBeat < 4000) return;      // ไม่ต้องรายงานถี่เกินจำเป็น
    lastBeat = now;
    chrome.runtime.sendMessage({
      type: 'heartbeat',
      data: {
        group: groupName(),
        url: location.href,
        status: state.running ? (state.posting ? 'กำลังโพสต์' : statusPlain())
                              : ('หยุดแล้ว' + (state.stopReason ? ' — ' + state.stopReason : '')),
        running: state.running,
        startedAt: state.startedAt || 0,
        rounds: state.rounds,
        scanned: state.scanned,
        matched: state.matched,
        commented: state.sessionCount,
        skipped: state.skipped,
        aiCalls: state.aiCalls,
        hidden: document.hidden,
      },
    }).catch(() => {});
  }

  const sendEvent = (data) =>
    chrome.runtime.sendMessage({ type: 'event', data }).catch(() => {});

  function groupName() {
    const h = document.querySelector('h1');
    const t = h ? (h.innerText || '').trim() : '';
    return t || groupKey();
  }

  /* ข้อความสถานะแบบไม่มี HTML entity ปนมา */
  function statusPlain() {
    return String(statusText).replace(/&[a-z]+;/g, ' ').trim() || 'กำลังทำงาน';
  }

  /* ลิงก์ถาวรของโพสต์ ใช้ให้กดจาก dashboard ไปดูของจริงได้ */
  function postUrl(post) {
    const a = post.querySelector(
      'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], ' +
      'a[href*="multi_permalinks="], a[href*="/videos/"]'
    );
    if (!a || !a.href) return '';
    return a.href.split('?')[0];
  }

  async function getImage(key) {
    if (!key) return null;
    const out = await store.get([key]);
    return out[key] || null;   // { dataUrl, name }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.cfg) {
      CFG = Object.assign({}, DEFAULT_CFG, changes.cfg.newValue || {});
      if (!Array.isArray(CFG.rules) || !CFG.rules.length) CFG.rules = DEFAULT_CFG.rules;
      renderPanel();
    }
    if (changes.done) doneIds = changes.done.newValue || {};
  });

  /* ---------------------------------------------------------------- bridge */

  const REQ = 'mrmoo:req';
  const RES = 'mrmoo:res';
  const TARGET_ATTR = 'data-mrmoo-target';
  const pending = new Map();
  let reqSeq = 0;

  document.addEventListener(RES, (e) => {
    let p;
    try { p = JSON.parse(e.detail); } catch (_) { return; }
    const slot = pending.get(p.id);
    if (!slot) return;
    pending.delete(p.id);
    clearTimeout(slot.t);
    if (p.ok) slot.resolve(p.data);
    else slot.reject(new Error(String(p.data)));
  });

  function callMain(el, action, payload) {
    return new Promise((resolve, reject) => {
      const n = ++reqSeq;
      const id = 'q' + n;
      const key = 'k' + n;
      el.setAttribute(TARGET_ATTR, key);
      const cleanup = () => el.removeAttribute(TARGET_ATTR);
      const t = setTimeout(() => {
        pending.delete(id);
        cleanup();
        reject(new Error('timeout: ' + action));
      }, 8000);
      pending.set(id, {
        t,
        resolve: (v) => { cleanup(); resolve(v); },
        reject: (err) => { cleanup(); reject(err); },
      });
      const detail = Object.assign({ id, key, action }, payload || {});
      document.dispatchEvent(new CustomEvent(REQ, { detail: JSON.stringify(detail) }));
    });
  }

  /* ---------------------------------------------------------------- utils  */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

  function normalize(s) {
    return (s || '').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').toLowerCase().trim();
  }

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
  }

  async function waitFor(fn, timeout, step) {
    const end = Date.now() + (timeout || 6000);
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step || 200);
    }
    return null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* ------------------------------------------------------------- FB lookup */

  const COMMENT_ARTICLE_RE = /^(ความคิดเห็นโดย|comment by|ตอบกลับ|reply by)/i;

  /* Facebook เปลี่ยนโครงสร้างบ่อย จึงลองหลายทางแทนที่จะผูกกับ selector เดียว */
  const POST_SEL = [
    'div[role="article"]',
    'div[aria-posinset]',
    'div[data-pagelet^="FeedUnit"]',
    'div[data-pagelet^="GroupFeed"]',
  ].join(',');

  /*
   * ตรวจจากหน้าจริงแล้วพบว่าในฟีดกลุ่มมี div[role="article"] ที่เป็น "กล่องเปล่า"
   * ปะปนอยู่ด้วย (ขนาด 620x286 แต่ textContent ยาว 0) ส่วนโพสต์จริงอยู่ใน
   * div[aria-posinset] ถ้าไม่กรองออก กล่องเปล่าพวกนี้จะกลายเป็น
   * "อ่านข้อความโพสต์ไม่ได้" เต็มไปหมด และยังมีโพสต์เดียวกันซ้ำแบบซ่อน (0x0) อีก
   */
  function getPosts() {
    const all = Array.prototype.slice.call(document.querySelectorAll(POST_SEL));
    const kept = all.filter((el) => {
      const label = (el.getAttribute('aria-label') || '').trim();
      if (COMMENT_ARTICLE_RE.test(label)) return false;                 // ตัดคอมเมนต์ออก
      if (el.parentElement && el.parentElement.closest(POST_SEL)) return false;
      if (!(el.textContent || '').trim()) return false;                 // กล่องเปล่า
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;                // ตัวซ้ำที่ซ่อนอยู่
      return true;
    });

    const seen = new Set();
    return kept.filter((el) => {
      if (seen.has(el)) return false;                                   // selector ซ้อนกัน
      seen.add(el);
      return true;
    });
  }

  const MESSAGE_SEL = [
    '[data-ad-rendering-role="story_message"]',
    '[data-ad-comet-preview="message"]',
    '[data-ad-preview="message"]',
    '[data-testid="post_message"]',
  ].join(',');

  const messageNode = (post) => post.querySelector(MESSAGE_SEL);

  /* ส่วนที่ไม่ใช่เนื้อโพสต์ ตัดออกก่อนอ่านชั้นสุดท้าย */
  const CHROME_RE = /^(ถูกใจ|ความคิดเห็น|แชร์|ตอบกลับ|ดูเพิ่มเติม|เพิ่มเติม|แปลจาก|ดูคำแปล|Like|Comment|Share|Reply|See more|\d+\s*(ชม|นาที|วัน|w|d|h|m))\.?$/i;

  /*
   * ตัวห่อเนื้อโพสต์ที่ Facebook ใช้อยู่ตอนนี้ ไม่มี dir="auto" และไม่มี data-ad-*
   * มีแต่คลาสย่อ เช่น <div class="xdj266r x14z9mp ..."> และมี <br class="html-br">
   * คั่นบรรทัดที่ผู้ใช้พิมพ์ — ทั้งสองอย่างนี้อาจเปลี่ยนได้ จึงเป็นแค่ทางลัด
   * ไม่ใช่ทางหลัก (ทางหลักคือชั้น 3 ที่ไม่พึ่งชื่อคลาสเลย)
   */
  const MSG_HINT_SEL = 'div.xdj266r, div.x1iorvi4';

  function ownText(el, post) {
    if (el.closest(POST_SEL) !== post) return '';            // อยู่ในคอมเมนต์ซ้อน
    if (el.closest('[role="button"], h1, h2, h3, h4')) return '';   // ชื่อคน/ปุ่ม
    const t = (el.innerText || '').trim();
    return t && !CHROME_RE.test(t) ? t : '';
  }

  const pushUnique = (arr, t) => { if (t && arr.indexOf(t) === -1) arr.push(t); };

  /*
   * หา "ตัวห่อข้อความที่กระชับที่สุด" — element ที่มีข้อความ แต่ไม่มีลูกคนไหน
   * ถือข้อความเกือบทั้งหมดของมัน แปลว่านี่คือกล่องเนื้อความจริง ไม่ใช่การ์ดทั้งใบ
   * วิธีนี้ไม่พึ่ง attribute หรือชื่อคลาสใด ๆ จึงทนต่อการที่ Facebook เปลี่ยนโครงสร้าง
   */
  function tightBlocks(post) {
    const out = [];
    const els = post.querySelectorAll('div, span, p');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const t = ownText(el, post);
      if (t.length < 5) continue;
      let childHoldsAll = false;
      for (let c = 0; c < el.children.length; c++) {
        if ((el.children[c].innerText || '').trim().length >= t.length * 0.9) {
          childHoldsAll = true;
          break;
        }
      }
      if (!childHoldsAll) pushUnique(out, t);
    }
    return out;
  }

  /*
   * ลองอ่านเนื้อโพสต์ 4 ชั้น จากแม่นสุดไปหยาบสุด แล้วบอกด้วยว่าชั้นไหนได้ผล
   * (ค่า how ใช้ตอนดีบั๊ก เพื่อรู้ว่า Facebook ยังใช้โครงสร้างเดิมอยู่ไหม)
   */
  function extractText(post) {
    // ชั้น 1 — attribute ทางการของ Facebook
    const node = messageNode(post);
    if (node && (node.innerText || '').trim().length >= 5) {
      return { text: node.innerText.trim(), how: 'story_message' };
    }

    // ชั้น 2 — ทางลัดจากคลาส/แท็กที่ Facebook ใช้อยู่ตอนนี้
    const hinted = [];
    post.querySelectorAll(MSG_HINT_SEL).forEach((el) => pushUnique(hinted, ownText(el, post)));
    post.querySelectorAll('br.html-br').forEach((br) => {
      if (br.parentElement) pushUnique(hinted, ownText(br.parentElement, post));
    });
    if (hinted.join('\n').trim().length >= 5) {
      return { text: hinted.join('\n').trim().slice(0, 1500), how: 'class-hint' };
    }

    // ชั้น 3 — กล่องข้อความที่กระชับที่สุด (ไม่พึ่งชื่อคลาส)
    const tight = tightBlocks(post);
    if (tight.join('\n').trim().length >= 5) {
      return { text: tight.join('\n').trim().slice(0, 1500), how: 'tight-block' };
    }

    // ชั้น 4 — ข้อความทั้งโพสต์ ตัดบรรทัดที่เป็นปุ่ม/เวลาออก
    const lines = (post.innerText || '')
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x && !CHROME_RE.test(x));
    const raw = lines.join('\n').trim();
    if (raw.length >= 5) return { text: raw.slice(0, 1500), how: 'innerText' };

    return { text: '', how: 'none' };
  }

  const getPostText = (post) => extractText(post).text;

  /*
   * คืนกุญแจได้มากกว่า 1 อันต่อโพสต์ แล้วถือว่า "เคยจัดการแล้ว" ถ้าตรงอันใดอันหนึ่ง
   * เพราะบางเลย์เอาต์อ่านลิงก์ถาวรไม่ได้ ถ้าใช้กุญแจเดียวจะกลายเป็นคนละโพสต์
   * ในการสแกนรอบหน้า แล้วโดนคอมเมนต์ซ้ำ
   */
  function getPostKeys(post) {
    const keys = [];
    const a = post.querySelector(
      'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], ' +
      'a[href*="multi_permalinks="], a[href*="/videos/"]'
    );
    if (a && a.href) {
      const m = a.href.match(/(?:\/posts\/|\/permalink\/|story_fbid=|multi_permalinks=|\/videos\/)([\w.]+)/);
      if (m) keys.push('p' + m[1]);
    }
    const authorEl = post.querySelector('h3, h4, strong');
    const author = authorEl ? authorEl.innerText.trim() : '';
    const body = normalize(getPostText(post)).slice(0, 160);
    if (body) keys.push('h' + hash(author + '|' + body));    // กุญแจสำรองจากเนื้อหา
    return keys;
  }


  function getAuthor(post) {
    const a = post.querySelector('h3 a, h4 a, h2 a, strong a');
    if (a && a.innerText) return a.innerText.trim();
    const h = post.querySelector('h3, h4');
    return h ? h.innerText.trim() : '';
  }

  const THAI_MONTHS =
    /(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)/;

  /* แปลงข้อความเวลาของ Facebook เป็นจำนวนชั่วโมง (null = อ่านไม่ออก) */
  function parseAge(txt) {
    if (!txt) return null;
    if (/(เมื่อสักครู่|just now|เพิ่งโพสต์)/i.test(txt)) return 0;
    if (/(เมื่อวาน|yesterday)/i.test(txt)) return 24;
    // ขึ้นเป็นวันที่เต็ม แปลว่าเก่ากว่าที่เราสนใจมากแล้ว
    if (THAI_MONTHS.test(txt)) return 24 * 30;

    const m = txt.match(/(\d+)\s*(นาที|ชั่วโมง|ชม\.?|วัน|สัปดาห์|เดือน|ปี|min|hour|hr|day|week|month|year|[hdwmy])/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    if (/นาที|min|^m$/.test(u)) return n / 60;
    if (/ชั่วโมง|ชม|hour|hr|^h$/.test(u)) return n;
    if (/วัน|day|^d$/.test(u)) return n * 24;
    if (/สัปดาห์|week|^w$/.test(u)) return n * 24 * 7;
    if (/เดือน|month/.test(u)) return n * 24 * 30;
    if (/ปี|year|^y$/.test(u)) return n * 24 * 365;
    return null;
  }

  /*
   * อายุโพสต์ — ลองอ่านจากหลายที่ เพราะ Facebook วางป้ายเวลาไว้ไม่เหมือนกัน
   * ในแต่ละเลย์เอาต์ ถ้าอ่านไม่ออกเลยจะคืน null แล้วระบบจะถือว่า "ไม่ทราบอายุ"
   */
  /*
   * Facebook กันการอ่านป้ายเวลา ด้วยการซอยข้อความเป็นตัวอักษรทีละตัว ใส่ตัวอักษร
   * หลอกปนเข้าไป แล้วสลับลำดับการแสดงผลด้วย CSS order — innerText จึงได้ค่าขยะ
   * อย่าง "serdSonoptmhh2" ทั้งที่บนจอเขียนว่า "2m"
   *
   * ทางแก้: ไล่เก็บตัวอักษรทุกตัวพร้อมตำแหน่งจริงบนจอ แล้วเรียงตามบรรทัดและ
   * ตำแหน่งซ้าย-ขวา จะได้ข้อความตามที่ตาเห็น (ยืนยันกับหน้าจริงแล้วว่าใช้ได้)
   */
  const INVISIBLE = /[​-‍﻿͏­]/g;

  function visualText(el) {
    const parts = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const ch = (n.nodeValue || '').replace(INVISIBLE, '');
      if (!ch.trim()) continue;
      const p = n.parentElement;
      if (!p) continue;
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = p.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      parts.push({ ch, x: r.left, y: Math.round(r.top) });
      if (parts.length > 120) break;
    }
    parts.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return parts.map((p) => p.ch).join('');
  }

  const ageCache = new WeakMap();          // อ่านทีเดียวพอ วิธีนี้ค่อนข้างหนัก

  function getAgeHours(post) {
    if (ageCache.has(post)) return ageCache.get(post);

    const links = Array.prototype.slice.call(post.querySelectorAll('a, abbr')).filter((a) => {
      const h = a.getAttribute('href') || '';
      return a.tagName === 'ABBR' || h.indexOf('?__cft__') === 0 ||
             /\/posts\/|permalink|story_fbid|\/videos\//.test(h);
    });

    let out = null;
    for (let i = 0; i < links.length && i < 4; i++) {
      const el = links[i];
      out = parseAge((el.getAttribute('aria-label') || '').trim());
      if (out === null) out = parseAge((el.innerText || '').trim());
      if (out === null) out = parseAge(visualText(el));   // ท่าไม้ตายสำหรับป้ายที่ถูกสลับ
      if (out !== null) break;
    }
    ageCache.set(post, out);
    return out;
  }

  function alreadyCommentedByMe(post) {
    return !!post.querySelector(
      'div[role="article"][aria-label*="โดยคุณ"], div[role="article"][aria-label*="by You"]'
    );
  }

  async function expandSeeMore(post) {
    const node = messageNode(post) || post;
    const btns = Array.prototype.slice.call(node.querySelectorAll('div[role="button"], span[role="button"]'));
    const more = btns.find((b) => /^(ดูเพิ่มเติม|เพิ่มเติม|see more)$/i.test((b.innerText || '').trim()));
    if (more && isVisible(more)) {
      more.click();
      await sleep(350);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------ การจับคู่ */

  /* คำบอกใบ้ว่าโพสต์ "น่าจะเกี่ยวกับตั๋วหนัง" ใช้คัดกรองก่อนส่งให้ AI ในโหมด assist */
  /* ป[๊็๋]?อ[บป] ครอบคลุมทุกแบบที่คนสะกด "ป๊อบ/ป๊อป/ป็อบ/ปอบ" */
  const TICKET_HINT = new RegExp([
    'ตั๋ว', 'บัตร', 'ที่นั่ง', 'รอบฉาย', 'รอบหนัง', 'โรงหนัง', 'หนังรอบ',
    'ป[๊็๋]?อ[บป]',          // ป๊อบ / ป็อป / ปอบ ...
    'popcorn', 'คอมโบ', 'combo',
    '\\bsf\\b', '\\bsfx\\b', '\\bsfw\\b', '\\bmajor\\b', 'เมเจอร์', 'เอสเอฟ',
    '\\bimax\\b', '\\b4dx\\b', 'screenx', 'honeymoon',
    'พารากอน', 'ไอคอน', 'ควอเทียร์', 'เซ็นทรัล', 'house', 'lido',
    'เครดิตหนัง', 'โค้ดหนัง',
  ].join('|'), 'i');

  /*
   * คืนค่าเป็นก้อนเดียวที่บอกได้ว่า "ตัดสินใจอย่างไรและเพราะอะไร"
   *   match     — คีย์เวิร์ดตรง และไม่ติดคำกัน
   *   ambiguous — คีย์เวิร์ดตรง แต่มีคำฝั่งคนขายปนอยู่ด้วย (เช่น "หาตั๋ว ใครขายต่อบ้าง")
   *   blocked   — ไม่มีคีย์เวิร์ดคนหา มีแต่คำฝั่งคนขาย
   *   hint      — ไม่มีคีย์เวิร์ดตรงเลย แต่พูดถึงตั๋ว/โรงหนัง
   *   null      — ไม่เกี่ยวข้อง
   */
  function matchRule(text) {
    const t = normalize(text);
    if (!t) return null;

    const blocked = (CFG.globalExclude || [])
      .filter(Boolean)
      .find((x) => t.indexOf(normalize(x)) !== -1);

    for (const rule of CFG.rules) {
      if (!rule.enabled) continue;
      const hit = (rule.keywords || []).filter(Boolean)
        .find((k) => t.indexOf(normalize(k)) !== -1);
      if (!hit) continue;

      const ruleBad = (rule.exclude || []).filter(Boolean)
        .find((x) => t.indexOf(normalize(x)) !== -1);
      if (ruleBad) return { kind: 'blocked', blocked: ruleBad, rule };

      if (blocked) return { kind: 'ambiguous', rule, hit, blocked };
      return { kind: 'match', rule, hit };
    }

    if (blocked) return { kind: 'blocked', blocked };
    if (TICKET_HINT.test(t)) return { kind: 'hint' };
    return null;
  }

  /* แปลผลการจับคู่เป็นข้อความสั้น ๆ ที่คนอ่านรู้เรื่อง */
  function verdictOf(m) {
    if (!m) return 'ไม่ตรงคำ';
    if (m.kind === 'match') return 'ตรง "' + m.hit + '"';
    if (m.kind === 'ambiguous') return 'กำกวม — ตรง "' + m.hit + '" แต่มี "' + m.blocked + '"';
    if (m.kind === 'blocked') return 'ติดคำฝั่งคนขาย "' + m.blocked + '"';
    if (m.kind === 'hint') return 'พูดถึงตั๋ว/โรงหนัง แต่ไม่ตรงคีย์เวิร์ด';
    return String(m.kind);
  }

  /*
   * ดัมป์ทุกโพสต์ที่มองเห็นตอนนี้พร้อมคำตัดสิน — ไม่ยุ่งกับการสแกน
   * ใช้ตอบคำถาม "มันเห็นอะไรอยู่บ้าง ทำไมไม่เจอสักอัน"
   */
  /* นับว่า selector แต่ละตัวเจอกี่ชิ้น — บอกได้ว่า Facebook เปลี่ยนโครงสร้างไปแบบไหน */
  function probeDom() {
    const sels = {
      'div[role="article"]': 'div[role="article"]',
      'div[aria-posinset]': 'div[aria-posinset]',
      'data-pagelet FeedUnit': 'div[data-pagelet^="FeedUnit"]',
      'data-pagelet GroupFeed': 'div[data-pagelet^="GroupFeed"]',
      'story_message': '[data-ad-rendering-role="story_message"]',
      'comet-preview message': '[data-ad-comet-preview="message"]',
      'div[dir="auto"]': 'div[dir="auto"]',
      'role=textbox': 'div[role="textbox"]',
    };
    const out = {};
    for (const name of Object.keys(sels)) {
      try { out[name] = document.querySelectorAll(sels[name]).length; }
      catch (_) { out[name] = 'error'; }
    }
    return out;
  }

  function dumpVisible() {
    const probe = probeDom();
    const posts = getPosts();
    const rows = posts.map((p, i) => {
      const got = extractText(p);
      const text = got.text;
      const m = text && text.length >= 5 ? matchRule(text) : null;
      const keys = getPostKeys(p);
      const age = getAgeHours(p);
      return {
        ลำดับ: i + 1,
        ผู้โพสต์: getAuthor(p) || '-',
        ข้อความ: (text || '(อ่านไม่ได้)').slice(0, 120).replace(/\s+/g, ' ').trim(),
        วิธีอ่าน: got.how,
        ผล: text && text.length >= 5 ? verdictOf(m) : 'อ่านข้อความไม่ได้',
        เคยจัดการ: isDone(keys) ? 'ใช่' : '',
        อายุ: age === null ? '?' : Math.round(age) + ' ชม.',
      };
    });

    // ตารางเต็ม ๆ ดูได้ใน DevTools (F12) คัดลอกไปวางได้
    console.log('%c[MR.MOO] โพสต์ที่มองเห็นตอนนี้ ' + rows.length + ' รายการ',
                'color:#facc15;font-weight:bold');
    console.log('[MR.MOO] URL:', location.href);
    console.log('[MR.MOO] selector ที่เจอในหน้านี้:');
    console.table(probe);
    if (rows.length) console.table(rows);

    // สรุปผลสำรวจลง log ด้วย เผื่อไม่ได้เปิด Console
    const found = Object.keys(probe).filter((k) => probe[k] > 0)
      .map((k) => k + '=' + probe[k]);
    log('DOM: ' + (found.length ? found.join(', ') : 'ไม่เจอ selector ที่รู้จักเลย'),
        found.length ? 'dim' : 'err');

    // สรุปย่อลงกล่อง log บนแผงควบคุม
    log('— เห็น ' + rows.length + ' โพสต์ (ตารางเต็มอยู่ใน Console F12) —', 'hit');
    rows.forEach((r) => {
      const kind = /^ตรง /.test(r.ผล) ? 'ok' : (r.ผล === 'ไม่ตรงคำ' ? 'dim' : 'hit');
      log('#' + r.ลำดับ + ' ' + r.ผล + (r.เคยจัดการ ? ' [เคยจัดการ]' : '') +
          ' — ' + r.ข้อความ.slice(0, 60), kind);
    });
    if (!rows.length) {
      log('ไม่เห็นโพสต์เลย — เลื่อนหน้าลงให้โพสต์โหลดขึ้นมาก่อน', 'err');
    }
    return rows;
  }

  /* เลือกกฎที่จะใช้จากผลวิเคราะห์ของ AI — จับคู่ด้วยชื่อโรงหนังก่อน ไม่ตรงก็ใช้กฎแรก */
  function pickRule(ai) {
    const usable = CFG.rules.filter((r) => r.enabled && (r.image || (r.text || '').trim()));
    if (!usable.length) return null;
    const cinema = normalize((ai && ai.cinema) || '');
    if (cinema) {
      const byCinema = usable.find((r) =>
        normalize(r.name).indexOf(cinema) !== -1 ||
        (r.keywords || []).some((k) => normalize(k).indexOf(cinema) !== -1));
      if (byCinema) return byCinema;
    }
    return usable[0];
  }

  /* ---------------------------------------------------------------- ราคา */

  /*
   * คืน rule ตัวใหม่ที่มีข้อความราคาจาก MR.MOO API แล้ว — ถ้าถามราคาไม่ได้ด้วยเหตุใดก็ตาม
   * คืน rule เดิมกลับไป ห้ามทำให้การคอมเมนต์ล้มเหลวเพราะ API (SPEC-XT02 §1.3)
   *
   * ห้าม mutate rule เดิม มันคือ config ที่ใช้ซ้ำทุกโพสต์ในรอบเดียวกัน
   */
  async function ruleWithPrice(rule, ai) {
    if (!CFG.priceLookup || !CFG.priceApiUrl || !CFG.priceApiKey) return rule;

    const seats = parseInt(String((ai && ai.seats) || '').replace(/[^0-9]/g, ''), 10);
    const res = await chrome.runtime.sendMessage({
      type: 'price',
      cinema: (ai && ai.cinema) || '',
      movie: (ai && ai.movie) || '',
      seats: seats > 0 ? seats : 1,
    }).catch(() => null);

    if (!res || !res.ok) {
      log('ถามราคาไม่สำเร็จ — ใช้ข้อความเดิม (' + ((res && res.error) || 'ไม่ได้รับคำตอบ') + ')', 'dim');
      return rule;
    }

    const text = CFG.priceMode === 'replace' || !rule.text
      ? res.comment
      : rule.text + '\n\n' + res.comment;

    return Object.assign({}, rule, { text });
  }

  /* ------------------------------------------------------------------- AI */

  async function askAI(text) {
    if (state.aiCalls >= CFG.maxAiCalls) throw new Error('ครบเพดานการเรียก AI ต่อรอบแล้ว');
    state.aiCalls++;
    renderPanel();
    const res = await chrome.runtime.sendMessage({ type: 'ai-classify', text });
    if (!res) throw new Error('ไม่ได้รับคำตอบจาก service worker');
    if (!res.ok) throw new Error(res.error || 'ไม่ทราบสาเหตุ');
    return res.data;
  }

  /* คืน true = ให้คอมเมนต์ต่อ, false = ข้าม */
  async function aiApproves(text, why) {
    let ai;
    try {
      ai = await askAI(text);
    } catch (err) {
      log('AI วิเคราะห์ไม่สำเร็จ (' + err.message + ') — ใช้ผลจากคีย์เวิร์ดแทน', 'err');
      return { ok: why !== 'hint', ai: null };   // โหมด hint ไม่มีคีย์เวิร์ดรองรับ จึงไม่เดาต่อ
    }
    const conf = typeof ai.confidence === 'number' ? ai.confidence : 0;
    const tag = ai.cached ? ' [cache]' : '';
    if (!ai.is_seeker) {
      dbg('AI ว่าไม่ใช่คนหาตั๋ว: ' + (ai.reason || '-') + tag);
      return { ok: false, ai };
    }
    if (conf < CFG.aiMinConfidence) {
      dbg('AI มั่นใจ ' + conf.toFixed(2) + ' ต่ำกว่าเกณฑ์ ' + CFG.aiMinConfidence + tag);
      return { ok: false, ai };
    }
    log('AI ยืนยัน: คนหาตั๋ว (' + conf.toFixed(2) + ')' +
        (ai.cinema ? ' · ' + ai.cinema : '') + (ai.movie ? ' · ' + ai.movie : '') + tag, 'ok');
    return { ok: true, ai };
  }

  /* ------------------------------------------------------------- คอมเมนต์ */

  /*
   * ปุ่มในหน้าไทยเขียนว่า "ความคิดเห็น" เฉย ๆ ไม่ใช่ "แสดงความคิดเห็น"
   * จึงต้องจับที่คำว่า "ความคิดเห็น" เป็นหลัก (ครอบคลุมแบบยาวไปด้วยในตัว)
   */
  const COMMENT_BTN_RE = /(ความคิดเห็น|ร่วมแสดงความเห็น|comment)/i;
  const COMMENT_BOX_RE = /(เขียนความคิดเห็น|แสดงความคิดเห็น|write a comment|write an answer|comment as)/i;

  /*
   * ต้องคัดช่อง "ตอบกลับ" ที่อยู่ใต้คอมเมนต์ของคนอื่นออก ไม่งั้นอาจไปพิมพ์ผิดช่อง
   * แล้วอ่านข้อความจากอีกช่องหนึ่ง กลายเป็นว่าพิมพ์ไม่ติดทั้งที่จริงพิมพ์ลงไปแล้ว
   */
  function findCommentBox(scope) {
    if (!scope) return null;
    const boxes = Array.prototype.slice.call(
      scope.querySelectorAll('div[role="textbox"][contenteditable="true"]')
    ).filter((b) => {
      if (!isVisible(b)) return false;
      const art = b.closest('div[role="article"]');
      if (!art) return true;
      // ตัดช่อง "ตอบกลับ" ที่อยู่ใต้คอมเมนต์ของคนอื่นออก
      return !COMMENT_ARTICLE_RE.test((art.getAttribute('aria-label') || '').trim());
    });
    const labelled = boxes.find((b) => COMMENT_BOX_RE.test(
      (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('aria-placeholder') || '')
    ));
    return labelled || boxes[0] || null;
  }

  const openDialog = () =>
    Array.prototype.slice.call(document.querySelectorAll('div[role="dialog"]'))
      .find(isVisible) || null;

  /* คืน { box, scope } — scope อาจเป็นตัวโพสต์ในฟีด หรือหน้าต่างซ้อนที่ Facebook เปิดขึ้นมา */
  async function openCommentBox(post) {
    let box = findCommentBox(post);
    if (box && isVisible(box)) {
      // คลิกก่อนหนึ่งครั้ง ตัวแก้ไขของ Facebook ถึงจะสร้างตัวจริงขึ้นมารับข้อความ
      try { await callMain(box, 'click'); } catch (_) { box.click(); }
      await sleep(400);
      return { box: findCommentBox(post) || box, scope: post };
    }

    const btns = Array.prototype.slice.call(
      post.querySelectorAll('div[role="button"], span[role="button"], a[role="link"]')
    ).filter((b) => {
      if (!isVisible(b)) return false;
      const art = b.closest('div[role="article"]');
      return !art || art === post;             // ไม่เอาปุ่มที่อยู่ใต้คอมเมนต์คนอื่น
    });

    const btn = btns.find((b) => {
      const s = (b.getAttribute('aria-label') || b.innerText || '').trim();
      return s.length > 0 && s.length < 80 && COMMENT_BTN_RE.test(s);
    });

    if (!btn) {
      // บอกไปเลยว่าเจอปุ่มอะไรบ้าง จะได้ไม่ต้องเดาว่า Facebook เปลี่ยนคำว่าอะไร
      const labels = btns.slice(0, 15)
        .map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 24))
        .filter(Boolean);
      console.log('[MR.MOO] ปุ่มที่เจอในโพสต์นี้:', labels);
      throw new Error('หาปุ่มคอมเมนต์ไม่เจอ — ปุ่มที่มี: ' +
        (labels.slice(0, 6).join(' / ') || 'ไม่มีเลย'));
    }

    try { await callMain(btn, 'click'); } catch (_) { btn.click(); }

    const opened = await waitFor(() => {
      const inFeed = findCommentBox(post);
      if (inFeed) return { box: inFeed, scope: post };
      // Facebook มักเปิดโพสต์เป็นหน้าต่างซ้อน กล่องคอมเมนต์จะไปอยู่ในนั้นแทน
      const dlg = openDialog();
      const inDlg = dlg && findCommentBox(dlg);
      if (inDlg) return { box: inDlg, scope: dlg };
      return null;
    }, 9000);

    if (!opened) {
      throw new Error('กดปุ่ม "' +
        (btn.getAttribute('aria-label') || btn.innerText || '').trim().slice(0, 20) +
        '" แล้วแต่กล่องคอมเมนต์ไม่โผล่');
    }
    return opened;
  }

  /* รายชื่อรูปที่มีอยู่ก่อนแปะ ใช้เทียบหาว่ามีรูปใหม่โผล่มาไหม */
  function imageSnapshot(root) {
    const set = new Set();
    Array.prototype.slice.call(root.querySelectorAll('img'))
      .forEach((im) => set.add(im.src || ''));
    Array.prototype.slice.call(root.querySelectorAll('div[style*="background-image"]'))
      .forEach((d) => set.add(d.style.backgroundImage || ''));
    return set;
  }

  /*
   * รอให้รูปที่แปะไปขึ้นในกล่อง
   *
   * เดิมดูแค่ <img> ที่ src ขึ้นต้นด้วย blob:/data: ในขอบเขตแคบ ๆ รอบกล่องข้อความ
   * แต่ Facebook วางรูปตัวอย่างไว้นอกขอบเขตนั้น และบางทีก็ใช้ background-image
   * หรืออัปโหลดเสร็จแล้วเปลี่ยนเป็น URL ปกติ ทำให้ตรวจไม่เจอทั้งที่แนบติดแล้ว
   * ตอนนี้เทียบกับภาพก่อนแปะแทน อะไรที่โผล่มาใหม่ถือว่าคือรูปที่แนบ
   */
  async function waitAttachment(scope, box, before) {
    const root = composerRoot(scope, box);
    return await waitFor(() => {
      const rm = root.querySelector(
        'div[role="button"][aria-label*="ลบ"], div[role="button"][aria-label*="นำออก"], ' +
        'div[role="button"][aria-label*="Remove"]'
      );
      if (rm && isVisible(rm)) return rm;

      const fresh = Array.prototype.slice.call(root.querySelectorAll('img')).find((im) => {
        const src = im.src || '';
        if (!src || before.has(src)) return false;
        return im.getBoundingClientRect().width > 20;
      });
      if (fresh) return fresh;

      return Array.prototype.slice.call(root.querySelectorAll('div[style*="background-image"]'))
        .find((d) => !before.has(d.style.backgroundImage || '') &&
                     d.getBoundingClientRect().width > 20) || null;
    }, 20000, 400);
  }

  /*
   * ห้ามใส่ "ตอบกลับ" หรือ "แสดงความคิดเห็น" ในนี้
   * ทั้งสองคำนี้เป็นปุ่มของคอมเมนต์คนอื่นและปุ่มเปิด/ปิดคอมเมนต์ของโพสต์
   * เคยใส่แล้วทำให้ไปกดผิดปุ่ม คอมเมนต์เลยไม่ถูกส่ง
   */
  const SEND_BTN_RE = /^(ส่ง|ส่งความคิดเห็น|comment|post|send)$/i;

  /*
   * หาตัวห่อของกล่องคอมเมนต์ที่มีปุ่มส่งอยู่ด้วย
   * เดิมใช้ box.closest('form') อย่างเดียว แต่ Facebook ไม่ได้ใช้ <form> เสมอไป
   * พอหาไม่เจอเลยข้ามไปกด Enter ซึ่งบางเลย์เอาต์ไม่ทำงาน คอมเมนต์เลยค้างไม่ส่ง
   */
  function composerRoot(scope, box) {
    const form = box.closest('form');
    if (form) return form;

    let n = box.parentElement;
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      const btns = Array.prototype.slice.call(n.querySelectorAll('div[role="button"], button'));
      const hit = btns.some((b) => SEND_BTN_RE.test((b.getAttribute('aria-label') || '').trim()));
      if (hit) return n;
    }
    return scope;
  }

  function findSendButton(root) {
    return Array.prototype.slice.call(root.querySelectorAll('div[role="button"], button'))
      .filter(isVisible)
      .find((b) => {
        if (b.getAttribute('aria-disabled') === 'true') return false;
        const s = (b.getAttribute('aria-label') || '').trim();
        return SEND_BTN_RE.test(s);
      }) || null;
  }

  async function submitComment(scope, box) {
    const root = composerRoot(scope, box);
    const btn = findSendButton(root);

    if (btn) {
      try { await callMain(btn, 'click'); } catch (_) { btn.click(); }
      return 'ปุ่มส่ง';
    }

    // ไม่เจอปุ่ม — บอกไปเลยว่ามีปุ่มอะไรบ้าง จะได้แก้ให้ตรงคราวหน้า
    const labels = Array.prototype.slice.call(root.querySelectorAll('div[role="button"], button'))
      .filter(isVisible)
      .map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 20))
      .filter(Boolean);
    console.log('[MR.MOO] ปุ่มในกล่องคอมเมนต์:', labels);

    await callMain(box, 'pressEnter');
    return 'Enter (ปุ่มที่มี: ' + (labels.slice(0, 5).join(' / ') || 'ไม่มี') + ')';
  }

  /*
   * ส่งคอมเมนต์เดียวที่มีทั้งข้อความและรูป — พิมพ์ข้อความก่อน แล้วค่อยแปะรูป
   * ต่อท้ายในกล่องเดิม แล้วกดส่งครั้งเดียว ไม่ใช่แยกเป็นสองคอมเมนต์
   */
  async function doComment(post, rule) {
    const img = await getImage(rule.image);
    const text = (rule.text || '').trim();
    if (!img && !text) throw new Error('กฎนี้ยังไม่มีทั้งรูปและข้อความ');

    step('เริ่มคอมเมนต์ — ข้อความ ' + text.length + ' ตัวอักษร, รูป: ' + (img ? 'มี' : 'ไม่มี'));
    post.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(700);

    const opened = await openCommentBox(post);
    if (!opened || !opened.box) throw new Error('เปิดกล่องคอมเมนต์ไม่ได้');
    const scope = opened.scope || post;          // อาจเป็นหน้าต่างซ้อน ไม่ใช่โพสต์ในฟีด
    step('เปิดกล่องคอมเมนต์แล้ว (' + (scope === post ? 'ในฟีด' : 'หน้าต่างซ้อน') + ')');
    await sleep(400);

    /*
     * Facebook สร้างกล่องคอมเมนต์ขึ้นใหม่ระหว่างทางได้ ถ้าถือ element เดิมไว้
     * เราจะไปอ่านข้อความจากโหนดที่หลุดออกจากหน้าไปแล้ว ซึ่งว่างเปล่าเสมอ
     * ทั้งที่จริงพิมพ์ลงไปติดแล้ว จึงต้องหากล่องสด ๆ ทุกครั้งก่อนใช้
     */
    const live = () => findCommentBox(scope) || opened.box;

    /*
     * อ่านจากทุกกล่องในขอบเขต ไม่ยึดกล่องเดียว เพราะ Facebook อาจสลับโหนด
     * ระหว่างทาง แล้วเราไปอ่านกล่องที่ไม่ได้พิมพ์ลงไป เข้าใจผิดว่ายังว่างอยู่
     */
    const typedNow = () => Array.prototype.slice
      .call(scope.querySelectorAll('div[role="textbox"][contenteditable="true"]'))
      .map((b) => (b.innerText || '').trim())
      .join('')
      .trim();

    const parts = [];
    try {
      if (text) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const target = live();
          if (attempt > 1) {
            // ล้างก่อนเสมอ ไม่งั้นถ้ารอบแรกติดจริงแต่เราอ่านไม่เจอ จะได้ข้อความเบิ้ล
            await callMain(target, 'clearText').catch(() => {});
            await sleep(300);
            try { await callMain(target, 'click'); } catch (_) { target.click(); }
            await sleep(400);
          }
          // รอบสุดท้ายเปลี่ยนไปพิมพ์ทีละบรรทัด เผื่อการวางใช้ไม่ได้กับกล่องนี้
          await callMain(target, attempt === 3 ? 'typeLines' : 'insertText', { text });
          await sleep(600 + attempt * 400);
          if (typedNow()) break;
        }
        if (!typedNow()) throw new Error('พิมพ์ข้อความลงกล่องคอมเมนต์ไม่สำเร็จ (ลอง 3 ครั้งแล้ว)');
        step('พิมพ์ข้อความลงกล่องแล้ว');
        parts.push('ข้อความ');
      }

      if (img) {
        const before = imageSnapshot(composerRoot(scope, live()));
        await callMain(live(), 'pasteImage', {
          dataUrl: img.dataUrl,
          filename: img.name || 'ticket.png',
        });
        const ok = await waitAttachment(scope, live(), before);
        /*
         * ตรวจไม่เจอไม่ได้แปลว่าแนบไม่ติด — Facebook แสดงรูปตัวอย่างได้หลายแบบ
         * เคยตัดสินว่าล้มเหลวแล้วยกเลิกทั้งที่รูปแนบติดแล้ว จึงเปลี่ยนเป็นแค่เตือน
         * แล้วส่งต่อไป การตรวจตอนส่งจะจับได้เองถ้าล้มเหลวจริง
         */
        if (ok) {
          step('แนบรูปเรียบร้อย');
          parts.push('รูป');
        } else {
          step('ตรวจไม่พบรูปตัวอย่าง แต่จะลองส่งต่อไป');
          log('ตรวจไม่เจอรูปที่แนบ — ลองส่งต่อไปเลย', 'dim');
          parts.push('รูป (ไม่ยืนยัน)');
        }
        await sleep(rand(900, 1800));
      }
    } catch (err) {
      await callMain(live(), 'clearText').catch(() => {});   // อย่าทิ้งข้อความค้างในกล่อง
      throw err;
    }

    /*
     * ส่งแล้วต้องเช็คว่าออกจริง กล่องที่ยังมีข้อความค้าง = ยังไม่ได้ส่ง
     * ลอง Enter ก่อนเสมอ เพราะเป็นวิธีที่ใช้ได้มาตลอด แล้วค่อยลองปุ่มถ้าไม่ผ่าน
     */
    const stillThere = () => {
      const left = typedNow();
      return !!(text && left && left.indexOf(text.slice(0, 30)) !== -1);
    };

    step('กำลังกด Enter เพื่อส่ง');
    await callMain(live(), 'pressEnter');
    let how = 'Enter';
    await sleep(1800);

    if (stillThere()) {
      step('Enter ไม่ผ่าน — หาปุ่มส่ง');
      const root = composerRoot(scope, live());
      const btn = findSendButton(root);
      if (btn) {
        step('เจอปุ่มส่ง "' + (btn.getAttribute('aria-label') || '').trim() + '" กำลังกด');
        try { await callMain(btn, 'click'); } catch (_) { btn.click(); }
        how += ' + ปุ่มส่ง';
        await sleep(1800);
      } else {
        const labels = Array.prototype.slice.call(root.querySelectorAll('div[role="button"], button'))
          .filter(isVisible)
          .map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 20))
          .filter(Boolean);
        console.log('[MR.MOO] ปุ่มในกล่องคอมเมนต์:', labels);
        how += ' (ไม่เจอปุ่มส่ง — ปุ่มที่มี: ' + (labels.slice(0, 6).join(' / ') || 'ไม่มี') + ')';
      }
    }

    if (stillThere()) {
      step('ยังค้างอยู่ — ล้างกล่องแล้วยอมแพ้');
      await callMain(live(), 'clearText').catch(() => {});
      throw new Error('กรอกครบแล้วแต่ส่งไม่ออก (' + how + ')');
    }
    step('ส่งสำเร็จด้วย ' + how);
    return parts.join(' + ') + ' · ' + how;
  }

  /* ------------------------------------------------------- โพสต์อัตโนมัติ */

  const COMPOSER_TRIGGER_RE =
    /(เขียนอะไรบางอย่าง|คุณกำลังคิดอะไรอยู่|เขียนโพสต์|สร้างโพสต์|write something|what'?s on your mind|create post)/i;
  const COMPOSER_BOX_RE =
    /(เขียนอะไรบางอย่าง|คุณกำลังคิดอะไรอยู่|สร้างโพสต์|write something|what'?s on your mind|create a public post)/i;
  const POST_BTN_RE = /^(โพสต์|post)$/i;

  const composerDialog = () =>
    Array.prototype.slice.call(document.querySelectorAll('div[role="dialog"]'))
      .find((d) => isVisible(d) && d.querySelector('div[role="textbox"][contenteditable="true"]')) || null;

  function findComposerBox() {
    const dlg = composerDialog();
    if (!dlg) return null;
    const boxes = Array.prototype.slice.call(
      dlg.querySelectorAll('div[role="textbox"][contenteditable="true"]')
    );
    const labelled = boxes.find((b) => COMPOSER_BOX_RE.test(
      (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('aria-placeholder') || '')
    ));
    return labelled || boxes.find(isVisible) || null;
  }

  async function openComposer() {
    let box = findComposerBox();
    if (box) return box;

    const cands = Array.prototype.slice.call(
      document.querySelectorAll('div[role="button"], div[role="textbox"], span[role="button"]')
    );
    const trigger = cands.find((b) => {
      if (b.closest('div[role="dialog"]')) return false;
      const s = (b.getAttribute('aria-label') || b.innerText || '').trim();
      return s.length > 0 && s.length < 60 && COMPOSER_TRIGGER_RE.test(s) && isVisible(b);
    });
    if (!trigger) throw new Error('หาช่องสร้างโพสต์ในหน้านี้ไม่เจอ');

    try { await callMain(trigger, 'click'); } catch (_) { trigger.click(); }
    box = await waitFor(findComposerBox, 9000);
    if (!box) throw new Error('เปิดหน้าต่างสร้างโพสต์ไม่ได้');
    await sleep(600);
    return box;
  }

  async function closeComposer(box) {
    try { await callMain(box, 'pressEscape'); } catch (_) { /* ปิดไม่ได้ก็ปล่อย */ }
    await sleep(400);
    // Facebook มักถามยืนยันว่าจะทิ้งโพสต์ไหม — กด "ทิ้ง"
    const dlg = composerDialog();
    if (!dlg) return;
    const discard = Array.prototype.slice.call(dlg.querySelectorAll('div[role="button"], button'))
      .find((b) => /^(ทิ้ง|ละทิ้ง|discard|discard post)$/i.test((b.innerText || '').trim()));
    if (discard) { try { await callMain(discard, 'click'); } catch (_) { discard.click(); } }
  }

  async function waitPostAttachment(dlg, before) {
    return await waitFor(() => {
      const rm = dlg.querySelector(
        'div[role="button"][aria-label*="ลบ"], div[role="button"][aria-label*="นำออก"], ' +
        'div[role="button"][aria-label*="Remove"]'
      );
      if (rm && isVisible(rm)) return rm;
      const fresh = Array.prototype.slice.call(dlg.querySelectorAll('img')).find((im) => {
        const src = im.src || '';
        return src && !before.has(src) && im.getBoundingClientRect().width > 20;
      });
      if (fresh) return fresh;
      return Array.prototype.slice.call(dlg.querySelectorAll('div[style*="background-image"]'))
        .find((d) => !before.has(d.style.backgroundImage || '') &&
                     d.getBoundingClientRect().width > 20) || null;
    }, 25000, 500);
  }

  /* สร้างโพสต์ 1 ชิ้นจากเทมเพลต — ข้อความและรูปอยู่ในโพสต์เดียวกัน */
  async function doPost(tpl) {
    const img = await getImage(tpl.image);
    const text = (tpl.text || '').trim();
    if (!img && !text) throw new Error('เทมเพลตนี้ยังไม่มีทั้งรูปและข้อความ');

    const box = await openComposer();
    const dlg = composerDialog();
    if (!dlg) throw new Error('หน้าต่างสร้างโพสต์หายไป');

    const parts = [];
    try {
      if (text) {
        await callMain(box, 'insertText', { text });
        await sleep(800);
        if (!(box.innerText || '').trim()) {
          // ล้างก่อนลองใหม่ กันข้อความเบิ้ลถ้ารอบแรกติดจริงแต่อ่านไม่ทัน
          await callMain(box, 'clearText').catch(() => {});
          await sleep(400);
          await callMain(box, 'typeLines', { text });
          await sleep(800);
        }
        if (!(box.innerText || '').trim()) throw new Error('พิมพ์ข้อความลงช่องโพสต์ไม่สำเร็จ');
        parts.push('ข้อความ');
      }
      if (img) {
        const before = imageSnapshot(dlg);
        await callMain(box, 'pasteImage', { dataUrl: img.dataUrl, filename: img.name || 'post.png' });
        const ok = await waitPostAttachment(dlg, before);
        if (ok) {
          step('แนบรูปในโพสต์เรียบร้อย');
          parts.push('รูป');
        } else {
          step('ตรวจไม่พบรูปตัวอย่างในโพสต์ แต่จะลองส่งต่อไป');
          parts.push('รูป (ไม่ยืนยัน)');
        }
        await sleep(rand(1200, 2200));
      }

      const btn = Array.prototype.slice.call(dlg.querySelectorAll('div[role="button"], button'))
        .find((b) => {
          const s = (b.getAttribute('aria-label') || b.innerText || '').trim();
          return POST_BTN_RE.test(s) && isVisible(b) && b.getAttribute('aria-disabled') !== 'true';
        });
      if (!btn) {
        const labels = Array.prototype.slice.call(dlg.querySelectorAll('div[role="button"], button'))
          .filter(isVisible)
          .map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 20))
          .filter(Boolean);
        console.log('[MR.MOO] ปุ่มในหน้าต่างสร้างโพสต์:', labels);
        throw new Error('หาปุ่ม "โพสต์" ไม่เจอ — ปุ่มที่มี: ' +
          (labels.slice(0, 6).join(' / ') || 'ไม่มี'));
      }

      try { await callMain(btn, 'click'); } catch (_) { btn.click(); }
      const gone = await waitFor(() => (composerDialog() ? null : true), 20000, 500);
      if (!gone) throw new Error('กดโพสต์แล้วแต่หน้าต่างยังไม่ปิด');
      return parts.join(' + ');
    } catch (err) {
      await closeComposer(box);                  // อย่าทิ้งหน้าต่างค้างไว้
      throw err;
    }
  }

  /*
   * หาโพสต์ที่เพิ่งโพสต์ไปในฟีด เพื่อไปคอมเมนต์ QR ใต้โพสต์ตัวเอง
   * จับคู่ด้วยเนื้อความที่เพิ่งส่งไป เพราะเชื่อถือได้กว่าการเดาจากชื่อผู้โพสต์
   */
  async function findOwnPost(tplText) {
    const needle = normalize(tplText).slice(0, 60);
    if (needle.length < 10) return null;          // สั้นไปจะจับคู่ผิดโพสต์คนอื่น
    return await waitFor(() => {
      const posts = getPosts().slice(0, 6);       // โพสต์ใหม่จะอยู่บนสุดของฟีด
      for (const p of posts) {
        if (normalize(getPostText(p)).indexOf(needle) !== -1) return p;
      }
      return null;
    }, 30000, 1500);
  }

  /* คอมเมนต์ QR ไลน์ใต้โพสต์ของตัวเอง — ไม่กินโควตาคอมเมนต์ที่ใช้ทักคนอื่น */
  async function commentOwnQr(tpl) {
    if (!CFG.qrEnabled) return;
    const img = await getImage(CFG.qrImage);
    const qrText = (CFG.qrText || '').trim();
    if (!img && !qrText) { dbg('ข้ามการแนบ QR — ยังไม่ได้ตั้งรูปหรือข้อความ'); return; }

    const tplText = (tpl.text || '').trim();
    if (!tplText) {
      log('แนบ QR ไม่ได้ — เทมเพลตไม่มีข้อความ เลยหาโพสต์ของตัวเองในฟีดไม่เจอ', 'err');
      return;
    }

    setStatus('กำลังหาโพสต์ที่เพิ่งลง...');
    window.scrollTo({ top: 0, behavior: 'auto' });     // โพสต์ใหม่อยู่บนสุด
    await sleep(3000);

    const own = await findOwnPost(tplText);
    if (!own) { log('หาโพสต์ที่เพิ่งลงไม่เจอ — ข้ามการแนบ QR', 'err'); return; }

    highlight(own);
    try {
      setStatus('กำลังคอมเมนต์ QR ใต้โพสต์ตัวเอง...');
      const how = await doComment(own, { text: qrText, image: CFG.qrImage });
      await markDone(getPostKeys(own));            // กันตัวสแกนมาคอมเมนต์โพสต์ตัวเองซ้ำ
      log('แนบ QR ใต้โพสต์ตัวเองแล้ว (' + how + ')', 'ok');
      sendEvent({
        kind: 'comment',
        group: groupName(),
        url: postUrl(own),
        author: 'โพสต์ของตัวเอง',
        snippet: 'QR ไลน์: ' + qrText.slice(0, 80),
        what: how,
      });
    } catch (err) {
      log('แนบ QR ไม่สำเร็จ: ' + err.message, 'err');
      sendEvent({ kind: 'error', group: groupName(), message: 'แนบ QR: ' + err.message });
    } finally {
      unhighlight(own);
    }
  }

  const groupKey = () => {
    const m = location.pathname.match(/\/groups\/([^/]+)/);
    return m ? m[1] : location.pathname;
  };

  function nextTemplate() {
    const list = (CFG.posts || []).filter((p) => p.enabled && (p.image || (p.text || '').trim()));
    if (!list.length) return null;
    return list[state.postIndex++ % list.length];
  }

  /* เรียกตอนเริ่มทำงานในแต่ละกลุ่ม — ขอโควตารายวันก่อน ถ้าได้ค่อยโพสต์ */
  async function maybePost() {
    if (!CFG.autoPost || state.posting) return;
    const tpl = nextTemplate();
    if (!tpl) return;

    const res = await chrome.runtime.sendMessage({ type: 'post-quota', group: groupKey() })
      .catch(() => null);
    if (!res) return;
    if (!res.ok) {
      if (res.stop) dbg('ไม่โพสต์: ' + res.stop);
      else dbg('ไม่โพสต์: ' + (res.reason || 'ยังไม่ถึงเวลา'));
      return;
    }

    state.posting = true;
    try {
      if (CFG.postApprove) {
        const go = await askApproval(null, tpl, '', null,
          'จะโพสต์ลงกลุ่มนี้ (วันนี้ ' + res.count + '/' + res.perDay + ') — ยืนยันไหม?');
        if (go !== true) {
          log('ยกเลิกการโพสต์ — คืนโควตาไม่ได้ นับไปแล้ว ' + res.count + '/' + res.perDay, 'dim');
          return;
        }
      }
      setStatus('กำลังโพสต์...');
      const what = await doPost(tpl);
      log('โพสต์สำเร็จ (' + what + ') — วันนี้ ' + res.count + '/' + res.perDay, 'ok');
      sendEvent({
        kind: 'post',
        group: groupName(),
        url: location.href,
        snippet: (tpl.text || '').slice(0, 120).replace(/\s+/g, ' '),
        template: tpl.name || '',
        what,
        dayCount: res.count + '/' + res.perDay,
      });
      await sleep(rand(2000, 4000));
      await commentOwnQr(tpl);              // แนบ QR ไลน์ใต้โพสต์ที่เพิ่งลง
    } catch (err) {
      log('โพสต์ไม่สำเร็จ: ' + err.message, 'err');
      sendEvent({ kind: 'error', group: groupName(), message: 'โพสต์: ' + err.message });
    } finally {
      state.posting = false;
      renderPanel();
    }
  }

  /* --------------------------------------------------------------- โควตา */

  /*
   * ขอสิทธิ์คอมเมนต์จาก service worker ซึ่งถือโควตาไว้ที่เดียว
   * สำคัญมากตอนเปิดหลายกลุ่มพร้อมกัน ไม่งั้นแต่ละแท็บจะนับของตัวเอง
   * แล้วอัตราคอมเมนต์รวมจะเป็นจำนวนแท็บเท่า = เสี่ยงโดนจำกัดบัญชี
   */
  async function quota() {
    const res = await chrome.runtime.sendMessage({ type: 'quota' }).catch(() => null);
    if (!res) return quotaLocal();                  // ต่อ service worker ไม่ได้ ใช้ตัวนับในแท็บแทน
    if (res.ok) {
      state.sessionCount = res.session;
      return null;
    }
    if (res.stop) return res.stop;
    return 'wait:' + (res.waitSec || 30);
  }

  /* ตัวสำรองเมื่อคุยกับ service worker ไม่ได้ — นับเฉพาะแท็บนี้ */
  function quotaLocal() {
    const now = Date.now();
    state.hourStamps = state.hourStamps.filter((t) => now - t < 3600e3);
    if (state.sessionCount >= CFG.maxPerSession) return 'ครบโควตาต่อรอบแล้ว (' + CFG.maxPerSession + ')';
    if (state.hourStamps.length >= CFG.maxPerHour) return 'ครบโควตาต่อชั่วโมงแล้ว (' + CFG.maxPerHour + ')';
    if (state.lastCommentAt) {
      const waitMs = (CFG.minGapSec * 1000) - (now - state.lastCommentAt);
      if (waitMs > 0) return 'wait:' + Math.ceil(waitMs / 1000);
    }
    return null;
  }

  /* ------------------------------------------------------------- ลูปหลัก */

  async function processPost(post) {
    seenEls.add(post);
    state.scanned++;

    if (CFG.expandSeeMore) await expandSeeMore(post);

    const text = getPostText(post);
    const snippet = text.slice(0, 50).replace(/\n/g, ' ');
    if (!text || text.length < 5) {
      // โพสต์รูป/วิดีโอล้วนไม่มีข้อความอยู่แล้ว เป็นเรื่องปกติ ไม่ต้องรก log
      const media = post.querySelector('img[src^="https"], video');
      if (!media && CFG.traceLog) log('ข้าม: อ่านข้อความโพสต์ไม่ได้', 'dim');
      return;
    }

    // นับว่าเลื่อนลงไปพ้นช่วงเวลาที่สนใจแล้วหรือยัง เก่าติดกันหลายอัน = ของใหม่หมด
    if (CFG.maxAgeHours > 0) {
      const ageH = getAgeHours(post);
      if (ageH !== null && ageH > CFG.maxAgeHours) state.oldStreak++;
      else if (ageH !== null) state.oldStreak = 0;
    }

    const m = matchRule(text);
    if (CFG.traceLog) {                          // โหมดละเอียด: รายงานทุกโพสต์ที่ผ่านสายตา
      log('#' + state.scanned + ' ' + verdictOf(m) + ' — ' + snippet,
          m && m.kind === 'match' ? 'ok' : 'dim');
      console.log('[MR.MOO] #' + state.scanned, verdictOf(m), '|',
                  getAuthor(post) || '-', '|', text.slice(0, 200).replace(/\s+/g, ' '));
    }
    if (!m) return;                              // ไม่เกี่ยวกับตั๋วเลย

    const aiOn = CFG.aiMode !== 'off' && (CFG.apiKey || '').trim();
    let rule = m.rule || null;
    let aiData = null;

    if (m.kind === 'blocked') {
      state.skipped++;
      dbg('ข้าม "' + snippet + '" — ติดคำฝั่งคนขาย "' + m.blocked + '"');
      return;
    }

    if (m.kind === 'ambiguous') {
      if (!aiOn) {
        state.skipped++;
        log('ข้าม "' + snippet + '" — เจอ "' + m.hit + '" แต่มี "' + m.blocked +
            '" ปนอยู่ ตัดสินไม่ได้ (เปิดโหมด AI ช่วยได้)', 'dim');
        return;
      }
      const v = await aiApproves(text, 'ambiguous');
      aiData = v.ai;
      if (!v.ok) { state.skipped++; dbg('ข้าม "' + snippet + '" — AI ตัดสินว่าไม่ใช่'); return; }
    } else if (m.kind === 'hint') {
      if (CFG.aiMode !== 'assist' || !aiOn) {
        state.skipped++;
        dbg('ข้าม "' + snippet + '" — พูดถึงตั๋วแต่ไม่ตรงคีย์เวิร์ด (โหมด assist จะให้ AI ดูให้)');
        return;
      }
      const v = await aiApproves(text, 'hint');
      aiData = v.ai;
      if (!v.ok) { state.skipped++; return; }
      rule = pickRule(aiData);
      if (!rule) { state.skipped++; log('AI ว่าใช่ แต่ยังไม่มีกฎที่มีรูป/ข้อความ', 'err'); return; }
    } else if (aiOn) {                            // kind === 'match' + โหมด verify/assist
      const v = await aiApproves(text, 'match');
      aiData = v.ai;
      if (!v.ok) { state.skipped++; dbg('ข้าม "' + snippet + '" — AI ตรวจซ้ำแล้วว่าไม่ใช่'); return; }
    }

    if (!rule) { state.skipped++; return; }

    const keys = getPostKeys(post);
    if (isDone(keys)) {
      state.skipped++;
      dbg('ข้าม "' + snippet + '" — จัดการโพสต์นี้ไปแล้ว (ล้างได้ที่ปุ่ม "ล้างประวัติโพสต์")');
      return;
    }

    if (CFG.skipIfCommented && alreadyCommentedByMe(post)) {
      state.skipped++;
      await markDone(keys);
      log('ข้าม "' + snippet + '" — เหมือนเคยคอมเมนต์แล้ว', 'dim');
      return;
    }

    if (CFG.maxAgeHours > 0) {
      const age = getAgeHours(post);
      if (age !== null && age > CFG.maxAgeHours) {
        state.skipped++;
        await markDone(keys);
        dbg('ข้าม "' + snippet + '" — โพสต์เก่า ' + Math.round(age) + ' ชม.');
        return;
      }
    }

    state.oldStreak = 0;                 // เจอของใหม่ที่ใช้ได้ ยังไม่ต้องรีเฟรช

    const q = await quota();
    if (q && q.indexOf('wait:') !== 0) { stop(q); return; }
    if (q) {
      const secs = parseInt(q.split(':')[1], 10);
      step('เจอโพสต์แล้ว แต่ต้องรอเว้นระยะอีก ' + secs + ' วินาที');
      setStatus('เจอโพสต์แล้ว รอเว้นระยะอีก ' + secs + ' วินาที');
      await sleep(secs * 1000);
      if (!state.running) return;
    }

    state.matched++;
    highlight(post);
    log('เจอ: ' + (getAuthor(post) || 'ไม่ทราบชื่อ') + ' — ' +
        text.slice(0, 60).replace(/\n/g, ' '), 'hit');

    /* ถามราคาก่อนขึ้นกล่องยืนยัน กล่องจะได้โชว์ข้อความจริงที่กำลังจะส่ง */
    if (CFG.priceLookup) step('กำลังถามราคาจาก MR.MOO');
    const sendRule = await ruleWithPrice(rule, aiData);

    let go = true;
    if (!CFG.autoSend) {
      step('รอกดยืนยันในกล่อง (โหมดยืนยันก่อนส่ง)');
      go = await askApproval(post, sendRule, text, aiData);
      if (go === 'stop') {                       // กด "หยุด" ในกล่อง หรือสั่งหยุดจากที่อื่น
        unhighlight(post);
        if (state.running) stop('ผู้ใช้สั่งหยุด');
        return;
      }
      if (go === 'timeout') {                    // ไม่ได้ตอบ — อย่าเพิ่งตัดทิ้งถาวร
        state.skipped++;
        unhighlight(post);
        log('ไม่ได้กดยืนยันทัน — เก็บโพสต์นี้ไว้ให้เจอใหม่รอบหน้า', 'dim');
        return;
      }
    }
    if (!go) {
      state.skipped++;
      await markDone(keys);
      unhighlight(post);
      return;
    }

    try {
      step('ผ่านทุกด่านแล้ว เริ่มลงมือคอมเมนต์');
      setStatus('กำลังคอมเมนต์...');
      const how = await doComment(post, sendRule);
      state.lastCommentAt = Date.now();
      state.hourStamps.push(state.lastCommentAt);   // สำรองไว้เผื่อ service worker ล่ม
      await markDone(keys);
      state.failStreak = 0;
      log('คอมเมนต์สำเร็จ (' + how + ') — รวม ' + state.sessionCount + ' โพสต์', 'ok');
      sendEvent({
        kind: 'comment',
        group: groupName(),
        url: postUrl(post),
        author: getAuthor(post),
        snippet: text.slice(0, 120).replace(/\s+/g, ' '),
        rule: rule.name || '',
        what: how,
      });
      heartbeat(true);
    } catch (err) {
      /*
       * เดิมหยุดทันทีที่พลาดครั้งแรก ซึ่งเข้มเกินไป โพสต์บางอันมีปัญหาเฉพาะตัว
       * (ปิดคอมเมนต์ ลบไปแล้ว โหลดไม่ทัน) แล้วบอททั้งตัวตายทั้งที่ตัวอื่นยังไปต่อได้
       * จึงยอมให้พลาดได้หลายครั้งติดกันก่อน แล้วค่อยหยุด
       */
      state.failStreak++;
      log('คอมเมนต์ไม่สำเร็จ (' + state.failStreak + '/' + CFG.maxFailStreak + '): ' +
          err.message, 'err');
      sendEvent({ kind: 'error', group: groupName(), url: postUrl(post), message: err.message });
      await markDone(keys);            // โพสต์นี้มีปัญหา ข้ามไปเลย ไม่ต้องวนกลับมาลองใหม่
      if (state.failStreak >= CFG.maxFailStreak) {
        stop('คอมเมนต์ล้มเหลวติดกัน ' + state.failStreak + ' ครั้ง — ลองตรวจหน้าจอก่อน');
      }
    } finally {
      unhighlight(post);
      renderPanel();
    }
  }

  async function tick() {
    if (!state.running || state.busy) return;
    state.busy = true;
    try {
      const posts = getPosts().filter((p) => !seenEls.has(p));
      if (posts.length === 0) {
        state.idleScrolls++;
      } else {
        state.idleScrolls = 0;
        for (const p of posts) {
          if (!state.running) break;
          await processPost(p);
        }
      }
      if (!state.running) return;

      setStatus(document.hidden ? 'กำลังเลื่อนฟีด (ทำงานเบื้องหลัง)' : 'กำลังเลื่อนฟีด...');
      // แท็บที่ถูกซ่อนไม่เล่น animation การเลื่อนแบบ smooth จะไม่ขยับ ต้องใช้ auto
      window.scrollBy({
        top: CFG.scrollStep + Math.round(rand(-80, 80)),
        behavior: document.hidden ? 'auto' : 'smooth',
      });

      if (state.idleScrolls >= 12) {
        log('ไม่พบโพสต์ใหม่ติดกันหลายครั้ง — น่าจะสุดฟีดแล้ว', 'dim');
        state.idleScrolls = 0;
      }
      state.rounds++;
      heartbeat();
      renderPanel();
      await maybeRotate();
    } finally {
      state.busy = false;
    }
  }

  /*
   * ตัดสินว่าควรอยู่กลุ่มนี้ต่อไหม — เลิกเมื่ออย่างใดอย่างหนึ่งเกิดขึ้น:
   *   1. เลื่อนลงไปเจอโพสต์ที่เก่ากว่าเกณฑ์ติดกันหลายอัน (ของใหม่หมดแล้ว)
   *   2. ครบเวลาต่อกลุ่ม
   *   3. ไม่มีโพสต์ใหม่โหลดเพิ่มติดกันหลายครั้ง
   * แล้วแต่โหมด: แท็บเดียว = ไปกลุ่มถัดไป, หลายแท็บ = โหลดหน้าเดิมใหม่เพื่อกวาดรอบใหม่
   */
  async function maybeRotate() {
    if (state.rotating) return;

    const mins = (Date.now() - state.groupStartedAt) / 60000;
    const timeUp = CFG.perGroupMinutes > 0 && mins >= CFG.perGroupMinutes;
    const feedDry = state.idleScrolls >= CFG.idleScrollsToRotate;
    const tooOld = state.oldStreak >= 3;
    if (!timeUp && !feedDry && !tooOld) return;

    const why = tooOld ? 'เลื่อนพ้น ' + CFG.maxAgeHours + ' ชม. ย้อนหลังแล้ว'
      : timeUp ? 'ครบ ' + CFG.perGroupMinutes + ' นาที'
      : 'ไม่มีโพสต์ใหม่';

    const urls = (CFG.groupUrls || []).filter(Boolean);
    const canRotate = CFG.rotateGroups && state.mode !== 'parallel' && urls.length >= 2;

    state.rotating = true;
    state.running = false;                       // หยุดลูปก่อนเปลี่ยนหน้า
    clearTimeout(state.timer);

    if (canRotate) {
      log('ไปกลุ่มถัดไป (' + why + ')', 'hit');
      setStatus('กำลังเปลี่ยนกลุ่ม...');
      const res = await chrome.runtime.sendMessage({ type: 'next-group' }).catch(() => null);
      if (res && res.ok) return;                 // หน้าจะโหลดใหม่แล้วเริ่มเอง
      log('เปลี่ยนกลุ่มไม่สำเร็จ: ' + ((res && res.error) || 'ไม่ทราบสาเหตุ'), 'err');
    }

    // ไม่มีกลุ่มให้ไปต่อ — โหลดหน้าเดิมใหม่เพื่อกวาดฟีดรอบใหม่จากบนสุด
    log('รีเฟรชหน้าเพื่อกวาดใหม่ (' + why + ')', 'hit');
    setStatus('กำลังรีเฟรช...');
    setTimeout(() => location.reload(), 800);
  }

  function loop() {
    clearTimeout(state.timer);
    if (!state.running) return;
    state.timer = setTimeout(async () => {
      await tick();
      loop();
    }, CFG.scrollInterval + Math.round(rand(-250, 400)));
  }

  function start() {
    if (state.running) return;
    if (CFG.onlyGroups && !/\/groups\//.test(location.pathname)) {
      log('เปิดหน้ากลุ่มก่อน (facebook.com/groups/...) หรือปิดตัวเลือก "เฉพาะกลุ่ม"', 'err');
      return;
    }
    const active = CFG.rules.filter((r) => r.enabled);
    if (!active.length || active.every((r) => !r.image && !(r.text || '').trim())) {
      log('ยังไม่ได้ตั้งรูป/ข้อความในกฎ — กดไอคอนส่วนขยายเพื่อตั้งค่าก่อน', 'err');
      return;
    }
    state.running = true;
    state.stopReason = '';
    state.idleScrolls = 0;
    state.rotating = false;
    state.groupStartedAt = Date.now();
    if (!state.startedAt) state.startedAt = Date.now();
    log('เริ่มสแกน (' + (CFG.autoSend ? 'โหมดส่งอัตโนมัติ' : 'โหมดยืนยันก่อนส่ง') + ')', 'ok');

    // ให้ service worker เป็นคนส่งจังหวะ จะได้ทำงานต่อแม้ผู้ใช้สลับไปแท็บอื่น
    chrome.runtime.sendMessage({
      type: 'run-start',
      index: state.groupIndex,
      intervalMs: CFG.scrollInterval,
    }).catch(() => log('ต่อ service worker ไม่ได้ — จะทำงานเฉพาะตอนเปิดแท็บนี้ค้างไว้', 'err'));

    setStatus('กำลังทำงาน');
    renderPanel();
    heartbeat(true);
    loop();

    // โพสต์ของตัวเองก่อน (ถ้าโควตารายวันยังเหลือ) แล้วค่อยไล่สแกนคอมเมนต์
    setTimeout(() => { maybePost(); }, 3000);
  }

  function stop(reason) {
    state.running = false;
    state.stopReason = reason || '';
    clearTimeout(state.timer);
    closeApproval('stop');   // โพสต์ที่ค้างอยู่ในกล่องยืนยันจะไม่ถูกทำเครื่องหมายว่าจัดการแล้ว
    if (!state.rotating) {   // เปลี่ยนกลุ่มอยู่ ไม่ใช่การหยุดจริง
      chrome.runtime.sendMessage({ type: 'run-stop' }).catch(() => {});
    }
    if (reason) log('หยุด: ' + reason, 'err');
    setStatus('หยุดแล้ว');
    heartbeat(true);
    renderPanel();
  }

  /* ------------------------------------------------------------------ UI */

  const CSS = `
  .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
    width: 320px; font: 13px/1.45 "Segoe UI", Sarabun, system-ui, sans-serif;
    color: #e8eaed; background: #16181c; border: 1px solid #2c2f36; border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,.45); overflow: hidden; }
  .hd { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#1d2027;
    border-bottom:1px solid #2c2f36; cursor:move; user-select:none; }
  .dot { width:8px; height:8px; border-radius:50%; background:#6b7280; flex:none; }
  .dot.on { background:#22c55e; box-shadow:0 0 8px #22c55e; }
  .ttl { font-weight:600; flex:1; }
  .mini { background:none; border:none; color:#9aa0a6; cursor:pointer; font-size:14px; padding:0 4px; }
  .bd { padding:10px 12px; }
  .row { display:flex; gap:8px; margin-bottom:8px; }
  .act { flex:1; padding:8px 10px; border-radius:8px; border:1px solid #333842;
    background:#252a33; color:#e8eaed; cursor:pointer; font:inherit; font-weight:600; }
  .act:hover { background:#2f3542; }
  .go { background:#1a7f42; border-color:#1a7f42; }
  .go:hover { background:#22a054; }
  .no { background:#7f1d1d; border-color:#7f1d1d; }
  .no:hover { background:#a12626; }
  .stat { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; margin-bottom:8px; text-align:center; }
  .stat div { background:#1d2027; border-radius:8px; padding:6px 2px; }
  .stat b { display:block; font-size:15px; }
  .stat span { font-size:10px; color:#9aa0a6; }
  .status { font-size:11px; color:#9aa0a6; margin-bottom:8px; min-height:15px; }
  .log { max-height:150px; overflow:auto; background:#101216; border:1px solid #23262c;
    border-radius:8px; padding:6px 8px; font-size:11px; }
  .log p { margin:0 0 3px; word-break:break-word; }
  .log .ok { color:#4ade80; } .log .err { color:#f87171; }
  .log .hit { color:#facc15; } .log .dim { color:#6b7280; }
  .mode { font-size:11px; color:#9aa0a6; margin-bottom:8px; display:flex;
    align-items:center; gap:6px; flex-wrap:wrap; }
  .badge { background:#2c2f36; border-radius:20px; padding:2px 8px; }
  .badge.auto { background:#7c2d12; color:#fdba74; }
  .badge.ai { background:#0f2e22; color:#6ee7b7; }
  .hide .bd { display:none; }
  .ask { position:fixed; z-index:2147483647; right:16px; bottom:16px; width:340px;
    background:#16181c; color:#e8eaed; border:1px solid #3b3f47; border-radius:12px;
    box-shadow:0 12px 40px rgba(0,0,0,.6); padding:12px;
    font:13px/1.45 "Segoe UI", Sarabun, system-ui, sans-serif; }
  .ask h4 { margin:0 0 6px; font-size:13px; color:#facc15; }
  .ask .q { background:#101216; border-radius:8px; padding:8px; max-height:110px;
    overflow:auto; font-size:12px; margin-bottom:8px; white-space:pre-wrap; }
  .ask .ai { background:#0f1f18; border:1px solid #1a5c3a; color:#6ee7b7;
    border-radius:8px; padding:6px 8px; font-size:11px; margin-bottom:8px; }
  .ask img { max-width:100%; max-height:110px; border-radius:8px; margin-bottom:8px; display:block; }
  .cd { font-size:11px; color:#9aa0a6; margin-top:6px; text-align:center; }
  `;

  let host = null, root = null, panelEl = null;
  let logs = [], statusText = 'พร้อมทำงาน', collapsed = false;

  function ensurePanel() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'mrmoo-host';
    host.setAttribute('style', 'all: initial');   // กัน CSS ของหน้าเว็บมากวน
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    panelEl = document.createElement('div');
    panelEl.className = 'wrap';
    root.appendChild(panelEl);
    document.documentElement.appendChild(host);
    renderPanel();
  }

  function renderPanel() {
    if (!panelEl) return;
    panelEl.className = 'wrap' + (collapsed ? ' hide' : '');
    panelEl.innerHTML =
      '<div class="hd">' +
        '<span class="dot ' + (state.running ? 'on' : '') + '"></span>' +
        '<span class="ttl">MR.MOO Ticket Scanner</span>' +
        '<button class="mini" data-a="fold">' + (collapsed ? '▲' : '▼') + '</button>' +
      '</div>' +
      '<div class="bd">' +
        '<div class="mode">โหมด: ' +
          '<span class="badge ' + (CFG.autoSend ? 'auto' : '') + '">' +
            (CFG.autoSend ? 'ส่งอัตโนมัติ' : 'ยืนยันก่อนส่ง') + '</span>' +
          '<span class="badge">เว้น ' + CFG.minGapSec + ' วิ</span>' +
          '<span class="badge ' + (CFG.aiMode !== 'off' ? 'ai' : '') + '">AI: ' +
            (CFG.aiMode === 'assist' ? 'ช่วยอ่าน' : CFG.aiMode === 'verify' ? 'ตรวจซ้ำ' : 'ปิด') +
          '</span>' +
        '</div>' +
        '<div class="stat">' +
          '<div><b>' + state.scanned + '</b><span>สแกน</span></div>' +
          '<div><b>' + state.matched + '</b><span>ตรงคำ</span></div>' +
          '<div><b>' + state.sessionCount + '</b><span>คอมเมนต์</span></div>' +
          '<div><b>' + state.skipped + '</b><span>ข้าม</span></div>' +
          '<div><b>' + state.aiCalls + '</b><span>เรียก AI</span></div>' +
        '</div>' +
        '<div class="status">' + statusText +
          (state.stopReason ? ' — ' + escapeHtml(state.stopReason) : '') + '</div>' +
        '<div class="row">' +
          '<button class="act ' + (state.running ? 'no' : 'go') + '" data-a="toggle">' +
            (state.running ? 'หยุด' : 'เริ่มสแกน') + '</button>' +
          '<button class="act" data-a="reset">ล้างสถิติ</button>' +
        '</div>' +
        '<div class="row">' +
          '<button class="act" data-a="dump">ดูโพสต์ที่เห็นตอนนี้</button>' +
          '<button class="act" data-a="trace">' +
            (CFG.traceLog ? 'ปิดโหมดละเอียด' : 'เปิดโหมดละเอียด') + '</button>' +
        '</div>' +
        '<div class="log">' +
          (logs.length ? logs.map((l) => '<p class="' + l.k + '">' + l.t + '</p>').join('')
                       : '<p class="dim">ยังไม่มีบันทึก</p>') +
        '</div>' +
      '</div>';

    panelEl.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'toggle') { state.running ? stop('') : start(); }
        else if (a === 'fold') { collapsed = !collapsed; renderPanel(); }
        else if (a === 'dump') dumpVisible();
        else if (a === 'trace') {
          CFG.traceLog = !CFG.traceLog;
          store.set({ cfg: CFG });
          log(CFG.traceLog ? 'เปิดโหมดละเอียดแล้ว — จะรายงานทุกโพสต์'
                           : 'ปิดโหมดละเอียดแล้ว', 'dim');
        }
        else if (a === 'reset') {
          state.scanned = state.matched = state.skipped = state.sessionCount = 0;
          state.aiCalls = 0;
          state.hourStamps = [];
          logs = [];
          log('ล้างสถิติแล้ว', 'dim');
        }
      };
    });
    makeDraggable();
  }

  function makeDraggable() {
    const hd = panelEl.querySelector('.hd');
    if (!hd) return;
    hd.onmousedown = (e) => {
      if (e.target.dataset && e.target.dataset.a) return;
      const r = panelEl.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => {
        panelEl.style.left = (ev.clientX - dx) + 'px';
        panelEl.style.top = (ev.clientY - dy) + 'px';
        panelEl.style.right = 'auto';
        panelEl.style.bottom = 'auto';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function log(text, kind) {
    const time = new Date().toLocaleTimeString('th-TH', { hour12: false });
    logs.unshift({ t: '[' + time + '] ' + escapeHtml(text), k: kind || '' });
    if (logs.length > 60) logs.pop();
    renderPanel();
  }

  function setStatus(s) { statusText = escapeHtml(s); renderPanel(); }

  /* รายงานขั้นตอนลง Console เพื่อดูว่าการคอมเมนต์ไปค้างตรงไหน */
  const step = (msg) => console.log('[MR.MOO] ' + msg);

  /* บันทึกเหตุผลที่ข้ามโพสต์ — แสดงเมื่อเปิด debugLog เท่านั้น */
  function dbg(text) { if (CFG.debugLog) log(text, 'dim'); }

  function highlight(post) {
    post.style.outline = '3px solid #facc15';
    post.style.outlineOffset = '2px';
  }

  function unhighlight(post) {
    post.style.outline = '';
    post.style.outlineOffset = '';
  }

  /* -------------------------------------------------- กล่องยืนยันก่อนส่ง */

  let askResolve = null, askEl = null, askTimer = null;

  function closeApproval(val) {
    clearInterval(askTimer);
    if (askEl) { askEl.remove(); askEl = null; }
    if (askResolve) { const r = askResolve; askResolve = null; r(val); }
  }

  /* กล่องยืนยันใช้ร่วมกันทั้งคอมเมนต์และโพสต์ — ต่างกันแค่หัวข้อกับเนื้อหาที่โชว์ */
  async function askApproval(post, rule, text, ai, title) {
    const img = await getImage(rule.image);
    const aiLine = ai
      ? '<div class="ai">AI: ' + escapeHtml(
          (ai.is_seeker ? 'คนหาตั๋ว' : 'ไม่ใช่คนหาตั๋ว') +
          ' · มั่นใจ ' + (typeof ai.confidence === 'number' ? ai.confidence.toFixed(2) : '-') +
          (ai.cinema ? ' · ' + ai.cinema : '') +
          (ai.movie ? ' · ' + ai.movie : '') +
          (ai.seats ? ' · ' + ai.seats : '') +
          (ai.reason ? ' — ' + ai.reason : '')
        ) + '</div>'
      : '';
    return new Promise((resolve) => {
      askResolve = resolve;
      askEl = document.createElement('div');
      askEl.className = 'ask';
      askEl.innerHTML =
        '<h4>' + escapeHtml(title || 'เจอโพสต์ตรงเงื่อนไข — ส่งคอมเมนต์ไหม?') + '</h4>' +
        (post || text
          ? '<div class="q">' + escapeHtml((getAuthor(post) || '') + '\n' + String(text).slice(0, 300)) + '</div>'
          : '') +
        aiLine +
        (img ? '<img src="' + img.dataUrl + '" alt="">' : '') +
        (rule.text ? '<div class="q">' + escapeHtml(rule.text) + '</div>' : '') +
        '<div class="row">' +
          '<button class="act go" data-v="yes">ส่งเลย</button>' +
          '<button class="act" data-v="no">ข้าม</button>' +
          '<button class="act no" data-v="stop">หยุด</button>' +
        '</div>' +
        '<div class="cd"></div>';
      root.appendChild(askEl);
      askEl.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => {
          const v = b.dataset.v;
          closeApproval(v === 'yes' ? true : (v === 'stop' ? 'stop' : false));
        };
      });
      let left = 60;                    // ไม่ตอบใน 60 วิ = พักไว้ ยังไม่ตัดทิ้งถาวร
      const cd = askEl.querySelector('.cd');
      askTimer = setInterval(() => {
        left--;
        if (cd) cd.textContent = 'ไม่ตอบใน ' + left + ' วินาที จะพักโพสต์นี้ไว้ก่อน';
        if (left <= 0) closeApproval('timeout');
      }, 1000);
    });
  }

  /* ------------------------------------------------------------ messages */

  /* ไล่ตรวจทีละชั้นว่าอะไรทำงาน อะไรไม่ทำงาน — เรียกจากปุ่มในป๊อปอัป */
  async function diagnose() {
    const r = {
      url: location.pathname,
      isGroup: /\/groups\//.test(location.pathname),
      panel: !!(host && host.isConnected),
      running: state.running,
    };

    // 1. สะพานไปยัง MAIN world (ตัวที่ใช้แปะรูป) ยังต่อติดไหม
    try {
      await callMain(document.body, 'ping');
      r.bridge = true;
    } catch (err) {
      r.bridge = false;
      r.bridgeError = err.message;
    }

    // 2. มองเห็นโพสต์ในหน้าไหม อ่านข้อความออกกี่โพสต์
    const raw = document.querySelectorAll('div[role="article"]').length;
    const posts = getPosts();
    r.rawArticles = raw;
    r.posts = posts.length;

    let readable = 0, sample = '';
    const how = {};
    const kinds = { match: 0, ambiguous: 0, blocked: 0, hint: 0, none: 0 };
    for (const p of posts) {
      const got = extractText(p);
      const t = got.text;
      how[got.how] = (how[got.how] || 0) + 1;
      if (t && t.length >= 5) {
        readable++;
        if (!sample) sample = t.slice(0, 80).replace(/\n/g, ' ');
        const m = matchRule(t);
        kinds[m ? m.kind : 'none']++;
      }
    }
    r.readable = readable;
    r.readHow = how;
    r.sample = sample;
    r.kinds = kinds;

    // 3. เปิดกล่องคอมเมนต์ของโพสต์แรกได้ไหม (แค่หาปุ่ม ไม่กด)
    const first = posts[0];
    if (first) {
      const btns = Array.prototype.slice.call(first.querySelectorAll('div[role="button"], span[role="button"]'));
      r.commentBtn = btns.some((b) => {
        const s = (b.getAttribute('aria-label') || b.innerText || '').trim();
        return s.length > 0 && s.length < 40 && COMMENT_BTN_RE.test(s);
      });
    }

    // 4. ตั้งค่าครบพร้อมทำงานหรือยัง
    const active = CFG.rules.filter((x) => x.enabled);
    r.rulesEnabled = active.length;
    r.rulesReady = active.filter((x) => x.image || (x.text || '').trim()).length;
    r.aiMode = CFG.aiMode;
    r.hasKey = !!(CFG.apiKey || '').trim();
    r.doneCount = Object.keys(doneIds).length;
    r.probe = probeDom();
    return r;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (!msg) return;
    // จังหวะจาก service worker — ใช้แทน timer ของแท็บที่โดน Chrome หน่วงตอนถูกซ่อน
    if (msg.type === 'tick') {
      if (state.running) tick();
      send({ ok: true, running: state.running });
      return true;
    }
    if (msg.type === 'halt') { stop('สั่งหยุดทุกแท็บ'); send({ ok: true }); return true; }

    if (msg.type === 'dump') { send({ ok: true, rows: dumpVisible(), probe: probeDom() }); return true; }
    if (msg.type === 'diagnose') { diagnose().then((r) => send({ ok: true, report: r })); return true; }
    if (msg.type === 'start') { start(); send({ ok: true, running: state.running }); }
    else if (msg.type === 'stop') { stop('สั่งหยุดจากป๊อปอัป'); send({ ok: true }); }
    else if (msg.type === 'status') {
      send({
        ok: true, running: state.running, scanned: state.scanned, matched: state.matched,
        sent: state.sessionCount, skipped: state.skipped, status: statusText,
      });
    }
    return true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyS') {
      e.preventDefault();
      state.running ? stop('') : start();
    }
  }, true);

  /* --------------------------------------------------------------- boot */

  (async () => {
    await loadConfig();
    ensurePanel();
    setInterval(() => {                        // FB เป็น SPA: เอาแผงกลับมาถ้าโดนรื้อ
      if (!host || !host.isConnected) { host = null; ensurePanel(); }
    }, 3000);

    // หน้าเพิ่งโหลดใหม่ (เปลี่ยนกลุ่ม/รีเฟรช/เปิดหลายแท็บ) — ถามว่าแท็บนี้ควรทำงานต่อไหม
    const hi = await chrome.runtime.sendMessage({ type: 'hello' }).catch(() => null);
    if (hi && hi.shouldRun) {
      state.mode = hi.mode || 'single';
      state.groupIndex = hi.index || 0;
      log('ทำงานต่อจากรอบก่อน' + (state.mode === 'parallel' ? ' (โหมดหลายกลุ่ม)' : ''), 'ok');
      setTimeout(start, 2500);                 // รอ Facebook โหลดฟีดก่อน
      return;
    }
    log('พร้อมทำงาน — กด "เริ่มสแกน" หรือ Alt+Shift+S', 'dim');
  })();

  /* แท็บถูกซ่อน = Chrome หน่วง timer แต่ service worker ยังส่งจังหวะมาให้ */
  document.addEventListener('visibilitychange', () => {
    if (!state.running) return;
    log(document.hidden ? 'สลับไปแท็บอื่น — ทำงานต่อเบื้องหลัง' : 'กลับมาที่แท็บนี้', 'dim');
  });
})();
