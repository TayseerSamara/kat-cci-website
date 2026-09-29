// Regular online booking: homepage class card → /reserve?class=<id> → acknowledgments → regular Stripe checkout.
// Real homepage schedule is used where it has classes; stand-in class records (TEST*) cover the rest.
// Stripe navigation is intercepted: no checkout page is loaded and nothing is paid.
const { chromium } = require('playwright-core');

const BASE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINK = {   // approved regular Stripe checkouts (must match booking.js and the staff page)
  ccl: 'https://buy.stripe.com/14A5kDf6g3MXdJ28llak000',
  renewal: 'https://buy.stripe.com/6oU7sLgakcjt34ocBBak002',
  womens: 'https://buy.stripe.com/eVqdR92ju6Z934odFFak001'
};
const PROMO_LINKS = ['https://buy.stripe.com/bJe28rcY86Z9cEYeJJak005', 'https://buy.stripe.com/4gM5kD6zK4R15cwbxxak006'];
const AD = '?utm_source=google&utm_medium=cpc&utm_campaign=fall_classes&gclid=Cj0-booking_test';
let fails = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };

const iso = n => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dayName = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); };
const doc = f => ({ name: 'x', fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }])) });
const STANDINS = {
  TESTccl: { type: 'ccl', date1: iso(12), date2: iso(13), endDate: iso(13), time: '09:30', price: 175 },
  TESTrenewal: { type: 'renewal', date1: iso(15), date2: '', endDate: iso(15), time: '18:00', price: 125 },
  TESTwomens: { type: 'womens', date1: iso(18), date2: '', endDate: iso(18), time: '12:00', price: 125 },
  TESTmismatch: { type: 'ccl', date1: iso(20), date2: iso(21), endDate: iso(21), time: '10:00', price: 185 },
  TESTpast: { type: 'ccl', date1: iso(-10), date2: iso(-9), endDate: iso(-9), time: '10:00', price: 175 },
  TESTprivate: { type: 'private', date1: iso(8), date2: '', endDate: iso(8), time: '10:00', price: 250 }
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  async function ctxWith(viewport = { width: 400, height: 860 }) {
    const ctx = await browser.newContext({ viewport });
    const state = { stripe: [], errors: [] };
    await ctx.addInitScript(() => { try { sessionStorage.setItem('katcci_promo_seen', '1'); } catch (e) {} });   // keep the promo popup out of the way
    await ctx.route(/Firestore\/Write|formspree\.io/, r => r.abort());
    await ctx.route(/firestore\.googleapis\.com\/v1\/projects\/katcci\/databases\/\(default\)\/documents\/classes\/TEST/, r => {
      const id = new URL(r.request().url()).pathname.split('/').pop();
      STANDINS[id] ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc(STANDINS[id])) }) : r.fulfill({ status: 404, body: '{}' });
    });
    await ctx.route(/^https:\/\/(buy|checkout)\.stripe\.com\//, r => { state.stripe.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe stand-in</title>' }); });
    const page = await ctx.newPage();
    page.on('pageerror', e => state.errors.push(e.message));
    return { ctx, page, state };
  }
  const summary = async page => { await page.waitForSelector('#promoSummary:not([style*="none"]), #errorFlow:not([style*="none"])', { timeout: 15000 }); return (await page.$eval('#promoSummary', e => e.innerText)).replace(/\s+/g, ' '); };
  const pay = async (page, state) => {
    ok(await page.isDisabled('#continueBtn'), '  payment button unavailable before acknowledgments');
    const checks = await page.$$('.ack-check');
    for (const c of checks.slice(0, -1)) await c.check();
    ok(await page.isDisabled('#continueBtn'), '  still unavailable with one acknowledgment unchecked');
    await checks[checks.length - 1].check();
    ok(!(await page.isDisabled('#continueBtn')), '  available once all are checked');
    await page.click('#continueBtn'); await page.waitForTimeout(800);
    return new URL(state.stripe.pop() || 'https://x/');
  };
  const ackText = page => page.$eval('#ackList', e => e.innerText);

  // ── Homepage (real schedule) ──
  console.log('Homepage class cards (real schedule)');
  let { ctx, page, state } = await ctxWith();
  await page.goto(BASE + '/' + AD);
  await page.waitForFunction(() => document.querySelectorAll('#upcomingGrid .uc-card[data-dynamic]').length > 0, null, { timeout: 20000 });
  const cards = await page.$$eval('#upcomingGrid .uc-card[data-dynamic]', els => els.map(e => ({ text: e.innerText.replace(/\s+/g, ' '), link: e.querySelector('a.btn-reserve') && e.querySelector('a.btn-reserve').getAttribute('href'), textBtn: !!e.querySelector('button[data-sms]') })));
  const cclCard = cards.find(c => /Oct 17/.test(c.text)), womCard = cards.find(c => /Oct 24/.test(c.text));
  ok(cclCard && cclCard.link && /Reserve Your Spot/.test(cclCard.text) && !cclCard.textBtn, 'CCL Oct 17–18 card: "Reserve Your Spot" (no Text to Reserve)');
  ok(womCard && womCard.link && /Reserve Your Spot/.test(womCard.text) && !womCard.textBtn, "Women's Oct 24 card: \"Reserve Your Spot\"");
  ok(/^\/reserve\?class=[A-Za-z0-9]+&utm_source=google&utm_medium=cpc&utm_campaign=fall_classes&gclid=Cj0-booking_test$/.test(cclCard.link), 'card links to /reserve for that exact class, carrying ad parameters: ' + cclCard.link);
  ok(!/price|to=|stripe/i.test(cclCard.link + womCard.link), 'card links carry no price or Stripe destination');
  const privText = await page.$eval('#ucPrivate', e => e.innerText.replace(/\s+/g, ' '));
  ok(/From \$250/.test(privText) && !(await page.$('#ucPrivate a.btn-reserve')), 'Private card unchanged (From $250, contact to reserve)');
  const cclId = new URLSearchParams(cclCard.link.split('?')[1]).get('class');

  // CCL: card → reserve → $175 checkout
  console.log('Scheduled CCL → reserve → regular $175 checkout');
  await page.click(`a.btn-reserve[href^="/reserve?class=${cclId}"]`);
  await page.waitForURL(/\/reserve\?class=/);
  let sum = await summary(page);
  ok(/16-Hour CCL Certification/.test(await page.textContent('#heading')) && /16-Hour CCL Certification/.test(sum), 'class name shown');
  ok(sum.includes('Saturday, Oct 17 & Sunday, Oct 18 · 10:00 AM'), 'actual scheduled dates + start time: Saturday, Oct 17 & Sunday, Oct 18 · 10:00 AM');
  ok(/Price \$175/.test(sum) && !/\$160|SAVE|%|coupon/i.test(sum), 'regular price $175 (no promo wording)');
  ok(/\$150 Illinois state fee/.test(sum) && /\$23 lane fee \+ \$6 range waiver/.test(sum) && /rental with ammo: \$25/.test(sum), 'state fee, range fees and rental info shown');
  ok((await page.$$('.ack-check')).length === 7 && /21 years old/.test(await ackText(page)) && /second day/.test(await ackText(page)), 'CCL acknowledgments (7, incl. age, range, Day 2 transport)');
  ok(/Continue to Secure Payment · \$175/.test(await page.textContent('#continueBtn')), 'button reads "Continue to Secure Payment · $175"');
  let u = await pay(page, state);
  ok(u.origin + u.pathname === LINK.ccl, 'Continue → regular CCL $175 checkout ' + LINK.ccl);
  ok(u.searchParams.get('utm_source') === 'google' && u.searchParams.get('utm_campaign') === 'fall_classes' && u.searchParams.get('client_reference_id') === 'class-' + cclId + '__gclid_Cj0-booking_test', 'utm_* and click reference carried to Stripe');

  // Women's: card → reserve → $125 checkout
  console.log("Scheduled Women's → reserve → regular $125 checkout");
  await page.goto(BASE + '/');
  await page.waitForSelector('a.btn-reserve');
  const womLink = await page.$$eval('#upcomingGrid .uc-card[data-dynamic]', els => { const c = els.find(e => /Oct 24/.test(e.innerText)); return c && c.querySelector('a.btn-reserve').getAttribute('href'); });
  await page.click(`a.btn-reserve[href="${womLink}"]`);
  await page.waitForURL(/\/reserve\?class=/);
  sum = await summary(page);
  ok(/Women's Class/.test(sum) && sum.includes('Saturday, Oct 24 · 12:00 PM') && /Price \$125/.test(sum), "Women's: name, Saturday, Oct 24 · 12:00 PM, $125");
  ok((await page.$$('.ack-check')).length === 3 && !/second day|Eagle Sports Range|21 years old/.test(await ackText(page)), "Women's acknowledgments (3), no Day 2 / range items");
  u = await pay(page, state);
  ok(u.origin + u.pathname === LINK.womens && u.searchParams.get('utm_campaign') === 'fall_classes', "Continue → regular Women's $125 checkout, attribution kept from this visit");
  ok(state.errors.length === 0, 'no JavaScript errors ' + state.errors.join(' | '));
  await ctx.close();

  // Renewal (stand-in record — no renewal on the real schedule right now)
  console.log('Renewal → reserve → regular checkout');
  ({ ctx, page, state } = await ctxWith());
  await page.goto(BASE + '/reserve?class=TESTrenewal');
  sum = await summary(page);
  ok(/3-Hour CCL Renewal/.test(sum) && sum.includes(dayName(iso(15)) + ' · 6:00 PM') && /Price \$125/.test(sum) && /state renewal fee/.test(sum), 'Renewal: name, date · 6:00 PM, $125, state renewal fee');
  ok((await page.$$('.ack-check')).length === 3 && !/second day/.test(await ackText(page)), 'Renewal acknowledgments (3), no Day 2 items');
  u = await pay(page, state);
  ok(u.origin + u.pathname === LINK.renewal && u.searchParams.get('client_reference_id') === 'class-TESTrenewal', 'Continue → regular Renewal checkout ' + LINK.renewal);
  await page.goto(BASE + '/reserve?class=TESTccl');
  sum = await summary(page);
  ok(sum.includes(dayName(iso(12)) + ' & ' + dayName(iso(13)) + ' · 9:30 AM'), 'CCL date range + time come from the class record');

  // Tampering
  console.log('URL tampering');
  await page.goto(BASE + '/reserve?class=TESTccl&to=' + encodeURIComponent('https://buy.stripe.com/EVIL') + '&c=womens&price=1&type=womens');
  sum = await summary(page);
  ok(/Price \$175/.test(sum) && (await page.$$('.ack-check')).length === 7, 'to=/c=/price=/type= in the URL change nothing on the page');
  u = await pay(page, state);
  ok(u.origin + u.pathname === LINK.ccl, 'checkout still the regular CCL link (Stripe destination not changeable)');
  for (const [id, why] of [['TESTmismatch', 'listed price differs from the approved checkout price'], ['TESTpast', 'class already over'], ['TESTprivate', 'class type has no approved online checkout'], ['TESTnope', 'unknown class'], ['..%2Fetc', 'malformed id']]) {
    await page.goto(BASE + '/reserve?class=' + id);
    await page.waitForSelector('#errorFlow:not([style*="none"])', { timeout: 15000 }).catch(() => {});
    ok(/isn't available for online booking/.test(await page.textContent('#errorFlow')) && !(await page.isVisible('#ackFlow')), 'refused: ' + why);
  }
  ok(!state.stripe.some(x => PROMO_LINKS.some(p => x.startsWith(p))), 'regular flow never used a promotional checkout link');
  ok(state.errors.length === 0, 'no JavaScript errors ' + state.errors.join(' | '));
  await ctx.close();

  // Desktop layout sanity
  ({ ctx, page, state } = await ctxWith({ width: 1280, height: 900 }));
  await page.goto(BASE + '/');
  await page.waitForSelector('a.btn-reserve', { timeout: 20000 });
  const box = await page.$eval('a.btn-reserve', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, deco: getComputedStyle(e).textDecorationLine }; });
  ok(box.w > 100 && box.h > 30 && box.deco === 'none', 'desktop: Reserve Your Spot renders as a full button');
  await ctx.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL BOOKING CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
