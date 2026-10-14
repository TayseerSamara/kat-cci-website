// Staff "💲 Class Pricing" (settings/pricing) — demo mode on /pay, so nothing touches Firebase.
const { chromium } = require('playwright-core');
const { stubGoogle } = require('./google-stub');

const SITE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MISMATCH = 'Website price and Stripe checkout price do not match. Online booking for this class should not be published until the Stripe link is updated.';
const FIREBASE_HOSTS = /firestore\.googleapis|identitytoolkit|securetoken|firebaseinstallations|firebaseio/;
let fails = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  async function staffPage(query) {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
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
  const row = (page, f) => page.$eval(`[data-cp="${f}"]`, e => ({ text: e.innerText.replace(/\s+/g, ' '), warn: !e.querySelector('.cp-warn').hidden, okMark: !e.querySelector('.cp-ok').hidden }));
  const saved = page => page.evaluate(() => { const p = window.__demoDb.settings.get('pricing'); return p ? { ...p, updatedAt: !!p.updatedAt } : null; });
  const classes = page => page.evaluate(() => Object.fromEntries([...window.__demoDb.classes.entries()].map(([k, v]) => [k, v.price])));
  const save = async page => { await page.$eval('#cpSaveBtn', e => e.click()); await page.waitForTimeout(500); return txt(page, '#cpMsg'); };

  console.log('Loading current pricing (demo)');
  let { ctx, page, log } = await staffPage('?demo');
  ok(await val(page, '#cp_ccl16') === '175' && await val(page, '#cp_renewal3') === '125' && await val(page, '#cp_womens') === '125' && await val(page, '#cp_privateFrom') === '250', 'shows saved prices: CCL $175, Renewal $125, Women\'s $125, Private from $250');
  for (const [f, link, amt] of [['ccl16', 'buy.stripe.com/14A5kDf6g3MXdJ28llak000', '$175'], ['renewal3', 'buy.stripe.com/6oU7sLgakcjt34ocBBak002', '$125'], ['womens', 'buy.stripe.com/eVqdR92ju6Z934odFFak001', '$125'], ['privateFrom', 'buy.stripe.com/eVq3cve2c97hcEY7hhak003', '$250']]) {
    const r = await row(page, f);
    ok(r.text.includes(link) && r.text.includes('Expected checkout amount: ' + amt) && r.okMark && !r.warn, `${f}: approved Stripe link ${link}, expected ${amt}, ✓ matches`);
  }
  ok(/Last saved .* by nora@katcci\.com/.test(await txt(page, '#cpMeta')), 'shows who last saved');
  ok(await val(page, '#fPrice') === '175' && /Matches the approved \$175 Stripe checkout/.test(await txt(page, '#fPriceHint')), 'new-class form defaults to $175 with a ✓ checkout hint');

  console.log('Invalid prices are rejected');
  for (const bad of ['', '-5', '0', '12.345', '1e3', '100000']) {
    await page.fill('#cp_ccl16', bad);
    const msg = await save(page);
    ok(/Not saved/.test(msg) && (await saved(page)).ccl16 === 175 && (await row(page, 'ccl16')).warn, `"${bad}" rejected; nothing saved`);
  }

  console.log('Editing each price');
  const classesBefore = await classes(page);
  await page.fill('#cp_ccl16', '185');
  await page.fill('#cp_renewal3', '130.50');
  await page.fill('#cp_womens', '120');
  await page.fill('#cp_privateFrom', '275');
  for (const f of ['ccl16', 'renewal3', 'womens', 'privateFrom']) {
    const r = await row(page, f);
    ok(r.warn && r.text.includes(MISMATCH), `${f}: mismatch warning shown before saving`);
  }
  const msg = await save(page);
  const s = await saved(page);
  ok(/✓ Pricing saved/.test(msg), 'Save Pricing → "✓ Pricing saved."');
  ok(s.ccl16 === 185 && s.renewal3 === 130.5 && s.womens === 120 && s.privateFrom === 275 && s.updatedBy === 'tony@katcci.com' && s.updatedAt, 'saved values exact (185 / 130.5 / 120 / 275), stamped with editor and time');
  ok(/doesn't match its Stripe checkout/.test(msg), 'save message points out the Stripe mismatches');
  ok(JSON.stringify(await classes(page)) === JSON.stringify(classesBefore), 'existing scheduled classes NOT repriced: ' + JSON.stringify(classesBefore));

  console.log('New classes use the saved default; checkout safety unchanged');
  await page.selectOption('#fType', 'renewal');
  ok(await val(page, '#fPrice') === '130.5', 'Renewal new class defaults to 130.5');
  await page.selectOption('#fType', 'womens');
  ok(await val(page, '#fPrice') === '120', "Women's new class defaults to 120");
  await page.selectOption('#fType', 'ccl');
  ok(await val(page, '#fPrice') === '185', 'CCL new class defaults to 185');
  ok(/doesn't match the approved Stripe checkout \(\$175\)/.test(await txt(page, '#fPriceHint')) && /Text to Reserve/.test(await txt(page, '#fPriceHint')), 'form warns a $185 class won\'t book online (shows Text to Reserve)');
  await page.fill('#fDate1', '2030-03-07'); await page.fill('#fDate2', '2030-03-08');
  await page.$eval('#saveBtn', e => e.click());
  await page.waitForFunction(() => /added/.test(document.getElementById('mgrMsg').textContent));
  const after = await classes(page);
  const newIds = Object.keys(after).filter(k => !(k in classesBefore));
  ok(newIds.length === 1 && after[newIds[0]] === 185, 'newly created class saved at the current default ($185)');
  const bookable = await page.evaluate(() => [
    window.KAT_BOOKING.isBookable({ type: 'ccl', price: 185, date1: '2030-03-07', endDate: '2030-03-08' }),
    window.KAT_BOOKING.isBookable({ type: 'ccl', price: 175, date1: '2030-03-07', endDate: '2030-03-08' })]);
  ok(bookable[0] === false && bookable[1] === true, 'unsafe checkout still blocked: $185 CCL class not bookable online; $175 is');

  await page.fill('#cp_ccl16', '175');
  ok((await row(page, 'ccl16')).okMark, 'putting CCL back to $175 shows ✓ match');
  await save(page);
  ok((await saved(page)).ccl16 === 175, 'saved back to $175');
  ok(log.firebase === 0 && log.errors.length === 0, 'demo: zero Firebase requests, no JavaScript errors ' + log.errors.join(' | '));
  await ctx.close();

  console.log('No pricing saved yet (fresh demo)');
  ({ ctx, page, log } = await staffPage('?demo=fresh'));
  ok(await val(page, '#cp_ccl16') === '175' && await val(page, '#cp_renewal3') === '125' && await val(page, '#cp_womens') === '125' && await val(page, '#cp_privateFrom') === '250', 'falls back to the approved checkout prices');
  ok(/Not saved yet/.test(await txt(page, '#cpMeta')) && await val(page, '#fPrice') === '175', '"Not saved yet" note; new class defaults to $175');
  ok(log.firebase === 0 && log.errors.length === 0, 'no Firebase requests, no JavaScript errors');
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
  await ctx.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PRICING CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
