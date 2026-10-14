// Staff "💲 Class Pricing" (settings/pricing) — demo mode on /pay, so nothing touches Firebase.
const { chromium } = require('playwright-core');
const { stubGoogle } = require('./google-stub');

const SITE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MISMATCH = '⚠️ Website price and Stripe checkout do not match. Update Stripe, then confirm the new Stripe amount here.';
const MATCH = '✓ Website and Stripe pricing match';
const ACK = amt => `I confirm I have updated and verified this Stripe Payment Link charges ${amt}.`;
const LINKS = { ccl16: 'https://buy.stripe.com/14A5kDf6g3MXdJ28llak000', renewal3: 'https://buy.stripe.com/6oU7sLgakcjt34ocBBak002', womens: 'https://buy.stripe.com/eVqdR92ju6Z934odFFak001' };
const PAY_CCL = amt => `Hi! You're confirmed for the 16-Hour CCL Certification course.

To lock in your seat, review our quick terms and complete payment of ${amt} here:

https://www.katcci.com/reserve?c=ccl16&to=https%3A%2F%2Fbuy.stripe.com%2F14A5kDf6g3MXdJ28llak000

You can pay by card, Apple Pay, or Google Pay. Prefer Zelle or cash? Just reply.

${amt} covers your 16 hours of training. The $150 state fee is paid separately to ISP.

— Kat CCI`;
const FIREBASE_HOSTS = /firestore\.googleapis|identitytoolkit|securetoken|firebaseinstallations|firebaseio/;
let fails = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  async function staffPage(query) {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await stubGoogle(ctx);
    const log = { firebase: 0, errors: [] };
    await ctx.route(FIREBASE_HOSTS, r => { log.firebase++; r.abort(); });
    const page = await ctx.newPage();
    page.on('pageerror', e => log.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') log.errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    await page.goto(SITE + '/pay' + query);
    await page.waitForSelector('text=DEMO MODE', { timeout: 10000 });
    await page.$eval('#signinBtn', e => e.click());
    await page.waitForSelector('#scheduleManager', { state: 'visible' });
    await page.waitForSelector('#cp_ccl16');
    await page.waitForTimeout(400);
    return { ctx, page, log };
  }
  const val = (page, sel) => page.$eval(sel, e => e.value);
  const txt = (page, sel) => page.$eval(sel, e => e.textContent);
  const row = (page, f) => page.$eval(`[data-cp="${f}"]`, e => ({ text: e.innerText.replace(/\s+/g, ' '), warn: !e.querySelector('.cp-warn').hidden, warnText: e.querySelector('.cp-warn').textContent, info: !e.querySelector('.cp-info').hidden, okMark: !e.querySelector('.cp-ok').hidden, okText: e.querySelector('.cp-ok').textContent }));
  const saved = page => page.evaluate(() => { const p = window.__demoDb.settings.get('pricing'); return p ? { ...p, updatedAt: !!p.updatedAt } : null; });
  const pub = page => page.evaluate(() => { const p = window.__demoDb.settings.get('publicPricing'); return p ? { ...p } : null; });
  const classes = page => page.evaluate(() => Object.fromEntries([...window.__demoDb.classes.entries()].map(([k, v]) => [k, v.price])));
  const save = async page => { await page.$eval('#cpSaveBtn', e => e.click()); await page.waitForTimeout(500); return txt(page, '#cpMsg'); };
  const tap = (page, sel) => page.$eval(sel, e => e.click());
  const box = (page, f) => page.$eval('#cpBox_' + f, e => !e.hidden);
  // Confirm a new Stripe amount for one class: Change… → amount → tick.
  async function confirmStripe(page, f, amount, tick = true) {
    if (!(await box(page, f))) await tap(page, `[data-cp-change="${f}"]`);
    await page.fill('#cpS_' + f, amount);
    if (tick) await page.check('#cpAck_' + f);
  }
  // Payment helper (top of /pay): Copy SMS for one regular card.
  async function copySms(page, key) {
    await page.evaluate(() => navigator.clipboard.writeText('(clipboard before)'));
    await tap(page, `.lc[data-key="${key}"] [data-action="copy"]`);
    await page.waitForTimeout(300);
    const missing = await page.$eval(`.lc[data-key="${key}"] .lc-missing`, e => e.classList.contains('show') ? e.textContent : '');
    return { clip: await page.evaluate(() => navigator.clipboard.readText()), missing, header: await txt(page, `.lc[data-key="${key}"] .lc-price`) };
  }
  const classNotes = page => page.$$eval('#classList .cr-meta', els => els.map(e => e.textContent));
  const SAVED_KEYS = 'ccl16,ccl16Stripe,privateFrom,renewal3,renewal3Stripe,updatedAt,updatedBy,womens,womensStripe';

  console.log('Loading current pricing (demo)');
  let { ctx, page, log } = await staffPage('?demo');
  ok(await val(page, '#cp_ccl16') === '175' && await val(page, '#cp_renewal3') === '125' && await val(page, '#cp_womens') === '125' && await val(page, '#cp_privateFrom') === '250', 'shows website prices: CCL $175, Renewal $125, Women\'s $125, Private from $250');
  for (const [f, amt] of [['ccl16', '$175'], ['renewal3', '$125'], ['womens', '$125']]) {
    const r = await row(page, f);
    ok(r.text.includes('Approved Stripe Payment Link (fixed): ' + LINKS[f].replace('https://', '')) && r.text.includes('Confirmed Stripe amount: ' + amt) && r.okMark && r.okText === MATCH && !r.warn,
       `${f}: website price, fixed Stripe link, confirmed Stripe amount ${amt}, "${MATCH}"`);
  }
  const prow = await row(page, 'privateFrom');
  ok(prow.text.includes('buy.stripe.com/eVq3cve2c97hcEY7hhak003') && prow.okMark && !prow.warn, 'Private: staff payment link shown, $250 ✓');
  ok(await page.$$eval('#cpCard input', els => els.every(e => e.type !== 'url' && !/stripe/i.test(e.value))), 'no editable Stripe URL anywhere in Class Pricing');
  ok(await page.$$eval('.lc[data-key="ccl16"] [data-field=link], .lc[data-key="renewal3"] [data-field=link], .lc[data-key="womens"] [data-field=link]', els => els.length === 3 && els.every(e => e.readOnly)), 'payment helper: regular Stripe links read-only');
  ok(/Last saved .* by nora@katcci\.com/.test(await txt(page, '#cpMeta')), 'shows who last saved');
  ok(await val(page, '#fPrice') === '175' && /Matches the current online price \(\$175\)/.test(await txt(page, '#fPriceHint')), 'new-class form defaults to $175 with a ✓ hint');
  let sms = await copySms(page, 'ccl16');
  ok(sms.clip === PAY_CCL('$175') && sms.header === '$175' && !sms.missing, 'Copy SMS (CCL) uses the saved $175');

  console.log('Invalid prices are rejected');
  for (const bad of ['', '-5', '0', '12.345', '1e3', '100000']) {
    await page.fill('#cp_ccl16', bad);
    const msg = await save(page);
    ok(/Not saved/.test(msg) && (await saved(page)).ccl16 === 175 && (await row(page, 'ccl16')).warn, `"${bad}" rejected; nothing saved`);
  }
  await page.fill('#cp_ccl16', '175');
  await page.fill('#cp_privateFrom', '-1');
  ok(/Not saved/.test(await save(page)) && (await pub(page)).privateFrom === 250, 'invalid Private price: neither document written');
  await page.fill('#cp_privateFrom', '250');

  console.log('Website price changed, Stripe not yet → mismatch, booking + Copy SMS paused');
  const classesBefore = await classes(page);
  await page.fill('#cp_ccl16', '185');
  let r = await row(page, 'ccl16');
  ok(r.warn && r.warnText.startsWith(MISMATCH) && /Website \$185; confirmed Stripe amount \$175/.test(r.warnText) && !r.okMark, 'CCL row shows the mismatch warning before saving');
  let msg = await save(page);
  let sv = await saved(page), pb = await pub(page);
  ok(/✓ Pricing saved/.test(msg) && /paused for 16-Hour CCL Certification/.test(msg), 'saves, and says CCL online booking / Copy SMS are paused');
  ok(sv.ccl16 === 185 && sv.ccl16Stripe === 175 && sv.updatedBy === 'tony@katcci.com' && sv.updatedAt, 'settings/pricing: ccl16 185, ccl16Stripe 175 (unchanged), stamped');
  ok(pb.ccl16 === null && pb.renewal3 === 125 && pb.womens === 125 && pb.privateFrom === 250, 'settings/publicPricing: ccl16 null (paused); others unchanged');
  ok((await row(page, 'ccl16')).warnText.startsWith(MISMATCH), 'warning stays after saving');
  sms = await copySms(page, 'ccl16');
  ok(sms.clip === '(clipboard before)' && sms.missing === MISMATCH && sms.header === '—', 'Copy SMS (CCL): nothing copied, link not sent, shows the mismatch warning');
  await tap(page, '.lc[data-key="ccl16"] [data-action="preview"]');
  ok(!(await page.$eval('.lc[data-key="ccl16"] .lc-preview', e => e.classList.contains('show') && /stripe/.test(e.textContent))), 'preview (CCL) also shows no link');
  sms = await copySms(page, 'renewal3');
  ok(/complete payment of \$125 here/.test(sms.clip) && !sms.missing, 'Copy SMS (Renewal) unaffected: $125');
  ok(/Online booking for this class type is paused/.test(await txt(page, '#fPriceHint')), 'new-class form explains CCL online booking is paused');
  ok((await classNotes(page)).some(t => /CCL.*online booking paused/.test(t)), 'class list flags upcoming CCL classes: online booking paused');
  ok(await page.evaluate(() => window.KAT_BOOKING.isBookable({ type: 'ccl', price: 175, date1: '2030-03-07', endDate: '2030-03-08' }, window.KAT_PUBLIC_PRICING)) === false, 'booking.js: a $175 CCL class is not bookable while paused');

  console.log('Confirming the new Stripe amount requires the explicit confirmation');
  await tap(page, '[data-cp-change="ccl16"]');
  ok(await box(page, 'ccl16'), '"Change…" opens the confirmation box');
  await page.fill('#cpS_ccl16', '185');
  ok((await txt(page, '#cpAckText_ccl16')) === ACK('$185'), 'confirmation reads: "' + ACK('$185') + '"');
  msg = await save(page);
  ok(/Not saved/.test(msg) && /tick/.test(msg) && (await saved(page)).ccl16Stripe === 175 && (await pub(page)).ccl16 === null, 'Save without ticking: refused, nothing changed');
  await page.check('#cpAck_ccl16');
  await page.fill('#cpS_ccl16', '186');
  ok(!(await page.isChecked('#cpAck_ccl16')) && (await txt(page, '#cpAckText_ccl16')) === ACK('$186'), 'changing the amount clears the tick (must re-confirm the new amount)');
  ok((await row(page, 'ccl16')).warnText.startsWith(MISMATCH), '$185 website vs $186 Stripe: mismatch shown');
  await page.fill('#cpS_ccl16', '185');
  await page.check('#cpAck_ccl16');
  r = await row(page, 'ccl16');
  ok(r.okMark && r.okText === MATCH && !r.warn, '$185 / $185 + ticked: "' + MATCH + '"');
  msg = await save(page);
  sv = await saved(page); pb = await pub(page);
  ok(/✓ Pricing saved\.$/.test(msg) && sv.ccl16 === 185 && sv.ccl16Stripe === 185 && pb.ccl16 === 185, 'saved: ccl16 185, ccl16Stripe 185 → public ccl16 185');
  ok(Object.keys(sv).sort().join() === SAVED_KEYS && Object.keys(pb).sort().join() === 'ccl16,privateFrom,renewal3,womens', 'documents hold only the agreed fields (no Stripe URLs)');
  ok(!(await box(page, 'ccl16')) && (await row(page, 'ccl16')).text.includes('Confirmed Stripe amount: $185'), 'box closes; row shows Confirmed Stripe amount: $185');
  sms = await copySms(page, 'ccl16');
  ok(sms.clip === PAY_CCL('$185') && sms.header === '$185' && !sms.missing, 'Copy SMS (CCL) resumes with $185 (amount and "$185 covers your 16 hours"), same fixed link');
  ok(await page.evaluate(() => [window.KAT_BOOKING.isBookable({ type: 'ccl', price: 185, date1: '2030-03-07', endDate: '2030-03-08' }, window.KAT_PUBLIC_PRICING),
    window.KAT_BOOKING.isBookable({ type: 'ccl', price: 175, date1: '2030-03-07', endDate: '2030-03-08' }, window.KAT_PUBLIC_PRICING)].join()) === 'true,false', 'booking.js: $185 CCL class bookable online; a $175 class is not');
  ok((await classNotes(page)).some(t => /CCL.*\$175.*not bookable online \(class \$175 ≠ current \$185\)/.test(t)), 'class list flags existing $175 CCL classes (edit their price to resume online booking)');
  ok(JSON.stringify(await classes(page)) === JSON.stringify(classesBefore), 'existing scheduled classes are NOT repriced automatically');

  console.log('Other classes and Private');
  await page.fill('#cp_renewal3', '130.50');
  await confirmStripe(page, 'renewal3', '130.50');
  await page.fill('#cp_womens', '120');                   // Women's: website changed only → paused
  await page.fill('#cp_privateFrom', '275');
  const pr = await row(page, 'privateFrom');
  ok(pr.info && !pr.warn && !pr.text.includes(MISMATCH) && /starting price \(From \$275\) differs from the staff Private payment link \(\$250\)/.test(pr.text), 'Private: informational note only (no strict mismatch)');
  msg = await save(page);
  sv = await saved(page); pb = await pub(page);
  ok(sv.renewal3 === 130.5 && sv.renewal3Stripe === 130.5 && sv.womens === 120 && sv.womensStripe === 125 && sv.privateFrom === 275, 'saved: Renewal 130.5/130.5, Women\'s 120/125, Private 275');
  ok(JSON.stringify(pb) === JSON.stringify({ privateFrom: 275, ccl16: 185, renewal3: 130.5, womens: null }), 'public: { privateFrom 275, ccl16 185, renewal3 130.5, womens null }');
  ok(/paused for Women's Class/.test(msg) && !/Private/.test(msg), 'save message names Women\'s only (never Private)');
  sms = await copySms(page, 'renewal3');
  ok(/complete payment of \$130\.50 here/.test(sms.clip) && sms.header === '$130.50', 'Copy SMS (Renewal): $130.50');
  sms = await copySms(page, 'womens');
  ok(sms.clip === '(clipboard before)' && sms.missing === MISMATCH, "Copy SMS (Women's): blocked with the mismatch warning");
  sms = await copySms(page, 'private');
  ok(/complete payment of \$250 here/.test(sms.clip), 'Copy SMS (Private) unchanged: staff $250 link');

  console.log('New classes use the saved website price');
  await page.selectOption('#fType', 'renewal');
  ok(await val(page, '#fPrice') === '130.5', 'Renewal new class defaults to 130.5');
  await page.selectOption('#fType', 'ccl');
  ok(await val(page, '#fPrice') === '185' && /Matches the current online price \(\$185\)/.test(await txt(page, '#fPriceHint')), 'CCL new class defaults to 185 ✓');
  await page.fill('#fPrice', '175');
  ok(/doesn't match the current online price \(\$185\)/.test(await txt(page, '#fPriceHint')) && /Text to Reserve/.test(await txt(page, '#fPriceHint')), 'a $175 CCL class warns it will show Text to Reserve');
  await page.fill('#fPrice', '185');
  await page.fill('#fDate1', '2030-03-07'); await page.fill('#fDate2', '2030-03-08');
  await page.$eval('#saveBtn', e => e.click());
  await page.waitForFunction(() => /added/.test(document.getElementById('mgrMsg').textContent));
  const after = await classes(page);
  const newIds = Object.keys(after).filter(k => !(k in classesBefore));
  ok(newIds.length === 1 && after[newIds[0]] === 185, 'new class saved at $185');

  console.log('Back to $175 / $125 / $125');
  await page.fill('#cp_ccl16', '175'); await confirmStripe(page, 'ccl16', '175');
  await page.fill('#cp_renewal3', '125'); await confirmStripe(page, 'renewal3', '125');
  await page.fill('#cp_womens', '125');
  ok((await row(page, 'womens')).okText === MATCH, "Women's back to $125 = confirmed $125: ✓ match without re-confirming");
  await tap(page, '[data-cp-change="womens"]');
  await tap(page, '[data-cp-cancel="womens"]');
  ok(!(await box(page, 'womens')), 'Cancel closes the confirmation box');
  await page.fill('#cp_privateFrom', '262.50');
  await save(page);
  ok(JSON.stringify(await pub(page)) === JSON.stringify({ privateFrom: 262.5, ccl16: 175, renewal3: 125, womens: 125 }), 'public pricing back to 175 / 125 / 125, From 262.50');
  ok(log.firebase === 0 && log.errors.length === 0, 'demo: zero Firebase requests, no JavaScript errors ' + log.errors.join(' | '));
  await ctx.close();

  console.log('Finding Class Pricing in demo mode');
  {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 860 } });
    await stubGoogle(c2); await c2.route(FIREBASE_HOSTS, r => r.abort());
    const p2 = await c2.newPage(); const errs = [];
    p2.on('pageerror', e => errs.push(e.message));
    const inView = id => p2.$eval('#' + id, e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < window.innerHeight && r.bottom > 0; });
    await p2.goto(SITE + '/pay?demo');
    await p2.waitForSelector('#demoSignin', { state: 'visible', timeout: 10000 });
    ok(!(await p2.isVisible('#cpCard')) && /Demo sign-in/.test(await p2.textContent('#demoSignin')), 'before sign-in: staff tools hidden; banner offers "Demo sign-in — show staff tools"');
    await p2.click('#demoSignin');
    await p2.waitForSelector('[data-demo-jump="cpCard"]', { state: 'visible' });
    ok(await p2.isVisible('#cpCard') && !(await p2.isVisible('#demoSignin')), 'one tap signs in (demo); Class Pricing is shown');
    await p2.click('[data-demo-jump="cpCard"]'); await p2.waitForTimeout(900);
    ok(await inView('cpCard'), '"💲 Class Pricing" jump link scrolls the card into view');
    ok(errs.length === 0, 'no JavaScript errors ' + errs.join(' | '));
    await c2.close();
    // Fresh tab, opened directly at #pricing (a real page load, not a same-page hash change).
    const c3 = await browser.newContext({ viewport: { width: 390, height: 860 } });
    await stubGoogle(c3); await c3.route(FIREBASE_HOSTS, r => r.abort());
    const p3 = await c3.newPage();
    await p3.goto(SITE + '/pay?demo#pricing');
    await p3.waitForSelector('#cpCard', { state: 'visible', timeout: 10000 }).catch(() => {});
    await p3.waitForTimeout(1200);
    const view3 = await p3.$eval('#cpCard', e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < window.innerHeight && r.bottom > 0; });
    ok(view3 && !(await p3.isVisible('#signinCard')), 'fresh /pay?demo#pricing: signs in (demo) and opens straight to Class Pricing');
    await p3.goto(SITE + '/pay?demo');
    await p3.reload(); await p3.waitForSelector('#demoSignin', { state: 'visible' });
    await p3.evaluate(() => { location.hash = 'pricing'; });
    await p3.waitForTimeout(2000);
    const view4 = await p3.$eval('#cpCard', e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < window.innerHeight && r.bottom > 0; });
    ok(view4, 'adding #pricing to an open demo page also opens Class Pricing');
    await c3.close();
  }

  console.log('No pricing saved yet (fresh demo) / no confirmed Stripe amounts yet');
  ({ ctx, page, log } = await staffPage('?demo=fresh'));
  ok(/Not saved yet/.test(await txt(page, '#cpMeta')) && (await pub(page)) === null, '"Not saved yet"; no public pricing document');
  ok(await box(page, 'ccl16') && await box(page, 'renewal3') && await box(page, 'womens'), 'confirmation boxes open for every regular class (nothing confirmed yet)');
  let sms0 = await copySms(page, 'ccl16');
  ok(sms0.clip === '(clipboard before)' && sms0.missing === MISMATCH, 'Copy SMS (CCL) blocked until pricing is confirmed');
  ok(/Not saved/.test(await save(page)) && (await saved(page)) === null, 'Save refused while prices are blank');
  for (const [f, v] of [['ccl16', '175'], ['renewal3', '125'], ['womens', '125']]) { await page.fill('#cp_' + f, v); await confirmStripe(page, f, v, f !== 'womens'); }
  ok(/Not saved/.test(await save(page)) && /Women's Class/.test(await txt(page, '#cpMsg')) && (await saved(page)) === null, "Women's not ticked → refused, nothing written");
  await page.check('#cpAck_womens');
  await save(page);
  ok(JSON.stringify(await pub(page)) === JSON.stringify({ privateFrom: 250, ccl16: 175, renewal3: 125, womens: 125 }) && (await saved(page)).womensStripe === 125, 'first confirmed save creates both documents');
  sms0 = await copySms(page, 'ccl16');
  ok(sms0.clip === PAY_CCL('$175'), 'Copy SMS (CCL) now works at $175');
  ok(log.firebase === 0 && log.errors.length === 0, 'no Firebase requests, no JavaScript errors ' + log.errors.join(' | '));
  await ctx.close();

  console.log('Promotions and public cards');
  ({ ctx } = { ctx: await browser.newContext() });
  await stubGoogle(ctx);
  page = await ctx.newPage();
  const promos = await (await page.request.get(SITE + '/promos.js')).text();
  ok(/price: 160,/.test(promos) && /price: 100,/.test(promos) && promos.includes('bJe28rcY86Z9cEYeJJak005') && promos.includes('4gM5kD6zK4R15cwbxxak006'), 'promotional prices ($160 / $100) and promo Stripe links unchanged');
  await ctx.addInitScript(() => { try { sessionStorage.setItem('katcci_promo_seen', '1'); } catch (e) {} });
  await ctx.route(/Firestore\/Write|formspree\.io/, r => r.abort());
  page = await ctx.newPage();
  await page.goto(SITE + '/');
  await page.waitForFunction(() => document.querySelectorAll('#upcomingGrid .uc-card[data-dynamic], #upcomingGrid .uc-empty').length > 0, null, { timeout: 20000 });
  const cards = await page.$$eval('#upcomingGrid .uc-card[data-dynamic]', els => els.map(e => ({ price: e.querySelector('.uc-price').textContent, link: e.querySelector('a.btn-reserve') && e.querySelector('a.btn-reserve').getAttribute('href') })));
  let checked = 0;
  for (const c of cards.filter(c => c.link)) {
    const id = new URLSearchParams(c.link.split('?')[1]).get('class');
    const rec = await page.evaluate(id => window.KAT_BOOKING.loadClass(id), id);
    ok(rec && c.price === '$' + rec.price, `public card shows its scheduled class's own price (${c.price})`);
    checked++;
  }
  if (!checked) console.log('  (no upcoming bookable classes on the live schedule to compare)');

  // Homepage Private card: reads settings/publicPricing, else keeps the $250 fallback.
  const priv = () => page.$eval('#ucPrivatePrice', e => e.textContent);
  ok(/loadPublicPricing\(\)/.test(await (await page.request.get(SITE + '/')).text()), 'homepage reads settings/publicPricing');
  const live = await priv();
  ok(/^From \$\d+(\.\d\d)?$/.test(live), 'homepage Private card shows a valid price right now: ' + live);
  const shown = await page.evaluate(() => {
    const out = {};
    const t = d => { window.KAT_BOOKING.showPrivateFrom(d); return document.getElementById('ucPrivatePrice').textContent; };
    out.v275 = t({ privateFrom: 275 });
    out.v2755 = t({ privateFrom: 275.5 });
    out.extra = t({ privateFrom: 300, checkoutUrl: 'https://buy.stripe.com/SECRET', ccl16: 999 });
    out.missing = t(null);
    out.empty = t({});
    out.str = t({ privateFrom: '300' });
    out.neg = t({ privateFrom: -5 });
    out.zero = t({ privateFrom: 0 });
    out.prec = t({ privateFrom: 1.234 });
    out.huge = t({ privateFrom: 100000 });
    out.leak = document.body.innerHTML.includes('SECRET');
    return out;
  });
  ok(shown.v275 === 'From $275' && shown.v2755 === 'From $275.50', 'stored value displays: From $275 / From $275.50');
  ok(shown.extra === 'From $300' && !shown.leak, 'only privateFrom is used; any other fields are ignored and never shown');
  ok(['missing', 'empty', 'str', 'neg', 'zero', 'prec', 'huge'].every(k => shown[k] === 'From $250'), 'missing / invalid values fall back to From $250');
  await ctx.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PRICING CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
