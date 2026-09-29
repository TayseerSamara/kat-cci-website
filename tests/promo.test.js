// Homepage promotion popup + /reserve promo flow tests.
// SITE = base URL. Stripe navigation is intercepted: no checkout page is loaded and nothing is paid.
// REAL_PROMOS=1 uses the Stripe links exactly as configured in promos.js (default); REAL_PROMOS=0 swaps in stand-ins.
const { chromium } = require('playwright-core');

const BASE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REAL_PROMOS = process.env.REAL_PROMOS !== '0';
const CCL_LINK = REAL_PROMOS ? 'https://buy.stripe.com/bJe28rcY86Z9cEYeJJak005' : 'https://buy.stripe.com/test_PROMO_CCL';
const WOMENS_LINK = REAL_PROMOS ? 'https://buy.stripe.com/4gM5kD6zK4R15cwbxxak006' : 'https://buy.stripe.com/test_PROMO_WOMENS';
const AD = '?utm_source=google&utm_medium=cpc&utm_campaign=fall_promo&utm_term=ccl+class&gclid=Cj0KCQ-test_123';
const NOTE = 'Limited-time website promotion — book through this offer to receive the promotional price.';
const PILL = '🎉 October Special — View Offers';
const FEE = /3\.38|processing fee|& processing/i;
let fails = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  async function ctxWith({ links = true, at = '2026-09-24T12:00:00-05:00', viewport = { width: 400, height: 860 } } = {}) {
    const ctx = await browser.newContext({ viewport });
    const state = { stripe: [], errors: [] };
    await ctx.route(/Firestore\/Write|formspree\.io/, r => r.abort());
    if (!links || !REAL_PROMOS) {
      await ctx.route(/\/promos\.js(\?|$)/, async r => {
        const res = await r.fetch();
        const body = (await res.text())
          .replace(/(id: 'ccl-2026-10-17'[\s\S]*?checkoutUrl: )'[^']*'/, `$1'${links ? CCL_LINK : ''}'`)
          .replace(/(id: 'womens-2026-10-24'[\s\S]*?checkoutUrl: )'[^']*'/, `$1'${links ? WOMENS_LINK : ''}'`);
        r.fulfill({ response: res, body });
      });
    }
    await ctx.route(/^https:\/\/(buy|checkout)\.stripe\.com\//, r => { state.stripe.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe stand-in</title>' }); });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(at));
    page.on('pageerror', e => state.errors.push(e.message));
    return { ctx, page, state };
  }
  const popupShown = async page => { await page.waitForTimeout(1500); return !!(await page.$('#promoModal.open')); };
  const pillVisible = page => page.$eval('#promoPill', e => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0; }).catch(() => false);
  const checkAll = async page => { for (const c of await page.$$('.ack-check')) await c.check(); };

  console.log('Popup for an ad visitor');
  let { ctx, page, state } = await ctxWith();
  await page.goto(BASE + '/' + AD);
  ok(await popupShown(page), 'popup opens');
  const cards = await page.$$eval('#promoModal a.promo-card', as => as.map(a => ({ href: a.getAttribute('href'), text: a.innerText.replace(/\s+/g, ' ').trim(), s: a.querySelector('s').textContent, price: a.querySelector('.promo-price').textContent })));
  ok(cards.length === 2 && (await page.textContent('#promoModal .promo-note')) === NOTE, 'two offers + website-promotion note');
  const cclBadge = await page.$eval('[data-promo="ccl-2026-10-17"] .promo-badge', e => e.textContent);
  const cclSave = await page.$eval('[data-promo="ccl-2026-10-17"] .promo-save', e => e.textContent);
  ok(cclBadge === 'SPECIAL PROMO' && /Sat, Oct 17 & Sun, Oct 18 · 10:00 AM/.test(cards[0].text), 'CCL: SPECIAL PROMO, Oct 17 & 18, 10:00 AM');
  ok(cards[0].s === '$175' && cards[0].price === '$160' && cclSave === 'SAVE $15' && /RESERVE FOR \$160 →/.test(cards[0].text) && !/\$200|\$40|%/.test(cards[0].text), 'CCL: $175 → $160, SAVE $15, no $200/$40/%');
  ok(cards[1].s === '$125' && cards[1].price === '$100' && /SAVE \$25 · 20% OFF/.test(cards[1].text) && /RESERVE FOR \$100 →/.test(cards[1].text), "Women's: $125 → $100, SAVE $25 · 20% OFF");
  ok((await page.textContent('#promoTitle')) === 'Special class offers', 'headline makes no percentage claim with CCL shown');
  ok(!FEE.test(await page.evaluate(() => document.body.innerText)), 'homepage + popup: no processing-fee wording');
  ok(cards[0].href === '/reserve?promo=ccl-2026-10-17&utm_source=google&utm_medium=cpc&utm_campaign=fall_promo&utm_term=ccl+class&gclid=Cj0KCQ-test_123', 'CCL card links to its reserve page with ad parameters');

  await page.click('#promoModal a.promo-card[data-promo="ccl-2026-10-17"] .promo-when');
  await page.waitForURL(/\/reserve\?promo=ccl-2026-10-17/);
  const sum = (await page.$eval('#promoSummary', e => e.innerText)).replace(/\s+/g, ' ');
  ok(/Regular price \$175/.test(sum) && /Promotional price \$160/.test(sum) && sum.includes('You save $15. Discount already applied — no coupon code needed.') && !/\$200|\$40|%/.test(sum), 'CCL reserve page wording');
  ok((await page.$$('.ack-check')).length === 7 && await page.isDisabled('#continueBtn'), 'CCL: 7 acknowledgments, Continue locked until checked');
  await checkAll(page); await page.click('#continueBtn'); await page.waitForTimeout(800);
  const u1 = new URL(state.stripe.pop() || 'https://x/');
  ok(u1.origin + u1.pathname === CCL_LINK, 'Continue → CCL promo checkout ' + CCL_LINK);
  ok(u1.searchParams.get('utm_source') === 'google' && u1.searchParams.get('utm_campaign') === 'fall_promo' && u1.searchParams.get('client_reference_id') === 'ccl-2026-10-17__gclid_Cj0KCQ-test_123', 'utm_* and click reference passed to Stripe');

  await page.goto(BASE + '/');
  ok(!(await popupShown(page)) && await pillVisible(page) && (await page.textContent('#promoPill')) === PILL, 'same session: no automatic popup, October Special button shown');
  await page.goto(BASE + '/reserve?promo=womens-2026-10-24');
  const wsum = (await page.textContent('#promoSummary')).replace(/\s+/g, ' ');
  ok((await page.$$('.ack-check')).length === 3 && /Promotional price \$100/.test(wsum) && wsum.includes('You save $25 (20% off)'), "Women's reserve page: 3 acknowledgments, $100, 20% off");
  await checkAll(page); await page.click('#continueBtn'); await page.waitForTimeout(800);
  const u2 = new URL(state.stripe.pop() || 'https://x/');
  ok(u2.origin + u2.pathname === WOMENS_LINK && u2.searchParams.get('client_reference_id') === 'womens-2026-10-24__gclid_Cj0KCQ-test_123', "Women's → its checkout, keeping this visit's attribution");
  await page.goto(BASE + '/reserve?promo=ccl-2026-10-17&to=' + encodeURIComponent('https://buy.stripe.com/SOMETHING_ELSE'));
  await checkAll(page); await page.click('#continueBtn'); await page.waitForTimeout(800);
  const u3 = new URL(state.stripe.pop() || 'https://x/');
  ok(u3.origin + u3.pathname === CCL_LINK, 'promo ignores to= in the URL');
  await page.goto(BASE + '/reserve?promo=bogus');
  ok(/no longer available/.test(await page.textContent('#errorFlow')), 'unknown promo refused');
  ok(state.errors.length === 0, 'no JavaScript errors ' + state.errors.join(' | '));
  await ctx.close();

  console.log('Regular visitor, reopen button, schedule');
  for (const [name, viewport] of [['phone', { width: 400, height: 860 }], ['desktop', { width: 1280, height: 900 }]]) {
    ({ ctx, page, state } = await ctxWith({ viewport }));
    await page.goto(BASE + '/');
    await page.waitForFunction(() => { const g = document.getElementById('upcomingGrid'); return g && !/Loading/i.test(g.textContent) && g.children.length; }, null, { timeout: 15000 }).catch(() => {});
    const gridBefore = await page.$eval('#upcomingGrid', e => e.innerHTML);
    ok(await popupShown(page), name + ': popup shows without ad parameters');
    await page.click('.promo-close'); await page.waitForTimeout(400);
    const a = await page.$eval('#promoPill', e => e.getBoundingClientRect().toJSON());
    const b = await page.$eval('#floatBtn', e => e.getBoundingClientRect().toJSON());
    const overlap = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    ok(!overlap && a.bottom <= viewport.height, name + ': reopen button on screen, not covering Reserve');
    await page.click('#promoPill');
    ok(await popupShown(page) && (await page.$$('#promoModal a.promo-card')).length === 2, name + ': button reopens the popup');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await page.reload();
    ok(!(await popupShown(page)) && await pillVisible(page), name + ': reload → no automatic popup');
    ok((await page.$eval('#upcomingGrid', e => e.innerHTML)) === gridBefore, name + ': Upcoming Classes schedule unchanged by the promotion');
    await ctx.close();
  }
  ({ ctx, page, state } = await ctxWith());
  await page.goto(BASE + '/');
  await popupShown(page);
  await page.click('[data-promo="womens-2026-10-24"] .promo-price');
  await page.waitForURL(/\/reserve\?promo=womens-2026-10-24/);
  await checkAll(page); await page.click('#continueBtn'); await page.waitForTimeout(800);
  const u4 = new URL(state.stripe.pop() || 'https://x/');
  ok(u4.origin + u4.pathname === WOMENS_LINK && ![...u4.searchParams.keys()].some(k => k.startsWith('utm_')) && u4.searchParams.get('client_reference_id') === 'womens-2026-10-24', 'non-ad visitor: clean checkout link');
  await ctx.close();

  console.log('When the popup must not appear');
  ({ ctx, page, state } = await ctxWith({ links: false }));
  await page.goto(BASE + '/' + AD);
  ok(!(await popupShown(page)) && !(await page.$('#promoPill')), 'no popup/button without checkout links');
  await ctx.close();
  ({ ctx, page, state } = await ctxWith({ at: '2026-10-17T09:00:00-05:00' }));
  await page.goto(BASE + '/');
  ok(await popupShown(page) && (await page.$$('#promoModal a.promo-card')).length === 1 && (await page.textContent('#promoTitle')) === 'Save 20% on upcoming classes', "Oct 17: only the Women's offer, headline may say 20%");
  await ctx.close();
  ({ ctx, page, state } = await ctxWith({ at: '2026-10-24T08:00:00-05:00' }));
  await page.goto(BASE + '/');
  ok(!(await popupShown(page)) && !(await page.$('#promoPill')), 'after both offers end: nothing shown');
  await ctx.close();

  console.log('Regular reservation link unchanged');
  ({ ctx, page, state } = await ctxWith());
  const REG = 'https://buy.stripe.com/14A5kDf6g3MXdJ28llak000';
  await page.goto(BASE + '/reserve?c=ccl16&to=' + encodeURIComponent(REG));
  ok(!(await page.isVisible('#promoSummary')) && (await page.textContent('#continueBtn')).trim() === 'Continue to Secure Payment →', 'no promo box; normal button');
  await checkAll(page); await page.click('#continueBtn'); await page.waitForTimeout(800);
  ok(state.stripe.pop() === REG, 'regular link → regular $175 checkout');
  await page.goto(BASE + '/reserve?c=ccl16&to=' + encodeURIComponent('https://evil.example/pay'));
  ok(/isn't valid/.test(await page.textContent('#errorFlow')), 'non-Stripe destinations refused');
  ok(state.errors.length === 0, 'no JavaScript errors');
  await ctx.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PROMO CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
