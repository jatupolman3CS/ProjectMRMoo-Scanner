'use strict';

// VPS auto-comment bot boilerplate: puppeteer-extra + stealth, headed Chrome under Xvfb.
// Run through PM2 (see ecosystem.config.js) or manually:
//   DRY_RUN=1 TARGET_URLS=https://... xvfb-run -a node index.js

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// ---------- config (override via env, normally set in ecosystem.config.js) ----------
const env = process.env;
const CFG = {
  chromePath: env.CHROME_PATH || '/usr/bin/google-chrome-stable',
  profileDir: env.PROFILE_DIR || path.join(__dirname, 'profile'),
  cookiesFile: env.COOKIES_FILE || path.join(__dirname, 'cookies.json'),
  stateFile: path.join(__dirname, 'state.json'),
  shotsDir: path.join(__dirname, 'shots'),
  targetUrls: (env.TARGET_URLS || '').split(',').map((s) => s.trim()).filter(Boolean),
  keywords: new RegExp(env.KEYWORDS || 'REPLACE_ME', 'i'),
  commentText: env.COMMENT_TEXT || 'REPLACE_ME',
  pollMs: Number(env.POLL_MS || 90_000),
  maxPerHour: Number(env.MAX_COMMENTS_PER_HOUR || 6),
  minGapMs: Number(env.MIN_GAP_MS || 120_000),
  // Safe by default: nothing is posted until DRY_RUN=0 is set explicitly.
  dryRun: env.DRY_RUN !== '0',
  proxy: env.PROXY_SERVER || '',
};

// Exit code 2 = "do not restart" (see stop_exit_codes in ecosystem.config.js).
const EXIT_RESTART = 1;
const EXIT_HALT = 2;

class FatalError extends Error {}

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

// ---------- persisted state: survives PM2 restarts so a crash never double-comments ----------
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(CFG.stateFile, 'utf8'));
    return { seen: s.seen || {}, commentTimes: s.commentTimes || [] };
  } catch {
    return { seen: {}, commentTimes: [] };
  }
}

