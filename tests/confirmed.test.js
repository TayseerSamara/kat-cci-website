// /confirmed — the page Stripe redirects customers to after a successful payment.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { stubGoogle } = require('./google-stub');

const SITE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let fails = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };
const LINES = [
  "You're confirmed!",
  'Thank you for registering with KAT CCI.',
  'Your payment was received and your seat is reserved.',
  'Please watch for your class confirmation and reminder.',
  'Questions? Call or text KAT CCI at 312-799-9965.'
];

(async () => {
  // Deploy file set: the new page is published, private/test/config files are not.
  console.log('Hosting deploy file set (firebase.json ignore rules)');
  const root = path.resolve(__dirname, '..');
  let listFiles = null;
  try { listFiles = require(path.join(execSync('npm root -g').toString().trim(), 'firebase-tools/lib/listFiles.js')).listFiles; } catch (e) {}
  if (listFiles) {
    const files = listFiles(root, require(path.join(root, 'firebase.json')).hosting.ignore).sort();
    ok(files.includes('confirmed.html'), 'confirmed.html will be published');
    ok(!files.some(f => /^(tests\/|\.)|\/\.|^(firebase\.json|\.firebaserc|firestore\.rules)$/.test(f)), 'no tests/, dot-files or Firebase config in the deploy: ' + files.join(' '));
  } else {
    console.log('  (firebase-tools not installed globally — deploy file-set check skipped)');
  }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const [name, viewport] of [['phone', { width: 375, height: 800 }], ['desktop', { width: 1280, height: 900 }]]) {
    console.log(`/confirmed (${name}, ${SITE})`);
    const ctx = await browser.newContext({ viewport });
    const google = await stubGoogle(ctx);
    const page = await ctx.newPage();
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => requests.push(r.url()));
    const res = await page.goto(SITE + '/confirmed?session_id=cs_test_a1B2c3', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    ok(res.status() === 200 && /You're Confirmed · KAT CCI/.test(await page.title()), '/confirmed loads (with a Stripe session_id in the URL)');
    const text = (await page.evaluate(() => document.querySelector('.card').innerText)).replace(/\s+/g, ' ');
    for (const l of LINES) ok(text.includes(l), 'shows: ' + l);
    ok(await page.$eval('h1', e => e.textContent) === "You're confirmed!", 'heading is "You\'re confirmed!"');
    const btn = await page.$eval('a.home-btn', e => ({ href: e.getAttribute('href'), text: e.textContent.trim(), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));
    ok(btn.href === '/' && btn.text === 'Return to KAT CCI' && btn.h >= 44 && btn.w > 200, 'obvious "Return to KAT CCI" button → /');
    ok((await page.$$eval('a[href^="tel:3127999965"]', a => a.length)) >= 1 && (await page.$$eval('a[href^="sms:3127999965"]', a => a.length)) === 1, 'call and text links to 312-799-9965');
    ok(!/stripe|\$\d/i.test(await page.content().then(h => h.replace(/<script[\s\S]*?<\/script>/g, ''))), 'no payment links or prices on the page');
    ok(!(await page.content()).includes('cs_test_a1B2c3'), 'session id is not displayed');
    ok(await page.$eval('meta[name=robots]', e => e.content) === 'noindex', 'not indexed by search engines');
    ok(google.filter(u => u.includes('gtag/js?id=AW-18439430263')).length === 1 && await page.evaluate(() => typeof gtag === 'function'), 'Google tag AW-18439430263 loads once');
    const dl = await page.evaluate(() => (window.dataLayer || []).map(a => Array.from(a)[0]));
    ok(!dl.includes('event'), 'no conversion event fired (base tag only)');
    ok(!requests.some(u => /firestore|firebase|stripe\.com|formspree/.test(u)), 'page makes no Firebase, Stripe or form requests');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scrolling');
    await page.click('a.home-btn');
    await page.waitForURL(u => new URL(u).pathname === '/');
    ok(true, 'Return button goes to the homepage');
    ok(errors.length === 0, 'no JavaScript errors ' + errors.join(' | '));
    if (process.env.SHOTS_DIR) {
      await page.goto(SITE + '/confirmed', { waitUntil: 'load' });
      await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `confirmed-${name}.png`) });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL CONFIRMED-PAGE CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
