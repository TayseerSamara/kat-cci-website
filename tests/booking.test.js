// Regular online booking: homepage class card → /reserve?class=<id> → acknowledgments → regular Stripe checkout.
// The real homepage schedule is used where it has classes (whatever is scheduled right now); stand-in
// class records (TEST*) cover exact values. settings/publicPricing is always a stand-in here.
// Stripe navigation is intercepted: no checkout page is loaded and nothing is paid.
const { chromium } = require('playwright-core');
const { stubGoogle, fillContact } = require('./google-stub');

const BASE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINK = {   // approved regular Stripe checkouts (must match booking.js and the staff page)
  ccl: 'https://buy.stripe.com/4gM7sLaQ0cjt0Wg9ppak007',       // $200
  renewal: 'https://buy.stripe.com/bJeeVde2c1EP5cw9ppak009'    // $140
};
// Replaced / retired links: the site must never send a customer to these any more.
const OLD_LINKS = ['https://buy.stripe.com/14A5kDf6g3MXdJ28llak000', 'https://buy.stripe.com/6oU7sLgakcjt34ocBBak002',
                   'https://buy.stripe.com/eVqdR92ju6Z934odFFak001', 'https://buy.stripe.com/4gM5kD6zK4R15cwbxxak006'];
const PROMO_LINKS = ['https://buy.stripe.com/bJe28rcY86Z9cEYeJJak005'];
const AD = '?utm_source=google&utm_medium=cpc&utm_campaign=fall_classes&gclid=Cj0-booking_test';
let fails = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };

