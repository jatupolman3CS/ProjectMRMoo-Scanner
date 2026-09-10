/* MR.MOO Ticket Scanner - dashboard */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clock = (ts) => new Date(ts).toLocaleTimeString('th-TH', { hour12: false });

function since(ts) {
  if (!ts) return '-';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'เมื่อครู่';
  if (m < 60) return m + ' นาที';
  const h = Math.floor(m / 60);
  return h + ' ชม. ' + (m % 60) + ' นาที';
}

function renderTotals(d) {
  const bots = d.bots || [];
  const running = bots.filter((b) => b.running && b.status !== 'ไม่ตอบสนอง').length;
  const sum = (k) => bots.reduce((a, b) => a + (b[k] || 0), 0);

  $('totals').innerHTML = [
    ['<b>' + running + ' / ' + bots.length + '</b><span>บอทที่ทำงาน</span>'],
    ['<b>' + sum('rounds') + '</b><span>รอบที่วนไปแล้ว</span>'],
    ['<b>' + sum('scanned') + '</b><span>โพสต์ที่สแกน</span>'],
    ['<b>' + sum('matched') + '</b><span>ตรงเงื่อนไข</span>'],
    ['<b>' + d.quota.hour + ' / ' + d.quota.perHour + '</b><span>คอมเมนต์ชั่วโมงนี้</span>'],
    ['<b>' + d.quota.session + ' / ' + d.quota.perSession + '</b><span>คอมเมนต์รอบนี้</span>'],
    ['<b>' + d.quota.posts + ' / ' + d.quota.postsPerDay + '</b><span>โพสต์วันนี้</span>'],
    ['<b>' + sum('aiCalls') + '</b><span>เรียก AI</span>'],
  ].map((x) => '<div>' + x + '</div>').join('');

  $('live').className = 'dot' + (running ? ' on' : '');
}

function renderBots(bots) {
  if (!bots.length) {
    $('bots').innerHTML = '<div class="empty">ยังไม่มีบอททำงานอยู่ — ' +
      'เปิดหน้ากลุ่มแล้วกด "เริ่มสแกน" หรือใช้ปุ่ม "เปิดทุกกลุ่มพร้อมกัน" ในหน้าตั้งค่า</div>';
    return;
  }

  $('bots').innerHTML = bots.map((b) => {
    const dead = b.status === 'ไม่ตอบสนอง';
    const cls = dead ? 'dead' : (b.running ? 'on' : '');
    const stCls = dead ? 'dead' : (b.running ? 'run' : '');
    return '<div class="bot ' + cls + '">' +
      '<div class="hd">' +
        '<span class="dot ' + (b.running && !dead ? 'on' : '') + '"></span>' +
        '<span class="name" title="' + esc(b.group) + '">' + esc(b.group || 'ไม่ทราบกลุ่ม') + '</span>' +
        (b.hidden ? '<span class="note">เบื้องหลัง</span>' : '') +
      '</div>' +
      (b.url ? '<a class="grp" href="' + esc(b.url) + '" target="_blank">เปิดกลุ่มนี้</a>' : '') +
      '<div class="st ' + stCls + '">' + esc(b.status || '-') + '</div>' +
      '<div class="grid">' +
        '<div><b>' + (b.rounds || 0) + '</b><span>รอบ</span></div>' +
        '<div><b>' + (b.scanned || 0) + '</b><span>สแกน</span></div>' +
        '<div><b>' + (b.commented || 0) + '</b><span>คอมเมนต์</span></div>' +
        '<div><b>' + (b.skipped || 0) + '</b><span>ข้าม</span></div>' +
      '</div>' +
      '<div class="meta">' +
        '<span>เริ่ม ' + (b.startedAt ? clock(b.startedAt) : '-') + ' น. (' + since(b.startedAt) + ')</span>' +
        '<span>อัปเดต ' + (b.lastSeen ? since(b.lastSeen) : '-') + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderEvents(events) {
  if (!events.length) {
    $('evbody').innerHTML = '<tr><td colspan="5" class="empty" style="border:0">' +
      'ยังไม่มีประวัติ</td></tr>';
    return;
  }

  const label = { comment: 'คอมเมนต์', post: 'โพสต์', error: 'ผิดพลาด' };

  $('evbody').innerHTML = events.map((e) => {
    const detail = e.kind === 'error'
      ? esc(e.message)
      : esc([e.author, e.snippet].filter(Boolean).join(' — ')) +
        (e.what ? ' <span class="note">(' + esc(e.what) + ')</span>' : '');
    return '<tr>' +
      '<td class="t">' + clock(e.ts) + '</td>' +
      '<td><span class="tag ' + e.kind + '">' + (label[e.kind] || e.kind) + '</span></td>' +
      '<td>' + esc(e.group || '-') + '</td>' +
      '<td><div class="snip">' + detail + '</div></td>' +
      '<td>' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank">เปิดโพสต์</a>' : '-') + '</td>' +
    '</tr>';
  }).join('');
}

async function refresh() {
  const d = await chrome.runtime.sendMessage({ type: 'dash-data' }).catch(() => null);
  if (!d || !d.ok) {
    $('bots').innerHTML = '<div class="empty">ต่อกับส่วนขยายไม่ได้ — ลอง Reload ที่ chrome://extensions</div>';
    return;
  }
  $('clock').textContent = 'อัปเดตล่าสุด ' + clock(d.now) + ' น.';
  renderTotals(d);
  renderBots(d.bots || []);
  renderEvents(d.events || []);
}

$('btn-refresh').onclick = refresh;

$('btn-stopall').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'stop-all', closeTabs: false }).catch(() => {});
  refresh();
};

$('btn-clear').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'dash-clear' }).catch(() => {});
  refresh();
};

refresh();
setInterval(refresh, 2000);
