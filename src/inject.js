/*
 * MR.MOO Ticket Scanner - MAIN world helper
 *
 * ทำงานใน "หน้าเว็บจริง" (MAIN world) เพื่อให้ event ที่ยิงออกไปถูก React/Lexical
 * ของ Facebook รับได้แน่นอน  content.js (ISOLATED world) จะสั่งงานผ่าน CustomEvent
 * และอ้างอิง element ด้วย attribute data-mrmoo-target แทนการส่ง DOM node ข้าม world
 */
(() => {
  'use strict';
  if (window.__mrmooInjected) return;
  window.__mrmooInjected = true;

  const REQ = 'mrmoo:req';
  const RES = 'mrmoo:res';
  const TARGET_ATTR = 'data-mrmoo-target';

  const reply = (id, ok, data) => {
    document.dispatchEvent(new CustomEvent(RES, {
      detail: JSON.stringify({ id, ok, data: data === undefined ? null : data }),
    }));
  };

  const target = (key) => document.querySelector(`[${TARGET_ATTR}="${key}"]`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function dataUrlToFile(dataUrl, filename) {
    const [head, b64] = dataUrl.split(',');
    const mime = (head.match(/data:([^;]+)/) || [, 'image/png'])[1];
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new File([buf], filename || 'ticket.png', { type: mime });
  }

  function focus(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* วางข้อความแบบเดียวกับที่ผู้ใช้กด Ctrl+V */
  function pasteText(el, text) {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    return el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    }));
  }

  function typeOne(el, line) {
    let ok = false;
    try { ok = document.execCommand('insertText', false, line); } catch (_) { ok = false; }
    if (!ok) pasteText(el, line);
  }

  /*
   * ข้อความหลายบรรทัด: ใช้การ "วาง" ทั้งก้อน ตัวแก้ไขของ Facebook แปลง \n
   * เป็นการขึ้นบรรทัดให้เอง
   *
   * ห้ามจำลองปุ่ม Enter เด็ดขาด แม้จะใส่ shiftKey ไปด้วย เพราะถ้าตัวแก้ไข
   * มองว่าเป็น Enter ธรรมดา คอมเมนต์จะถูกส่งออกไปกลางคันทั้งที่ยังพิมพ์ไม่จบ
   */
  function insertText(el, text) {
    focus(el);
    const s = String(text == null ? '' : text);
    if (!s) return true;

    if (s.indexOf('\n') === -1) {
      typeOne(el, s);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    /*
     * ใส่ครั้งเดียวจบ ห้ามมีทางสำรองที่ทำงานต่อทันที
     *
     * ตัวแก้ไขของ Facebook อัปเดต DOM แบบ asynchronous ถ้าเช็ค innerText
     * ทันทีหลังวาง จะยังได้ค่าเก่าเสมอ แล้วเข้าใจผิดว่า "วางไม่ติด"
     * จึงพิมพ์ซ้ำอีกรอบ กลายเป็นคอมเมนต์ที่มีข้อความเบิ้ลสองชุด
     *
     * ถ้าวางไม่ติดจริง ฝั่ง content script จะล้างกล่องแล้วสั่งใหม่เอง
     */
    pasteText(el, s);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /* พิมพ์ทีละบรรทัด ใช้เฉพาะตอนที่ content script สั่งมาว่าให้ลองวิธีนี้แทน */
  function typeLines(el, text) {
    focus(el);
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        try { document.execCommand('insertLineBreak'); } catch (_) { /* ข้ามไป */ }
      }
      if (lines[i]) typeOne(el, lines[i]);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /* แปะรูปเข้ากล่องคอมเมนต์ด้วย paste event (วิธีเดียวกับ Ctrl+V ของผู้ใช้) */
  function pasteImage(el, dataUrl, filename) {
    const file = dataUrlToFile(dataUrl, filename);
    const dt = new DataTransfer();
    dt.items.add(file);
    focus(el);
    const ev = new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    });
    const delivered = el.dispatchEvent(ev);
    return { delivered, size: file.size, type: file.type };
  }

  /*
   * ตัวแก้ไขข้อความแต่ละรุ่นดักคนละ event บางที่ดู keydown บางที่ดู beforeinput
   * จึงยิงให้ครบทั้งชุด (ไม่ใส่ shiftKey — อันนี้คือ "ส่ง" จริง ๆ ไม่ใช่ขึ้นบรรทัด)
   */
  function pressEnter(el) {
    focus(el);
    const init = {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertParagraph', bubbles: true, cancelable: true,
    }));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    return true;
  }

  function clickEl(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
    return true;
  }

  /* ล้างกล่องคอมเมนต์ ใช้ตอนส่งไม่สำเร็จ จะได้ไม่มีข้อความค้างทิ้งไว้ */
  function clearText(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    try { document.execCommand('delete', false); } catch (_) { /* ไม่เป็นไร */ }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  const ACTIONS = {
    ping: () => 'pong',                    // ใช้ตรวจว่าสคริปต์ฝั่ง MAIN world โหลดแล้ว
    clearText: (el) => clearText(el),
    pressEscape: (el) => {
      const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
                     bubbles: true, cancelable: true, composed: true };
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      return true;
    },
    insertText: (el, p) => insertText(el, p.text),
    typeLines: (el, p) => typeLines(el, p.text),
    pasteImage: (el, p) => pasteImage(el, p.dataUrl, p.filename),
    pressEnter: (el) => pressEnter(el),
    click: (el) => clickEl(el),
    focus: (el) => { focus(el); return true; },
  };

  document.addEventListener(REQ, async (e) => {
    let p;
    try { p = JSON.parse(e.detail); } catch (_) { return; }
    const fn = ACTIONS[p.action];
    if (!fn) return reply(p.id, false, 'unknown action: ' + p.action);
    const el = target(p.key);
    if (!el) return reply(p.id, false, 'target not found');
    try {
      const out = await fn(el, p);
      await sleep(0);
      reply(p.id, true, out);
    } catch (err) {
      reply(p.id, false, String(err && err.message ? err.message : err));
    }
  });
})();