const iso = n => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dayName = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); };
const doc = f => ({ name: 'x', fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === null ? { nullValue: null } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { stringValue: v }])) });
// settings/publicPricing stand-in. PUB.current = what the site reads; null → HTTP 500.
const PUB_MATCHED = { privateFrom: 250, ccl16: 200, renewal3: 140 };
const PUB = { current: PUB_MATCHED };
const STANDINS = {
  TESTccl: { type: 'ccl', date1: iso(12), date2: iso(13), endDate: iso(13), time: '09:30', price: 175 },
  TESTrenewal: { type: 'renewal', date1: iso(15), date2: '', endDate: iso(15), time: '18:00', price: 125 },
  TESTwomens: { type: 'womens', date1: iso(18), date2: '', endDate: iso(18), time: '12:00', price: 125 },   // legacy Women's record
  TESTwomensnp: { type: 'womens', date1: iso(22), date2: '', endDate: iso(22), time: '12:00' },          // legacy, no price
  TESTold: { type: 'ccl', date1: iso(20), date2: iso(21), endDate: iso(21), time: '10:00', price: 150 },   // stale legacy price
  TESTpast: { type: 'ccl', date1: iso(-10), date2: iso(-9), endDate: iso(-9), time: '10:00', price: 175 },
  TESTprivate: { type: 'private', date1: iso(8), date2: '', endDate: iso(8), time: '10:00', price: 250 }
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  async function ctxWith(viewport = { width: 400, height: 860 }) {
    const ctx = await browser.newContext({ viewport });
    await stubGoogle(ctx);
    const state = { stripe: [], errors: [] };
    await ctx.addInitScript(() => { try { sessionStorage.setItem('katcci_promo_seen', '1'); } catch (e) {} });   // keep the promo popup out of the way
    await ctx.route(/Firestore\/Write|formspree\.io/, r => r.abort());
    await ctx.route(/firestore\.googleapis\.com\/v1\/projects\/katcci\/databases\/\(default\)\/documents\/classes\/TEST/, r => {
      const id = new URL(r.request().url()).pathname.split('/').pop();
      STANDINS[id] ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc(STANDINS[id])) }) : r.fulfill({ status: 404, body: '{}' });
    });
    await ctx.route(/firestore\.googleapis\.com\/v1\/projects\/katcci\/databases\/\(default\)\/documents\/settings\/publicPricing/, r =>
      PUB.current ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc(PUB.current)) }) : r.fulfill({ status: 500, body: '{}' }));
    await ctx.route(/^https:\/\/(buy|checkout)\.stripe\.com\//, r => { state.stripe.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe stand-in</title>' }); });
    const page = await ctx.newPage();
    page.on('pageerror', e => state.errors.push(e.message));
    return { ctx, page, state };
  }
  const summary = async page => { await page.waitForSelector('#promoSummary:not([style*="none"]), #errorFlow:not([style*="none"])', { timeout: 15000 }); return (await page.$eval('#promoSummary', e => e.innerText)).replace(/\s+/g, ' '); };
  const refused = async page => {
    await page.waitForSelector('#errorFlow:not([style*="none"])', { timeout: 15000 }).catch(() => {});
    return /isn't available for online booking/.test(await page.textContent('#errorFlow')) && !(await page.isVisible('#ackFlow'));
  };
  const pay = async (page, state) => {
    await fillContact(page);
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
  const homeCards = async (page, path = '/') => {
    await page.goto(BASE + path);
    await page.waitForFunction(() => document.querySelectorAll('#upcomingGrid .uc-card[data-dynamic], #upcomingGrid .uc-empty').length > 0, null, { timeout: 20000 });
    return page.$$eval('#upcomingGrid .uc-card[data-dynamic]', els => els.map(e => ({ text: e.innerText.replace(/\s+/g, ' '), tag: e.querySelector('.uc-tag').textContent, title: e.querySelector('.uc-title').textContent, price: e.querySelector('.uc-price') ? e.querySelector('.uc-price').textContent : '', link: e.querySelector('a.btn-reserve') && e.querySelector('a.btn-reserve').getAttribute('href'), textBtn: !!e.querySelector('button[data-sms]') })));
  };
  const WANT = { 'CCL Certification': '$200', Renewal: '$140' };

  // ── Homepage (real schedule, stand-in public pricing CCL $200 / Renewal $140) ──
  console.log('Homepage class cards (real schedule)');
  let { ctx, page, state } = await ctxWith();
  let cards = await homeCards(page, '/' + AD);
  ok(cards.every(c => !/Women/i.test(c.text)), "no Women's Class card on the homepage (" + cards.length + ' class cards)');
  ok(!(await page.$('#leadClass option:not([value=""])')) || !(await page.$$eval('#leadClass option', os => os.some(o => /Women/i.test(o.textContent)))), "lead form: no Women's Class choice");
  ok(cards.every(c => WANT[c.tag] && c.price === WANT[c.tag] && c.link && /Reserve Your Spot/.test(c.text) && !c.textBtn),
     'every card shows its central price and "Reserve Your Spot": ' + cards.map(c => c.tag + ' ' + c.price).join(', '));
  ok(cards.every(c => /^\/reserve\?class=[A-Za-z0-9]+&utm_source=google&utm_medium=cpc&utm_campaign=fall_classes&gclid=Cj0-booking_test$/.test(c.link)), 'card links go to /reserve for that exact class, carrying ad parameters');
  ok(cards.every(c => !/price|to=|stripe/i.test(c.link)), 'card links carry no price or Stripe destination');
  const privText = await page.$eval('#ucPrivate', e => e.innerText.replace(/\s+/g, ' '));
  ok(/From \$250/.test(privText) && !(await page.$('#ucPrivate a.btn-reserve')), 'Private card stays contact-to-reserve, "From $250"');
  ok(!/Women/i.test(privText), 'Private card: no women-only class bullet');

  // First real CCL card (if any) → reserve → $200 checkout
  const realCcl = cards.find(c => c.tag === 'CCL Certification');
  if (realCcl) {
    console.log('Real scheduled CCL → reserve → regular $200 checkout');
    const id = new URLSearchParams(realCcl.link.split('?')[1]).get('class');
    await page.click(`a.btn-reserve[href^="/reserve?class=${id}"]`);
    await page.waitForURL(/\/reserve\?class=/);
    const sum = await summary(page);
    ok(/16-Hour CCL Certification/.test(sum) && /Price \$200/.test(sum) && !/\$160|\$175|SAVE|%|coupon/i.test(sum), 'class name + regular price $200 (no promo / old price)');
    const u = await pay(page, state);
    ok(u.origin + u.pathname === LINK.ccl, 'Continue → new CCL $200 checkout ' + LINK.ccl);
    ok(u.searchParams.get('utm_source') === 'google' && u.searchParams.get('client_reference_id') === 'class-' + id + '__gclid_Cj0-booking_test', 'utm_* and click reference carried to Stripe');
  } else console.log('  (no CCL class on the real schedule right now — covered by stand-ins below)');
  ok(state.errors.length === 0, 'no JavaScript errors ' + state.errors.join(' | '));
  await ctx.close();

  console.log('CCL (stand-in) → reserve → regular $200 checkout');
  ({ ctx, page, state } = await ctxWith());
  await page.goto(BASE + '/reserve?class=TESTccl' + AD.replace('?', '&'));
  let sum = await summary(page);
  ok(/16-Hour CCL Certification/.test(await page.textContent('#heading')) && sum.includes(dayName(iso(12)) + ' & ' + dayName(iso(13)) + ' · 9:30 AM'), 'class name, both dates and start time from the class record');
  ok(/Price \$200/.test(sum) && !/Price \$175/.test(sum), 'central $200 (record still says $175)');
  ok(/\$150 Illinois state fee/.test(sum) && /\$23 lane fee \+ \$6 range waiver/.test(sum) && /rental with ammo: \$25/.test(sum), 'state fee, range fees and rental info shown');
  ok((await page.$$('.ack-check')).length === 7 && /21 years old/.test(await ackText(page)) && /second day/.test(await ackText(page)), 'CCL acknowledgments (7, incl. age, range, Day 2 transport)');
  ok(/Continue to Secure Payment · \$200/.test(await page.textContent('#continueBtn')), 'button reads "Continue to Secure Payment · $200"');
  let u = await pay(page, state);
  ok(u.origin + u.pathname === LINK.ccl && u.searchParams.get('client_reference_id') === 'class-TESTccl__gclid_Cj0-booking_test', 'Continue → new CCL checkout ' + LINK.ccl);

  console.log('Renewal → reserve → regular $140 checkout');
  await page.goto(BASE + '/reserve?class=TESTrenewal');
  sum = await summary(page);
  ok(/3-Hour CCL Renewal/.test(sum) && sum.includes(dayName(iso(15)) + ' · 6:00 PM') && /Price \$140/.test(sum) && /state renewal fee/.test(sum), 'Renewal: name, date · 6:00 PM, $140, state renewal fee');
  ok((await page.$$('.ack-check')).length === 3 && !/second day/.test(await ackText(page)), 'Renewal acknowledgments (3), no Day 2 items');
  u = await pay(page, state);
  ok(u.origin + u.pathname === LINK.renewal && u.searchParams.get('client_reference_id') === 'class-TESTrenewal__gclid_Cj0-booking_test', 'Continue → new Renewal checkout ' + LINK.renewal + ' (keeps this visit\'s attribution)');

  console.log("Women's Class is retired");
  for (const [id, why] of [['TESTwomens', "upcoming Women's record ($125)"], ['TESTwomensnp', "upcoming Women's record (no price)"]]) {
    await page.goto(BASE + '/reserve?class=' + id);
    ok(await refused(page), 'refused: ' + why + ' — no online booking path');
  }
  ok(await page.evaluate(() => window.KAT_BOOKING.isBookable({ type: 'womens', price: 125, date1: '2030-01-01' }, { ccl16: 200, renewal3: 140, womens: 125, privateFrom: 250 })) === false &&
     await page.evaluate(() => window.KAT_BOOKING.bookablePrice('womens', { womens: 125 })) === null &&
     await page.evaluate(() => !('womens' in window.KAT_BOOKING.regularCheckouts())),
     "booking.js: no Women's checkout, even if a womens price were ever published");

  // Tampering
  console.log('URL tampering');
  await page.goto(BASE + '/reserve?class=TESTccl&to=' + encodeURIComponent('https://buy.stripe.com/EVIL') + '&c=womens&price=1&value=1&type=womens');
  sum = await summary(page);
  ok(/Price \$200/.test(sum) && (await page.$$('.ack-check')).length === 7, 'to=/c=/price=/value=/type= in the URL change nothing on the page');
  u = await pay(page, state);
  ok(u.origin + u.pathname === LINK.ccl, 'checkout still the regular CCL link (Stripe destination not changeable)');
  for (const [id, why] of [['TESTpast', 'class already over'], ['TESTprivate', 'class type has no approved online checkout'], ['TESTnope', 'unknown class'], ['..%2Fetc', 'malformed id']]) {
    await page.goto(BASE + '/reserve?class=' + id);
    ok(await refused(page), 'refused: ' + why);
  }
  ok(!state.stripe.some(x => PROMO_LINKS.concat(OLD_LINKS).some(p => x.startsWith(p))), 'regular flow never used a promotional or old/retired checkout link');
  ok(state.errors.length === 0, 'no JavaScript errors ' + state.errors.join(' | '));
  await ctx.close();

  // Website price ≠ confirmed Stripe amount → public price null → online booking paused
  console.log('Price mismatch pauses online booking');
  PUB.current = { ...PUB_MATCHED, ccl16: null };
  ({ ctx, page, state } = await ctxWith());
  cards = await homeCards(page);
  ok(cards.filter(c => c.tag === 'CCL Certification').every(c => !c.link && c.textBtn && c.price === ''), 'CCL cards: "Text to Reserve", no price shown while CCL is paused');
  ok(cards.filter(c => c.tag === 'Renewal').every(c => c.link && c.price === '$140'), 'Renewal cards (still matched) keep "Reserve Your Spot" at $140');
  for (const id of ['TESTccl', 'TESTold']) {
    await page.goto(BASE + '/reserve?class=' + id);
    ok(await refused(page), `/reserve refuses ${id} while CCL is paused (no checkout)`);
  }
  ok(!state.stripe.length, 'no Stripe checkout opened while paused');
  await page.goto(BASE + '/reserve?class=TESTrenewal');
  ok(/Price \$140/.test(await summary(page)), 'Renewal unaffected ($140)');
  await ctx.close();

  // The production state today (before the new values are saved): both regular prices null.
  console.log('Both regular prices unpublished (current production state)');
  PUB.current = { privateFrom: 250, ccl16: null, renewal3: null };
  ({ ctx, page, state } = await ctxWith());
  cards = await homeCards(page);
  ok(cards.every(c => !c.link && c.textBtn && c.price === ''), 'every class card: "Text to Reserve", no price');
  await ctx.close();

  // Old production document still holding a womens field: ignored.
  console.log('Obsolete womens field in settings/publicPricing is ignored');
  PUB.current = { ...PUB_MATCHED, womens: 125 };
  ({ ctx, page, state } = await ctxWith());
  await page.goto(BASE + '/reserve?class=TESTwomens');
  ok(await refused(page), "Women's record still refused when the public document has womens: 125");
  ok(!('womens' in (await page.evaluate(() => window.KAT_BOOKING.loadPublicPricing()))), 'booking.js does not even read the womens field');
  await ctx.close();

  // New confirmed prices → every upcoming class follows (no class record edited).
  console.log('New confirmed prices (CCL $215, Renewal $150) apply to every upcoming class');
  PUB.current = { ...PUB_MATCHED, ccl16: 215, renewal3: 150 };
  ({ ctx, page, state } = await ctxWith());
  cards = await homeCards(page);
  const want2 = { 'CCL Certification': '$215', Renewal: '$150' };
  ok(cards.every(c => c.link && c.price === want2[c.tag]), 'every card shows the new central price: ' + cards.map(c => c.tag + ' ' + c.price).join(', '));
  for (const [id, price, link] of [['TESTccl', 215, LINK.ccl], ['TESTold', 215, LINK.ccl], ['TESTrenewal', 150, LINK.renewal]]) {
    await page.goto(BASE + '/reserve?class=' + id);
    sum = await summary(page);
    ok(new RegExp('Price \\$' + price + '\\b').test(sum) && new RegExp('Continue to Secure Payment · \\$' + price + '\\b').test(await page.textContent('#continueBtn')), `${id} (record $${STANDINS[id].price}) shows and books at $${price}`);
    u = await pay(page, state);
    ok(u.origin + u.pathname === link, `  same fixed trusted Stripe link (${link.slice(-6)})`);
    await page.goto(BASE + '/terms');   // read site storage from a site page, not the Stripe stand-in
    const pend = await page.evaluate(() => JSON.parse(localStorage.getItem('katcci_pending_purchase') || 'null'));
    ok(pend && pend.value === price, `  pending conversion value is the central $${price}`);
  }
  ok(state.errors.length === 0, 'no JavaScript errors ' + state.errors.join(' | '));
  await ctx.close();
  PUB.current = PUB_MATCHED;

  // Public pricing unreadable → no regular online booking (fail closed)
  console.log('Public pricing unavailable');
  PUB.current = null;
  ({ ctx, page, state } = await ctxWith());
  await page.goto(BASE + '/reserve?class=TESTrenewal');
  ok(await refused(page), 'refused when settings/publicPricing cannot be read');
  await ctx.close();
  PUB.current = PUB_MATCHED;

  // Desktop layout sanity (only when the real schedule has a class)
  ({ ctx, page, state } = await ctxWith({ width: 1280, height: 900 }));
  cards = await homeCards(page);
  if (cards.length) {
    const box = await page.$eval('a.btn-reserve', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, deco: getComputedStyle(e).textDecorationLine }; });
    ok(box.w > 100 && box.h > 30 && box.deco === 'none', 'desktop: Reserve Your Spot renders as a full button');
  }
  await ctx.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL BOOKING CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
