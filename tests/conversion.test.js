// Google Ads paid-registration conversion on /confirmed.
// Flows run up to "Continue to Secure Payment" (Stripe intercepted), then return to /confirmed the way
// Stripe redirects (?session_id=cs_...). Events are read from window.dataLayer; Google requests are
// answered locally, so nothing is sent to the real Google Ads account.
const { chromium } = require('playwright-core');
const { stubGoogle } = require('./google-stub');

const BASE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEND_TO = 'AW-18439430263/A1y-CLvYk5UdEPfAzdhE';
const NOW = '2026-10-07T12:00:00-05:00';   // both promotions active
const REG = { ccl: 'https://buy.stripe.com/14A5kDf6g3MXdJ28llak000', renewal: 'https://buy.stripe.com/6oU7sLgakcjt34ocBBak002', womens: 'https://buy.stripe.com/eVqdR92ju6Z934odFFak001', private: 'https://buy.stripe.com/eVq3cve2c97hcEY7hhak003', test: 'https://buy.stripe.com/6oUbJ18HS4R1gVe7hhak004' };
let fails = 0, n = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };
const sid = () => 'cs_test_' + Date.now().toString(36) + 'Kat' + (++n) + 'x9Q2';

const iso = k => { const d = new Date(new Date(NOW).getTime() + k * 86400000); return d.toISOString().slice(0, 10); };
const doc = f => ({ name: 'x', fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }])) });
const STANDINS = {
  TESTccl: { type: 'ccl', date1: iso(12), date2: iso(13), endDate: iso(13), time: '09:30', price: 175 },
  TESTrenewal: { type: 'renewal', date1: iso(15), date2: '', endDate: iso(15), time: '18:00', price: 125 },
  TESTwomens: { type: 'womens', date1: iso(18), date2: '', endDate: iso(18), time: '12:00', price: 125 }
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  async function fresh() {
    const ctx = await browser.newContext();
    await stubGoogle(ctx);
    await ctx.addInitScript(() => { try { sessionStorage.setItem('katcci_promo_seen', '1'); } catch (e) {} });
    await ctx.route(/Firestore\/Write|formspree\.io/, r => r.abort());
    await ctx.route(/firestore\.googleapis\.com\/v1\/projects\/katcci\/databases\/\(default\)\/documents\/classes\/TEST/, r => {
      const id = new URL(r.request().url()).pathname.split('/').pop();
      STANDINS[id] ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc(STANDINS[id])) }) : r.fulfill({ status: 404, body: '{}' });
    });
    await ctx.route(/^https:\/\/(buy|checkout)\.stripe\.com\//, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe stand-in</title>' }));
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(NOW));
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    return { ctx, page, errors };
  }
  const conversions = page => page.evaluate(() => (window.dataLayer || []).map(a => Array.from(a)).filter(a => a[0] === 'event' && a[1] === 'conversion').map(a => a[2]));
  // Browser storage is per site, so read the pending purchase from a KAT CCI page (not the Stripe stand-in).
  const pending = async page => {
    if (!page.url().startsWith(BASE)) await page.goto(BASE + '/terms');
    return page.evaluate(() => localStorage.getItem('katcci_pending_purchase'));
  };
  // Reserve page → check every acknowledgment → Continue (Stripe intercepted).
  async function checkout(page, reservePath) {
    await page.goto(BASE + reservePath);
    await page.waitForSelector('.ack-check', { timeout: 15000 });
    for (const c of await page.$$('.ack-check')) await c.check();
    await page.click('#continueBtn');
    await page.waitForURL(/stripe\.com/);
  }
  async function confirmed(page, query) {
    await page.goto(BASE + '/confirmed' + query);
    await page.waitForTimeout(500);
    return conversions(page);
  }

  console.log('Must NOT fire');
  let { ctx, page, errors } = await fresh();
  await page.goto(BASE + '/'); await page.waitForTimeout(800);
  ok((await conversions(page)).length === 0 && !(await pending(page)), 'homepage visit: no conversion, nothing pending');
  await page.goto(BASE + '/reserve?class=TESTccl');
  await page.waitForSelector('.ack-check');
  for (const c of await page.$$('.ack-check')) await c.check();
  ok((await conversions(page)).length === 0 && !(await pending(page)), 'Reserve page + all acknowledgments checked: no conversion, nothing pending yet');
  ok((await confirmed(page, '')).length === 0, 'direct /confirmed visit: no conversion');
  ok((await confirmed(page, '?session_id=' + sid())).length === 0, '/confirmed?session_id=… without a trusted pending purchase: no conversion');
  await page.goto(BASE + '/reserve?class=TESTccl'); await page.waitForSelector('.ack-check');
  for (const c of await page.$$('.ack-check')) await c.check();
  await page.click('#continueBtn'); await page.waitForURL(/stripe\.com/);
  ok((await conversions(page)).length === 0, 'opening Stripe checkout: no conversion');
  ok(JSON.parse(await pending(page)).value === 175, '…but the trusted amount is now pending ($175)');
  ok((await confirmed(page, '')).length === 0, 'pending purchase but no session_id: no conversion');
  ok((await confirmed(page, '?session_id={CHECKOUT_SESSION_ID}')).length === 0, 'unfilled {CHECKOUT_SESSION_ID} placeholder: no conversion');
  ok((await confirmed(page, '?session_id=not-a-stripe-id&value=999')).length === 0, 'non-Stripe session id: no conversion');
  ok(JSON.parse(await pending(page)).value === 175, 'pending purchase kept until a valid return');
  await page.evaluate(() => localStorage.setItem('katcci_pending_purchase', JSON.stringify({ value: 999, currency: 'USD', kind: 'x', at: Date.now() })));
  ok((await confirmed(page, '?session_id=' + sid() + '&value=999')).length === 0, 'tampered pending value ($999) or ?value= in the URL: no conversion');
  await page.evaluate(() => localStorage.setItem('katcci_pending_purchase', JSON.stringify({ value: 175, currency: 'USD', kind: 'x', at: Date.now() - 7 * 3600 * 1000 })));
  ok((await confirmed(page, '?session_id=' + sid())).length === 0, 'stale pending purchase (over 6 hours old): no conversion');
  ok(errors.length === 0, 'no JavaScript errors ' + errors.join(' | '));
  await ctx.close();

  console.log('Each legitimate checkout → one conversion with its value');
  const CASES = [
    ['Regular 16-Hour CCL', '/reserve?class=TESTccl', 175],
    ['Regular Renewal', '/reserve?class=TESTrenewal', 125],
    ["Regular Women's", '/reserve?class=TESTwomens', 125],
    ['Promotional CCL', '/reserve?promo=ccl-2026-10-17&utm_source=google&gclid=Cj0-conv', 160],
    ["Promotional Women's", '/reserve?promo=womens-2026-10-24', 100],
    ['Staff-texted CCL link (approved $175 Stripe link)', '/reserve?c=ccl16&to=' + encodeURIComponent(REG.ccl), 175],
    ['Staff-texted Renewal link', '/reserve?c=renewal3&to=' + encodeURIComponent(REG.renewal), 125],
    ["Staff-texted Women's link", '/reserve?c=womens&to=' + encodeURIComponent(REG.womens), 125]
  ];
  for (const [label, path, value] of CASES) {
    ({ ctx, page, errors } = await fresh());
    await checkout(page, path);
    const id = sid();
    const ev = await confirmed(page, '?session_id=' + id + '&utm_source=google');
    ok(ev.length === 1 && ev[0].send_to === SEND_TO && ev[0].value === value && ev[0].currency === 'USD' && ev[0].transaction_id === id,
       `${label}: value ${value}, USD, transaction_id = Stripe session id`);
    ok(!(await pending(page)), `${label}: pending purchase cleared`);
    await page.reload(); await page.waitForTimeout(400);
    ok((await conversions(page)).length === 0, `${label}: refreshing /confirmed sends nothing more`);
    ok((await confirmed(page, '?session_id=' + sid())).length === 0, `${label}: a different session id afterwards (no new checkout) sends nothing`);
    ok(errors.length === 0, `${label}: no JavaScript errors ` + errors.join(' | '));
    await ctx.close();
  }

  console.log('Checkouts outside the approved values → no conversion');
  for (const [label, path] of [
    ['Private 1-on-1 link ($250)', '/reserve?c=private&to=' + encodeURIComponent(REG.private)],
    ['$5 test-class link', '/reserve?c=test&to=' + encodeURIComponent(REG.test)],
    ['CCL label pointed at a different Stripe link', '/reserve?c=ccl16&to=' + encodeURIComponent(REG.test)]]) {
    ({ ctx, page, errors } = await fresh());
    await checkout(page, path);
    ok(!(await pending(page)) && (await confirmed(page, '?session_id=' + sid())).length === 0, label + ': nothing pending, no conversion');
    await ctx.close();
  }

  console.log('Same session id twice (e.g. back button to Stripe and return again)');
  ({ ctx, page, errors } = await fresh());
  await checkout(page, '/reserve?class=TESTccl');
  const same = sid();
  ok((await confirmed(page, '?session_id=' + same)).length === 1, 'first return: one conversion');
  await checkout(page, '/reserve?class=TESTccl');
  ok((await confirmed(page, '?session_id=' + same)).length === 0, 'same session id again: local duplicate guard sends nothing');
  await ctx.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL CONVERSION CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
