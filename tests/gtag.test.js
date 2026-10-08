// Google Ads base tag (AW-18439430263): present exactly once, right after <head>, on every page.
// Google requests are answered locally (google-stub.js), so no hits reach the real Ads account.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { stubGoogle } = require('./google-stub');

const SITE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ID = 'AW-18439430263';
const LOADER = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
const PAGES = { 'confirmed.html': '/confirmed?session_id=cs_test_a1B2c3', 'index.html': '/', 'reserve.html': '/reserve?c=ccl16&to=' + encodeURIComponent('https://buy.stripe.com/14A5kDf6g3MXdJ28llak000'), 'pay.html': '/pay', 'terms.html': '/terms', 'text.html': '/text' };
const count = (s, needle) => s.split(needle).length - 1;
let fails = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };

(async () => {
  console.log('Source check (repository files)');
  const root = path.resolve(__dirname, '..');
  const htmlFiles = fs.readdirSync(root).filter(f => f.endsWith('.html')).sort();
  ok(JSON.stringify(htmlFiles) === JSON.stringify(Object.keys(PAGES).sort()), 'every site page is covered: ' + htmlFiles.join(', '));
  for (const f of Object.keys(PAGES)) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    ok(count(s, ID) === 2, `${f}: ${ID} present (loader + config)`);
    ok(count(s, 'gtag/js') === 1 && count(s, LOADER) === 1, `${f}: exactly one gtag.js loader`);
    ok(count(s, `gtag('config', '${ID}')`) === 1 && count(s, "gtag('js', new Date())") === 1, `${f}: tag configured exactly once`);
    ok(/<head>\n  <!-- Google tag \(gtag\.js\) -->\n  <script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=AW-18439430263"><\/script>/.test(s), `${f}: placed immediately after <head>`);
    ok(!/GTM-[A-Z0-9]+|\bG-[A-Z0-9]{6,}|\bUA-\d|AW-(?!18439430263)\d+|google-analytics\.com\/analytics\.js/.test(s), `${f}: no other Google tag / Analytics / Tag Manager IDs`);
    ok(!/gtag\(\s*['"]event['"]|send_to/.test(s), `${f}: no conversion event (base tag only)`);
  }

  console.log('Runtime check (' + SITE + ')');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const [f, route] of Object.entries(PAGES)) {
    const ctx = await browser.newContext();
    const seen = await stubGoogle(ctx);
    await ctx.route(/Firestore\/Write|formspree\.io/, r => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(SITE + route, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const loaders = seen.filter(u => u.includes('/gtag/js'));
    const dl = await page.evaluate(() => (window.dataLayer || []).map(a => Array.from(a).map(x => x instanceof Date ? 'Date' : x)));
    ok(loaders.length === 1 && loaders[0] === LOADER, `${route.split('?')[0]}: one gtag.js request, for ${ID}`);
    ok(await page.evaluate(() => typeof window.gtag === 'function') &&
       dl.filter(e => e[0] === 'config' && e[1] === ID).length === 1 && dl.filter(e => e[0] === 'js').length === 1,
       `${route.split('?')[0]}: gtag() defined; dataLayer has js + one config for ${ID}`);
    ok(errors.length === 0, `${route.split('?')[0]}: no JavaScript errors ` + errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL GOOGLE TAG CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
