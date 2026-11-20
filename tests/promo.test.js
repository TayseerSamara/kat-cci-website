// Promotions: none is active now (the expired CCL promotion and the Women's promotion were removed
// on 2026-11-19). Checks that no popup / offer button appears, that old promo links can't reach a
// checkout, and that regular reservation links are unaffected.
// SITE = base URL. Stripe navigation is intercepted: no checkout page is loaded and nothing is paid.
const { chromium } = require('playwright-core');
const { stubGoogle } = require('./google-stub');

const BASE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AD = '?utm_source=google&utm_medium=cpc&utm_campaign=fall_promo&utm_term=ccl+class&gclid=Cj0KCQ-test_123';
const OLD_PROMO_LINKS = ['bJe28rcY86Z9cEYeJJak005', '4gM5kD6zK4R15cwbxxak006'];
const CCL = 'https://buy.stripe.com/4gM7sLaQ0cjt0Wg9ppak007';
let fails = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  async function ctxWith({ at = null, viewport = { width: 400, height: 860 } } = {}) {
    const ctx = await browser.newContext({ viewport });
    await stubGoogle(ctx);
    const state = { stripe: [], errors: [] };
    await ctx.route(/Firestore\/Write|formspree\.io/, r => r.abort());
    await ctx.route(/^https:\/\/(buy|checkout)\.stripe\.com\//, r => { state.stripe.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe stand-in</title>' }); });
    const page = await ctx.newPage();
    if (at) await page.clock.setFixedTime(new Date(at));
    page.on('pageerror', e => state.errors.push(e.message));
    return { ctx, page, state };
  }
  const popupShown = async page => { await page.waitForTimeout(1500); return !!(await page.$('#promoModal.open')); };
  const nothing = async page => !(await popupShown(page)) && !(await page.$('#promoPill')) && !(await page.$('#promoModal a.promo-card'));

  console.log('No promotion popup or offer button');
  for (const [label, at, viewport] of [
    ['ad visitor, phone, today', null, undefined],
    ['regular visitor, desktop, today', null, { width: 1280, height: 900 }],
    ['ad visitor on Sep 24 (when the CCL promo used to show)', '2026-09-24T12:00:00-05:00', undefined],
    ['ad visitor on Oct 20 (Women\'s promo window)', '2026-10-20T12:00:00-05:00', undefined]]) {
    const { ctx, page, state } = await ctxWith({ at, viewport });
    await page.goto(BASE + '/' + (/ad visitor/.test(label) ? AD : ''));
    ok(await nothing(page), label + ': no popup, no offer button, no promo cards');
    ok(!/October Special|SPECIAL PROMO|Promotional price/i.test(await page.evaluate(() => document.body.innerText)), label + ': no promotional wording on the page');
    ok(state.errors.length === 0 && state.stripe.length === 0, label + ': no JavaScript errors, no Stripe request ' + state.errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page } = await ctxWith();
    const js = await (await page.request.get(BASE + '/promos.js?v=20261119b')).text();
    ok(!/https:\/\/(buy|checkout)\.stripe\.com\//.test(js) && OLD_PROMO_LINKS.every(l => !js.includes(l)), 'promos.js contains no Stripe checkout link');
    ok(await page.goto(BASE + '/').then(() => page.evaluate(() => window.KAT_PROMOS.activePromos().length)) === 0, 'KAT_PROMOS.activePromos() is empty');
    await ctx.close();
  }

  console.log('Old promotion links cannot reach a checkout');
  for (const [label, at] of [['today', null], ['on Sep 24 (inside the old CCL promo window)', '2026-09-24T12:00:00-05:00']]) {
    const { ctx, page, state } = await ctxWith({ at });
    for (const path of ['/reserve?promo=ccl-2026-10-17' + AD.replace('?', '&'),
                        '/reserve?promo=womens-2026-10-24',
                        '/reserve?promo=ccl-2026-10-17&to=' + encodeURIComponent('https://buy.stripe.com/bJe28rcY86Z9cEYeJJak005') + '&c=ccl16',
                        '/reserve?promo=bogus']) {
      await page.goto(BASE + path);
      await page.waitForSelector('#errorFlow', { state: 'visible' });
      ok(/no longer available/.test(await page.textContent('#errorFlow')) && !(await page.isVisible('#ackFlow')),
         `${label}: ${path.split('&')[0]} → "no longer available", no acknowledgments or payment button`);
    }
    await page.goto(BASE + '/terms');
    ok(!(await page.evaluate(() => localStorage.getItem('katcci_pending_purchase'))), label + ': nothing pending for a conversion');
    ok(state.stripe.length === 0 && state.errors.length === 0, label + ': no Stripe checkout opened, no JavaScript errors');
    await ctx.close();
  }

  console.log('Regular reservation link unchanged');
  {
    const { ctx, page, state } = await ctxWith();
    await page.goto(BASE + '/reserve?c=ccl16&to=' + encodeURIComponent(CCL));
    ok(!(await page.isVisible('#promoSummary')) && (await page.textContent('#continueBtn')).trim() === 'Continue to Secure Payment →', 'no promo box; normal button');
    for (const c of await page.$$('.ack-check')) await c.check();
    await page.click('#continueBtn'); await page.waitForTimeout(800);
    const u = new URL(state.stripe.pop() || 'https://x/');
    ok(u.origin + u.pathname === CCL, 'regular link → new $200 CCL checkout');
    await page.goto(BASE + '/reserve?c=ccl16&to=' + encodeURIComponent('https://evil.example/pay'));
    ok(/isn't valid/.test(await page.textContent('#errorFlow')), 'non-Stripe destinations refused');
    ok(state.errors.length === 0, 'no JavaScript errors');
    await ctx.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PROMO CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
