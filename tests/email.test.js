// Registration confirmation emails (EmailJS) — /reserve contact details → Stripe (intercepted) → /confirmed.
// EmailJS is answered locally (recorded, optionally failing): no real email is ever sent. Google is stubbed,
// Stripe navigation intercepted, class records and settings/publicPricing are stand-ins.
const { chromium } = require('playwright-core');
const { stubGoogle, EMAILJS } = require('./google-stub');

const BASE = process.env.SITE || 'http://localhost:5058';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEND_TO = 'AW-18439430263/A1y-CLvYk5UdEPfAzdhE';
const SERVICE = 'service_h37afn8', PUBLIC_KEY = 'VzxulypxbsMUri30R', T_CUSTOMER = 'template_fo25dsd', T_NORA = 'template_we6n1w6';
const LINK = { ccl: 'https://buy.stripe.com/4gM7sLaQ0cjt0Wg9ppak007', renewal: 'https://buy.stripe.com/bJeeVde2c1EP5cw9ppak009' };
const PERSON = { name: 'Jordan  Rivera-Smith', email: 'jordan.rivera@example.com', phone: '+1 (312) 555-0101' };
const VARS = ['customer_name', 'customer_email', 'customer_phone', 'class_name', 'class_date', 'class_time', 'amount', 'session_id'];
let fails = 0, n = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };
const sid = () => 'cs_test_' + Date.now().toString(36) + 'Mail' + (++n) + 'q7Z';