function saveState(state) {
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  for (const id of Object.keys(state.seen)) if (state.seen[id] < weekAgo) delete state.seen[id];
  const tmp = `${CFG.stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, CFG.stateFile);
}

function canComment(state) {
  const now = Date.now();
  state.commentTimes = state.commentTimes.filter((t) => now - t < 3600_000);
  const last = state.commentTimes[state.commentTimes.length - 1] || 0;
  return state.commentTimes.length < CFG.maxPerHour && now - last >= CFG.minGapMs;
}

// ---------- browser ----------
function clearProfileLocks() {
  // A crashed Chrome leaves these behind and the next launch refuses to open the profile.
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.rmSync(path.join(CFG.profileDir, f), { force: true }); } catch { /* ignore */ }
  }
}

function launch() {
  clearProfileLocks();
  const args = [
    '--no-sandbox', // needed when running as root / on AppArmor-restricted Ubuntu
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', // /dev/shm is small on VPS; avoids random tab crashes
    '--window-size=1366,768',
    '--lang=en-US',
  ];
  if (CFG.proxy) args.push(`--proxy-server=${CFG.proxy}`);

  return puppeteer.launch({
    executablePath: CFG.chromePath,
    headless: false, // headed mode, rendered into the Xvfb virtual display
    userDataDir: CFG.profileDir, // keeps the login session between restarts
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args,
  });
}

// Import cookies exported from a browser you are already logged in with (Cookie-Editor JSON).
// Runs only on the first start; afterwards the persistent profile holds the session.
async function importCookies(browser) {
  if (!fs.existsSync(CFG.cookiesFile)) {
    log(`no ${path.basename(CFG.cookiesFile)} found, starting without a session`);
    return;
  }
  const sameSite = { strict: 'Strict', lax: 'Lax', no_restriction: 'None' };
  const cookies = JSON.parse(fs.readFileSync(CFG.cookiesFile, 'utf8')).map((c) => {
    const out = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
    };
    if (c.expirationDate) out.expires = c.expirationDate;
    const ss = sameSite[String(c.sameSite).toLowerCase()];
    if (ss) out.sameSite = ss;
    return out;
  });
  const page = await browser.newPage();
  await page.setCookie(...cookies);
  await page.close();
  log(`imported ${cookies.length} cookies`);
}

async function shot(page, name) {
  try {
    fs.mkdirSync(CFG.shotsDir, { recursive: true });
    await page.screenshot({ path: path.join(CFG.shotsDir, `${Date.now()}-${name}.png`) });
  } catch { /* best effort */ }
}

const isBlocked = (url) => /\/(login|checkpoint|recover)/i.test(url);

// ---------- site-specific parts: adapt these to the target site ----------

// Must return [{ id, text, url }] where id is STABLE per post (permalink works well).
async function scanPosts(page) {
  return page.$$eval('[role="article"]', (els) =>
    els.slice(0, 15).map((el) => {
      const link = el.querySelector('a[href*="/posts/"], a[href*="/permalink/"]');
      const url = link ? link.href.split('?')[0] : '';
      return { id: url, text: (el.innerText || '').slice(0, 2000), url };
    }).filter((p) => p.id));
}

const shouldReply = (post) => CFG.keywords.test(post.text);
const buildComment = () => CFG.commentText;

async function postComment(page, post, text) {
  if (CFG.dryRun) {
    log(`[DRY_RUN] would comment on ${post.url}: ${text}`);
    return false;
  }
  await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(rand(2500, 5000));
  const box = await page.waitForSelector('div[role="textbox"][contenteditable="true"]', { timeout: 15_000 });
  await box.click();
  await sleep(rand(600, 1500));
  for (const ch of text) { // per-character random delay instead of a fixed typing speed
    await page.keyboard.type(ch);
    await sleep(rand(40, 140));
  }
  await sleep(rand(800, 2000));
  await page.keyboard.press('Enter');
  await sleep(rand(2500, 5000));
  await shot(page, 'commented');
  return true;
}

// ---------- main loop ----------
async function tick(browser, state) {
  const page = await browser.newPage(); // fresh tab per round avoids slow memory growth
  try {
    for (const url of CFG.targetUrls) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await sleep(rand(3000, 6000));
      if (isBlocked(page.url())) {
        await shot(page, 'blocked');
        throw new FatalError(`login wall / checkpoint at ${page.url()}`);
      }

      for (const post of await scanPosts(page)) {
        if (state.seen[post.id]) continue;
        if (!shouldReply(post)) { state.seen[post.id] = Date.now(); continue; }
        if (!canComment(state)) { log('rate limit reached, leaving post for the next round'); continue; }

        // Mark seen BEFORE posting: worst case after a crash is one missed comment, never a duplicate.
        state.seen[post.id] = Date.now();
        saveState(state);

        const commentPage = await browser.newPage();
        try {
          if (await postComment(commentPage, post, buildComment(post))) {
            state.commentTimes.push(Date.now());
            log(`commented on ${post.url}`);
          }
        } catch (e) {
          await shot(commentPage, 'comment-error');
          log(`comment failed on ${post.url}: ${e.message}`);
        } finally {
          await commentPage.close().catch(() => {});
        }
        saveState(state);
        await sleep(rand(8_000, 20_000));
      }
    }
  } catch (e) {
    await shot(page, 'tick-error');
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
  saveState(state);
}

async function main() {
  if (!process.env.DISPLAY) {
    log('DISPLAY not set. Start through xvfb-run (PM2 ecosystem does this).');
    process.exit(EXIT_HALT);
  }
  if (!CFG.targetUrls.length) {
    log('TARGET_URLS is empty. Set it in ecosystem.config.js.');
    process.exit(EXIT_HALT);
  }

  const state = loadState();
  const firstRun = !fs.existsSync(path.join(CFG.profileDir, 'Default'));
  const browser = await launch();
  let stopping = false;

  browser.on('disconnected', () => {
    if (stopping) return;
    log('browser disconnected, exiting so PM2 restarts everything');
    process.exit(EXIT_RESTART);
  });
  const stop = async () => {
    stopping = true;
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  if (firstRun) await importCookies(browser);
  log(`started. dryRun=${CFG.dryRun} targets=${CFG.targetUrls.length} poll=${CFG.pollMs}ms`);

  let failures = 0;
  for (;;) {
    try {
      await tick(browser, state);
      failures = 0;
    } catch (e) {
      if (e instanceof FatalError) {
        log(`FATAL: ${e.message}. Stopping, fix the session manually.`);
        await browser.close().catch(() => {});
        process.exit(EXIT_HALT);
      }
      failures += 1;
      log(`tick failed (${failures}/5): ${e.message}`);
      if (failures >= 5) {
        stopping = true;
        await browser.close().catch(() => {});
        process.exit(EXIT_RESTART);
      }
    }
    await sleep(CFG.pollMs * (0.7 + Math.random() * 0.6)); // +-30% jitter
  }
}

process.on('unhandledRejection', (e) => {
  log('unhandledRejection:', e && e.stack ? e.stack : e);
  process.exit(EXIT_RESTART);
});

main().catch((e) => {
  log('startup failed:', e && e.stack ? e.stack : e);
  process.exit(EXIT_RESTART);
});