const iso = k => { const d = new Date(Date.now() + k * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const longDate = (s, y) => { const [a, b, c] = s.split('-').map(Number); return new Date(a, b - 1, c).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(y ? { year: 'numeric' } : {}) }); };
const doc = f => ({ name: 'x', fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === null ? { nullValue: null } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }])) });
const PUB = { privateFrom: 250, ccl16: 200, renewal3: 140 };
const STANDINS = {
  TESTccl: { type: 'ccl', date1: iso(12), date2: iso(13), endDate: iso(13), time: '09:30', price: 175 },
  TESTrenewal: { type: 'renewal', date1: iso(15), date2: '', endDate: iso(15), time: '18:00', price: 125 }
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  // mail.fail = { customer: n, nora: n } → that template answers HTTP 500 for the next n attempts ('net' → network error).
  async function fresh() {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
    await stubGoogle(ctx);
    const mail = { calls: [], fail: { customer: 0, nora: 0 }, net: false };
    await ctx.route(EMAILJS, r => {
      const body = JSON.parse(r.request().postData() || '{}');
      const which = body.template_id === T_CUSTOMER ? 'customer' : body.template_id === T_NORA ? 'nora' : '?';
      mail.calls.push({ url: r.request().url(), which, body });
      if (mail.net) return r.abort();
      if (mail.fail[which] > 0) { mail.fail[which]--; return r.fulfill({ status: 500, body: 'The service is temporarily unavailable (stub)' }); }
      r.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' });
    });
    const urls = [];
    const st = { stripe: [], errors: [], console: [], urls };
    await ctx.addInitScript(() => { try { sessionStorage.setItem('katcci_promo_seen', '1'); } catch (e) {} });
    await ctx.route(/Firestore\/Write|formspree\.io/, r => r.abort());
    await ctx.route(/firestore\.googleapis\.com\/v1\/projects\/katcci\/databases\/\(default\)\/documents\/classes\/TEST/, r => {
      const id = new URL(r.request().url()).pathname.split('/').pop();
      STANDINS[id] ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc(STANDINS[id])) }) : r.fulfill({ status: 404, body: '{}' });
    });
    await ctx.route(/firestore\.googleapis\.com\/v1\/projects\/katcci\/databases\/\(default\)\/documents\/settings\/publicPricing/, r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc(PUB)) }));
    await ctx.route(/^https:\/\/(buy|checkout)\.stripe\.com\//, r => { st.stripe.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe stand-in</title>' }); });
    ctx.on('request', q => urls.push(q.url()));
    const page = await ctx.newPage();
    page.on('pageerror', e => st.errors.push(e.message));
    page.on('console', m => st.console.push(m.text()));
    return { ctx, page, st, mail };
  }
  const conversions = page => page.evaluate(() => (window.dataLayer || []).map(a => Array.from(a)).filter(a => a[0] === 'event' && a[1] === 'conversion').map(a => a[2]));
  const fill = async (page, p = PERSON) => { await page.fill('#custName', p.name); await page.fill('#custEmail', p.email); await page.fill('#custPhone', p.phone); };
  const checkAll = async page => { for (const c of await page.$$('.ack-check')) await c.check(); };
  async function book(page, st, path = '/reserve?class=TESTccl&utm_source=google&gclid=Cj0-mail', p = PERSON) {
    await page.goto(BASE + path);
    await page.waitForSelector('.ack-check', { timeout: 15000 });
    await fill(page, p); await checkAll(page);
    await page.click('#continueBtn');
    await page.waitForURL(/stripe\.com/);
    return st.stripe[st.stripe.length - 1];
  }
  // /confirmed and wait until the email script has finished (or skipped).
  async function confirmed(page, query, mail) {
    await page.goto(BASE + '/confirmed' + query);
    await page.waitForFunction(() => window.KAT_EMAIL_STATUS && !/^(idle|checking)$/.test(window.KAT_EMAIL_STATUS.state) &&
      window.KAT_EMAIL_STATUS.customer !== 'sending' && window.KAT_EMAIL_STATUS.nora !== 'sending', null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(300);
    return page.evaluate(() => ({ ...window.KAT_EMAIL_STATUS }));
  }
  const reg = page => page.evaluate(() => sessionStorage.getItem('katcci_pending_registration'));
  const pageOk = async page => /You're confirmed!/.test(await page.textContent('h1')) && /payment was received/.test(await page.textContent('main')) &&
    !/error|fail|EmailJS|temporarily/i.test(await page.textContent('main'));

  // ── 1. Contact details required ──
  console.log('Contact details are required before regular checkout');
  let { ctx, page, st, mail } = await fresh();
  await page.goto(BASE + '/reserve?class=TESTccl');
  await page.waitForSelector('.ack-check', { timeout: 15000 });
  ok(await page.isVisible('#contactBlock') && await page.isVisible('#custName') && await page.isVisible('#custEmail') && await page.isVisible('#custPhone'), 'scheduled class: name, email and mobile phone fields shown');
  ok(await page.$eval('#custName', e => e.autocomplete === 'name') && await page.$eval('#custEmail', e => e.type === 'email' && e.autocomplete === 'email') && await page.$eval('#custPhone', e => e.type === 'tel' && e.autocomplete === 'tel'), 'fields use name / email / tel autofill');
  ok(!(await page.$('#contactBlock form, form #custName')) && !(await page.$$eval('#contactBlock input', els => els.some(e => e.name))), 'fields are not inside a form and have no name= (cannot be submitted into a URL)');
  await checkAll(page);
  ok(await page.isDisabled('#continueBtn'), 'all acknowledgments checked but no contact details: Continue locked');
  for (const [field, bad, good] of [
    ['#custName', 'J', PERSON.name], ['#custName', 'Jordan 2', PERSON.name], ['#custName', '<b>Jo</b>', PERSON.name],
    ['#custEmail', 'jordan@', PERSON.email], ['#custEmail', 'jordan example.com', PERSON.email], ['#custEmail', 'a@b', PERSON.email], ['#custEmail', 'a..b@example.com', PERSON.email],
    ['#custPhone', '555-0101', PERSON.phone], ['#custPhone', '(012) 555-0101', PERSON.phone], ['#custPhone', '312-555-01010', PERSON.phone], ['#custPhone', '312-555-01ab', PERSON.phone]]) {
    await fill(page); await page.fill(field, bad); await page.$eval(field, e => e.blur());
    ok(await page.isDisabled('#continueBtn') && await page.$eval(field, e => e.classList.contains('invalid') && e.closest('.field').classList.contains('show-error')), `${field.slice(5)} "${bad}" rejected (message shown, Continue locked)`);
    await page.fill(field, good);
  }
  await fill(page);
  ok(!(await page.isDisabled('#continueBtn')), 'valid name + email + phone and all acknowledgments: Continue enabled');
  await page.uncheck('.ack-check >> nth=0');
  ok(await page.isDisabled('#continueBtn'), 'unchecking an acknowledgment locks Continue again');
  await page.check('.ack-check >> nth=0');
  for (const p of ['3125550101', '312.555.0101', '1-312-555-0101', '+1 312 555 0101']) { await page.fill('#custPhone', p); ok(!(await page.isDisabled('#continueBtn')), `phone format accepted: ${p}`); }
  await page.goto(BASE + '/reserve?c=ccl16&to=' + encodeURIComponent(LINK.ccl));
  await page.waitForSelector('.ack-check');
  ok(!(await page.isVisible('#contactBlock')), 'staff-texted payment link: no contact fields (unchanged flow)');
  await page.goto(BASE + '/reserve?promo=ccl-2026-10-17');
  await page.waitForSelector('#errorFlow', { state: 'visible' });
  ok(!(await page.isVisible('#contactBlock')), 'old promo link: no contact fields, offer unavailable');
  await ctx.close();

  // ── 2. Happy path: CCL ──
  console.log('CCL booking → Stripe → /confirmed: both emails, once');
  ({ ctx, page, st, mail } = await fresh());
  const stripeUrl = await book(page, st);
  const u = new URL(stripeUrl);
  ok(u.origin + u.pathname === LINK.ccl, 'Continue → new CCL $200 Stripe link');
  const pii = [PERSON.email, 'jordan', 'Rivera', '5550101', '555-0101', '555%2D0101', encodeURIComponent(PERSON.email)];
  ok(st.urls.every(x => !pii.some(v => x.toLowerCase().includes(v.toLowerCase()))), 'no customer name, email or phone in any URL requested (reserve, Firestore, Stripe…) — ' + st.urls.length + ' requests');
  await page.goto(BASE + '/terms');
  const stored = JSON.parse(await reg(page));
  ok(stored && stored.customer_name === 'Jordan Rivera-Smith' && stored.customer_email === PERSON.email && stored.customer_phone === '(312) 555-0101' &&
     stored.class_name === '16-Hour CCL Certification' && stored.class_date === longDate(iso(12)) + ' & ' + longDate(iso(13), true) && stored.class_time === '9:30 AM' &&
     stored.amount === 200 && stored.classId === 'TESTccl' && stored.classType === 'ccl' && stored.classKey === 'ccl16' && Date.now() - stored.at < 60000,
     'pending registration: name, email, phone, class name/date/time, trusted $200, class id/type, timestamp');
  ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(PERSON.email) && !(await page.evaluate(() => JSON.stringify(localStorage))).includes('Rivera'), 'contact details are in sessionStorage only (nothing personal in localStorage)');
  const id1 = sid();
  let s = await confirmed(page, '?session_id=' + id1 + '&amount=1&customer_email=evil@example.com', mail);
  const cust = mail.calls.filter(c => c.which === 'customer'), nora = mail.calls.filter(c => c.which === 'nora');
  const expected = { customer_name: 'Jordan Rivera-Smith', customer_email: PERSON.email, customer_phone: '(312) 555-0101', class_name: '16-Hour CCL Certification',
    class_date: longDate(iso(12)) + ' & ' + longDate(iso(13), true), class_time: '9:30 AM', amount: '$200', session_id: id1 };
  const exact = c => c && c.body.service_id === SERVICE && c.body.user_id === PUBLIC_KEY && JSON.stringify(Object.keys(c.body.template_params).sort()) === JSON.stringify([...VARS].sort()) &&
    VARS.every(k => c.body.template_params[k] === expected[k]) && !('accessToken' in c.body) && c.url === 'https://api.emailjs.com/api/v1.0/email/send';
  ok(cust.length === 1 && cust[0].body.template_id === T_CUSTOMER && exact(cust[0]), 'customer email: service_h37afn8 / template_fo25dsd, exactly the 8 variables with the right values ' + JSON.stringify(cust[0] && cust[0].body.template_params));
  ok(nora.length === 1 && nora[0].body.template_id === T_NORA && exact(nora[0]), "Nora's notification: template_we6n1w6 with the same registration details");
  ok(mail.calls.length === 2 && mail.calls[0].which === 'customer', 'exactly two EmailJS calls (customer first); public key only, no private key / access token');
  ok(s.state === 'complete' && s.customer === 'sent' && s.nora === 'sent', 'status: complete (customer sent, nora sent)');
  ok(!(await reg(page)), 'pending registration cleared after both emails were sent');
  const sentRec = await page.evaluate(() => localStorage.getItem('katcci_emails_sent'));
  ok(JSON.parse(sentRec)[id1].customer === true && JSON.parse(sentRec)[id1].nora === true && !/jordan|rivera|5550101|example\.com/i.test(sentRec), 'sent record: session id → customer/nora sent, no personal details');
  const ev = await conversions(page);
  ok(ev.length === 1 && ev[0].send_to === SEND_TO && ev[0].value === 200 && ev[0].transaction_id === id1, 'Google Ads conversion unchanged: one event, value 200, transaction_id = session id');
  ok(await pageOk(page), 'confirmation page unchanged');
  ok(st.console.every(t => !/jordan|rivera|5550101|555-0101|example\.com/i.test(t)) && st.console.some(t => /confirmation emails: complete/.test(t)), 'console shows a status only — no customer details');
  await page.reload(); await page.waitForTimeout(1500);
  ok(mail.calls.length === 2 && (await conversions(page)).length === 0, 'refresh: neither email re-sent, no second conversion');
  await confirmed(page, '?session_id=' + id1, mail);
  ok(mail.calls.length === 2, 'revisiting the same session id: still no resend');
  ok(st.errors.length === 0, 'no JavaScript errors ' + st.errors.join(' | '));
  await ctx.close();

  // ── 3. Renewal values ──
  console.log('Renewal booking');
  ({ ctx, page, st, mail } = await fresh());
  ok(new URL(await book(page, st, '/reserve?class=TESTrenewal')).pathname === new URL(LINK.renewal).pathname, 'Continue → new Renewal $140 Stripe link');
  const id2 = sid();
  s = await confirmed(page, '?session_id=' + id2, mail);
  const p2 = mail.calls[0] && mail.calls[0].body.template_params;
  ok(mail.calls.length === 2 && p2.class_name === '3-Hour CCL Renewal' && p2.class_date === longDate(iso(15), true) && p2.class_time === '6:00 PM' && p2.amount === '$140' && p2.session_id === id2 &&
     JSON.stringify(mail.calls[1].body.template_params) === JSON.stringify(p2), 'Renewal: 3-Hour CCL Renewal, one date, 6:00 PM, $140 — same details in both templates');
  ok((await conversions(page)).filter(e => e.value === 140).length === 1, 'Renewal conversion value 140 (unchanged)');
  await ctx.close();

  // ── 4. Must not send ──
  console.log('No email without a real checkout return + trusted pending registration');
  ({ ctx, page, st, mail } = await fresh());
  await book(page, st);
  for (const [q, why] of [['', 'direct /confirmed visit'], ['?session_id={CHECKOUT_SESSION_ID}', 'unfilled placeholder'], ['?session_id=not-a-stripe-id', 'non-Stripe session id'],
                          ['?session_id=cs_test_short', 'too-short cs_ id'], ['?session_id=cs_fake_abcdefghijkl', 'wrong cs_ prefix'], ['?sessionid=' + sid(), 'misspelled parameter']]) {
    s = await confirmed(page, q, mail);
    ok(mail.calls.length === 0 && /no valid checkout session/.test(s.state), why + ': no email');
  }
  ok(!!(await reg(page)), '…and the pending registration is kept for the real return');
  await ctx.close();
  ({ ctx, page, st, mail } = await fresh());
  s = await confirmed(page, '?session_id=' + sid(), mail);
  ok(mail.calls.length === 0 && /no pending registration/.test(s.state) && await pageOk(page), 'valid session id but no pending registration: no email, page unchanged');
  for (const [label, patch] of [['expired (over 6 hours old)', { at: Date.now() - 6 * 3600 * 1000 - 1000 }], ['amount not the current price ($175)', { amount: 175 }],
                                ['retired class key (womens)', { classKey: 'womens' }], ['invalid email', { customer_email: 'nope' }], ['future timestamp', { at: Date.now() + 3600 * 1000 }]]) {
    await page.goto(BASE + '/terms');
    await page.evaluate(patch => sessionStorage.setItem('katcci_pending_registration', JSON.stringify({ customer_name: 'Jordan Rivera', customer_email: 'jordan.rivera@example.com', customer_phone: '(312) 555-0101',
      class_name: '16-Hour CCL Certification', class_date: 'Saturday, December 12 & Sunday, December 13, 2026', class_time: '10:00 AM', amount: 200, classId: 'x', classType: 'ccl', classKey: 'ccl16', at: Date.now(), ...patch })), patch);
    s = await confirmed(page, '?session_id=' + sid(), mail);
    ok(mail.calls.length === 0, label + ': no email (' + s.state + ')');
  }
  ok(!(await reg(page)) || JSON.parse(await reg(page)).amount === 175, 'invalid / expired registrations are removed');
  await ctx.close();
  // Staff-texted link and an older registration in the same tab: the new checkout clears it.
  ({ ctx, page, st, mail } = await fresh());
  await book(page, st);
  await page.goto(BASE + '/reserve?c=ccl16&to=' + encodeURIComponent(LINK.ccl));
  await page.waitForSelector('.ack-check'); await checkAll(page); await page.click('#continueBtn'); await page.waitForURL(/stripe\.com/);
  const id3 = sid();
  s = await confirmed(page, '?session_id=' + id3, mail);
  ok(mail.calls.length === 0 && !(await reg(page)), 'staff-texted link checkout clears an earlier pending registration: no email');
  ok((await conversions(page)).filter(e => e.value === 200 && e.transaction_id === id3).length === 1, '…its Google Ads conversion still works (value 200)');
  await ctx.close();

  // ── 5. Failures ──
  console.log("Nora's template fails, customer succeeds");
  ({ ctx, page, st, mail } = await fresh());
  await book(page, st);
  mail.fail.nora = 99;
  const id4 = sid();
  s = await confirmed(page, '?session_id=' + id4, mail);
  ok(s.customer === 'sent' && s.nora === 'failed' && /incomplete/.test(s.state), 'status: customer sent, nora failed (after 3 attempts)');
  ok(mail.calls.filter(c => c.which === 'customer').length === 1 && mail.calls.filter(c => c.which === 'nora').length === 3, 'customer email sent once; Nora retried 3 times automatically — customer never resent');
  ok(await pageOk(page), 'confirmation page still shows the successful payment; no error shown to the customer');
  ok((await conversions(page)).length === 1, 'exactly one Google Ads conversion');
  ok(!!(await reg(page)) && JSON.parse(await reg(page)).sessionId === id4, 'pending registration kept (bound to this session) so the unsent template can be retried');
  mail.fail.nora = 0;
  s = await confirmed(page, '?session_id=' + id4, mail);   // = refreshing /confirmed
  ok(s.customer === 'already sent' && s.nora === 'sent' && s.state === 'complete' && mail.calls.filter(c => c.which === 'customer').length === 1 && mail.calls.filter(c => c.which === 'nora').length === 4,
     "refresh: only Nora's email is sent; customer not duplicated");
  ok(!(await reg(page)) && (await conversions(page)).length === 0, 'then registration cleared; no second conversion');
  await confirmed(page, '?session_id=' + id4, mail);
  ok(mail.calls.length === 5, 'another refresh: nothing more sent');
  await ctx.close();

  console.log('Customer template fails, Nora succeeds');
  ({ ctx, page, st, mail } = await fresh());
  await book(page, st);
  mail.fail.customer = 99;
  const id5 = sid();
  s = await confirmed(page, '?session_id=' + id5, mail);
  ok(s.customer === 'failed' && s.nora === 'sent' && mail.calls.filter(c => c.which === 'nora').length === 1 && await pageOk(page), 'customer failed (3 attempts), Nora sent once, page unchanged');
  ok(mail.calls.filter(c => c.which === 'customer').length === 3, 'customer email retried automatically 3 times');
  await confirmed(page, '?session_id=' + sid(), mail);
  ok(mail.calls.length === 4, 'a different session id cannot reuse this registration');
  mail.fail.customer = 0;
  s = await confirmed(page, '?session_id=' + id5, mail);
  ok(s.customer === 'sent' && s.nora === 'already sent' && mail.calls.filter(c => c.which === 'nora').length === 1, 'retry: customer sent, Nora not duplicated');
  await ctx.close();

  console.log('Transient failure, and EmailJS unreachable');
  ({ ctx, page, st, mail } = await fresh());
  await book(page, st);
  mail.fail.customer = 1;
  s = await confirmed(page, '?session_id=' + sid(), mail);
  ok(s.state === 'complete' && mail.calls.filter(c => c.which === 'customer').length === 2 && mail.calls.filter(c => c.which === 'nora').length === 1, 'one failed attempt then success: each template delivered once');
  await ctx.close();
  ({ ctx, page, st, mail } = await fresh());
  await book(page, st);
  mail.net = true;
  s = await confirmed(page, '?session_id=' + sid(), mail);
  ok(s.customer === 'failed' && s.nora === 'failed' && await pageOk(page) && (await conversions(page)).length === 1 && st.errors.length === 0,
     'EmailJS unreachable: page unchanged, conversion still fires once, no JavaScript errors');
  ok(st.console.every(t => !/jordan|rivera|5550101|555-0101|example\.com/i.test(t)), 'failure status logged without customer details');
  await ctx.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL EMAIL CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
