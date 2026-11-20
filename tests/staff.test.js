// Staff page (/pay) tests, run in demo mode (?demo) so nothing touches Firebase.
// SITE = base URL (default http://localhost:5058). Demo mode only runs on localhost / preview hosts.
const { chromium } = require('playwright-core');
const { stubGoogle } = require('./google-stub');
const path = require('path');

const SITE = process.env.SITE || 'http://localhost:5058';
const BASE = SITE + '/pay';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = process.env.SHOTS_DIR || '';
let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ✔ ' : '  ✘ ') + label); if (!cond) fails++; };

const FIREBASE_HOSTS = /firestore\.googleapis|identitytoolkit|securetoken|firebaseinstallations|firebaseio/;
const HELLO = url => 'Hello, thank you for training with KAT CCI! If you have a minute, we would really appreciate a quick Google review. It helps other students find us:\n\n' + url + '\n\n— Kat CCI';
const DEMO_URL = 'https://g.page/r/DEMO-ONLY/review', REAL_URL = 'https://g.page/r/CXwwM6FkrgrtECE/review';
const CONFIRM_DAY1 = `You're all set for Day 1 of the 16-Hour CCL course on Saturday, October 3!

🕐 Arrive: 9:00 AM
📍 Location: 4604 W 137th Street, Unit D, Crestwood, IL 60445

🧾 Bring:
   • Valid photo ID OR FOID card
   • Notebook + pen (optional)

💵 Payment: Zelle, Apple Pay, or Cash

Heads up for Day 2 (range day): you'll need a firearm + 30 rounds of ammo. No firearm? We rent for $25 (ammo included).

We provide course materials and eye & ear protection.

Reply with any questions before class day — see you soon!

— Kat CCI`;
const CONFIRM_DAY2 = `Day 2 of your 16-Hour CCL course is on Saturday, October 3 — range day!

🕐 Arrive: 9:00 AM
📍 Location: 4604 W 137th Street, Unit D, Crestwood, IL 60445

🧾 Bring:
   • Valid photo ID OR FOID card
   • Your firearm + 30 rounds of ammo (or rent from us — $25, ammo included)
   • Comfortable closed-toe shoes

Range fees ($23) and lane waiver ($6) are paid on-site.

We provide eye & ear protection.

Reply with any questions before class day — see you soon!

— Kat CCI`;

// Class reminder expectations (dates follow the demo schedule, which is relative to today).
const iso = n => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const day = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); };
const monthDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }); };
const ADDR = '📍 4604 W 137th Street, Unit D, Crestwood, IL 60445';
const REM_CCL = `Hi! Your seat is confirmed for the KAT CCI 16-Hour CCL Certification.

📅 ${day(iso(9))} & ${day(iso(10))}
🕘 9:00 AM
${ADDR}

🧾 Bring:
• Valid photo ID or FOID card
• Notebook + pen (optional)

For Day 2 (range day), bring a firearm and 30 rounds of ammo. No firearm? Rentals are available for $25 with ammo included.

We provide course materials and eye & ear protection.

See you soon!
— KAT CCI`;
const REM_RENEWAL = `Hi! Your seat is confirmed for the KAT CCI 3-Hour CCL Renewal.

📅 ${day(iso(16))}
🕕 6:00 PM
${ADDR}

🧾 Bring:
• Valid photo ID or FOID card
• Your firearm + 30 rounds of ammo (or rent from us — $25, ammo included)
• Comfortable closed-toe shoes

Range fees ($23) and lane waiver ($6) are paid on-site.

We provide eye & ear protection.

See you soon!
— KAT CCI`;
const REM_PRIVATE = `Hi! Your seat is confirmed for the KAT CCI Private 1-on-1 Class.

📅 ${day('2026-11-07')}
🕝 2:30 PM
${ADDR}

🧾 Bring:
• Valid photo ID

We provide everything else — course materials and eye & ear protection.

See you soon!
— KAT CCI`;
const PAY_CCL = d => `Hi! You're confirmed for the 16-Hour CCL Certification course${d ? ' on ' + d : ''}.

To lock in your seat, review our quick terms and complete payment of $200 here:

https://www.katcci.com/reserve?c=ccl16&to=https%3A%2F%2Fbuy.stripe.com%2F4gM7sLaQ0cjt0Wg9ppak007

You can pay by card, Apple Pay, or Google Pay. Prefer Zelle or cash? Just reply.

$200 covers your 16 hours of training. The $150 state fee is paid separately to ISP.

— Kat CCI`;
// Anything that would make a reminder a payment request.
const NO_PAY = /stripe|https?:|\/reserve|payment|pay by|complete pay|\$(200|175|160|125|100|250|140|5)\b|promo|coupon|Zelle/i;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--host-resolver-rules=MAP staff.example.test 127.0.0.1'] });

  async function openPage(url, viewport = { width: 420, height: 900 }) {
    const ctx = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
    await stubGoogle(ctx);
    const page = await ctx.newPage();
    const log = { firebase: [], errors: [], demoJs: false };
    page.on('request', r => { if (FIREBASE_HOSTS.test(r.url())) log.firebase.push(r.url()); if (r.url().includes('pay-demo.js')) log.demoJs = true; });
    page.on('pageerror', e => log.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/because a user gesture is required/.test(m.text())) log.errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    await page.route(FIREBASE_HOSTS, r => r.abort());   // demo mode must never reach Firebase
    await page.goto(url);
    return { page, log, ctx };
  }
  // Headless Chrome ignores trusted clicks while an sms:/mailto: prompt is pending, so dispatch clicks directly.
  const tap = async (page, sel) => { await page.waitForSelector(sel, { state: 'attached' }); await page.$eval(sel, e => e.click()); };
  const val = (page, sel) => page.$eval(sel, e => e.value);
  const txt = (page, sel) => page.$eval(sel, e => e.textContent);
  const clip = page => page.evaluate(() => navigator.clipboard.readText());
  const lastSaved = page => page.evaluate(() => { const r = [...window.__demoDb.reviewRequests.values()].pop(); return { ...r, requestedAt: !!r.requestedAt }; });
  const visible = (page, sel) => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && r.width > 0 && r.height > 0; }).catch(() => false);
  const shot = async (el, name) => { if (SHOTS && el) await el.screenshot({ path: path.join(SHOTS, name) }); };
  const card = k => `[data-key="${k}"]`;

  // ── 1. Demo mode, seeded ──
  console.log('Demo mode (seeded)');
  let { page, log, ctx } = await openPage(BASE + '?demo');
  ok(await page.waitForSelector('text=DEMO MODE', { timeout: 10000 }).then(() => true, () => false), 'demo banner shown');
  await page.waitForFunction(() => window.KAT_PUBLIC_PRICING !== undefined, null, { timeout: 10000 });   // current regular prices loaded

  // ── Copy Class Reminder (payment helper cards work without signing in) ──
  ok((await page.$$('[data-action="remind-copy"]')).length === 3 && !(await page.$(card('test') + ' [data-action="remind-copy"]')), 'Copy Class Reminder on the CCL, Renewal and Private cards (not the $5 test card)');
  ok(!(await page.$(card('womens'))) && !(await page.$$eval('.lc .lc-title', els => els.map(t => t.textContent).join('|'))).match(/Women/i),
     "no Women's Class payment card (Copy SMS / reminder)");
  ok((await txt(page, card('ccl16') + ' [data-action="copy"]')).trim() === '📋 Copy SMS', 'Copy SMS button still there');
  await page.click(card('ccl16') + ' [data-action="copy"]');
  ok((await clip(page)) === PAY_CCL(''), 'existing CCL Copy SMS (payment request) unchanged');
  await page.click(card('ccl16') + ' [data-action="remind-copy"]');
  ok(await visible(page, card('ccl16') + ' .lc-remind-missing') && (await clip(page)) === PAY_CCL(''), 'CCL reminder without a date: asks for the date, copies nothing');

  await page.waitForSelector(card('ccl16') + ' .sched-chip');
  const chipText = await txt(page, card('ccl16') + ' .sched-chip');
  await page.click(card('ccl16') + ' .sched-chip');
  ok((await val(page, card('ccl16') + ' [data-field=date]')) === iso(9) && (await val(page, card('ccl16') + ' [data-field=time]')) === '09:00' && /9:00 AM/.test(chipText),
     'CCL: choosing the scheduled class fills its date and start time (' + chipText + ')');
  ok(!!(await page.$(card('ccl16') + ' .sched-chip.active')), 'chosen scheduled class highlighted');
  await page.click(card('ccl16') + ' [data-action="remind-preview"]');
  ok((await txt(page, card('ccl16') + ' .lc-remind-preview')) === REM_CCL, '16-Hour CCL reminder preview: both class days, 9:00 AM, CCL instructions');
  await shot(await page.$(card('ccl16')), 'reminder-ccl-card.png');
  await page.click(card('ccl16') + ' [data-action="remind-copy"]');
  const cclRem = await clip(page);
  ok(cclRem === REM_CCL, '16-Hour CCL reminder copied exactly');
  ok(/✓ Class reminder copied/.test(await txt(page, '#toast')), 'shows "✓ Class reminder copied"');
  ok(!NO_PAY.test(cclRem), 'CCL reminder: no Stripe/payment link, no price, no request to pay');
  await page.click(card('ccl16') + ' [data-action="copy"]');
  ok((await clip(page)) === PAY_CCL(monthDay(iso(9))), 'existing CCL Copy SMS still works (now with the chosen date)');

  await page.fill(card('renewal3') + ' [data-field=date]', iso(16));
  ok((await val(page, card('renewal3') + ' [data-field=time]')) === '18:00', 'Renewal: typing a scheduled date fills the class start time');
  await page.click(card('renewal3') + ' [data-action="remind-copy"]');
  const renRem = await clip(page);
  ok(renRem === REM_RENEWAL, 'Renewal reminder: one day, 6:00 PM, renewal instructions');
  ok(!NO_PAY.test(renRem) && !/Day 2/.test(renRem), 'Renewal reminder: no payment link/price/request, no Day 2 info');

  ok(!(await page.$(card('private') + ' .sched-chip')), 'Private card has no schedule picks');
  await page.click(card('private') + ' [data-action="remind-copy"]');
  ok(await visible(page, card('private') + ' .lc-remind-missing'), 'Private reminder without a date asks for one');
  await page.fill(card('private') + ' [data-field=date]', '2026-11-07');
  await page.fill(card('private') + ' [data-field=time]', '14:30');
  await page.click(card('private') + ' [data-action="remind-copy"]');
  const privRem = await clip(page);
  ok(privRem === REM_PRIVATE && !NO_PAY.test(privRem), 'Private reminder: typed date and 2:30 PM, private instructions, no payment info');
  await page.click(card('private') + ' [data-action="copy"]');
  const privPay = await clip(page);
  ok(/complete payment of \$250 here/.test(privPay) && /buy\.stripe\.com%2FaFa9AT8HS97hcEYattak008/.test(privPay) && !/eVq3cve2c97hcEY7hhak003/.test(privPay), 'Private Copy SMS uses the new $250 Private Stripe link');
  const links = await page.$$eval('.lc input[data-field=link]', els => Object.fromEntries(els.map(e => [e.closest('.lc').dataset.key, [e.value, e.readOnly]])));
  ok(links.ccl16[0] === 'https://buy.stripe.com/4gM7sLaQ0cjt0Wg9ppak007' && links.renewal3[0] === 'https://buy.stripe.com/bJeeVde2c1EP5cw9ppak009' &&
     links.private[0] === 'https://buy.stripe.com/aFa9AT8HS97hcEYattak008' && links.test[0] === 'https://buy.stripe.com/6oUbJ18HS4R1gVe7hhak004',
     'Stripe links: CCL 4gM7sL...007, Renewal bJeeVd...009, Private aFa9AT...008, Test unchanged');
  ok(links.ccl16[1] && links.renewal3[1] && links.private[1] && links.test[1], 'built-in Stripe links are read-only');
  ok((await txt(page, card('ccl16') + ' .lc-price')) === '$200' && (await txt(page, card('renewal3') + ' .lc-price')) === '$140', 'payment cards show CCL $200, Renewal $140');

  // Confirmation & Class Details SMS: payment line on all but Day 2
  const conf = card('confirm');
  await page.fill(conf + ' input[data-field=date]', '2026-10-03');
  await page.fill(conf + ' input[data-field=time]', '09:00');
  await page.selectOption(conf + ' select[data-field=classType]', 'ccl_day1');
  await page.click(conf + ' [data-action=preview]');
  ok((await txt(page, conf + ' .lc-preview')) === CONFIRM_DAY1, 'confirmation preview (Day 1) unchanged, with payment line');
  await page.click(conf + ' [data-action=copy]');
  ok((await clip(page)) === CONFIRM_DAY1, 'confirmation Copy SMS (Day 1) unchanged');
  ok(!(await page.$(conf + ' select[data-field=classType] option[value=womens]')), "confirmation tool: no Women's Class option");
  for (const t of ['renewal', 'private']) {
    await page.selectOption(conf + ' select[data-field=classType]', t);
    await page.click(conf + ' [data-action=copy]');
    ok(((await clip(page)).match(/\n\n💵 Payment: Zelle, Apple Pay, or Cash\n\n/g) || []).length === 1, 'confirmation payment line present once for ' + t);
  }
  await page.selectOption(conf + ' select[data-field=classType]', 'ccl_day2');
  await page.click(conf + ' [data-action=copy]');
  ok((await clip(page)) === CONFIRM_DAY2, 'confirmation CCL Day 2: no payment line, unchanged');
  await page.click(conf + ' [data-action=preview]');

  // Reminder fields are remembered on this device, like the payment fields
  await page.reload();
  await page.waitForSelector(card('ccl16') + ' .sched-chip.active');
  ok((await val(page, card('ccl16') + ' [data-field=time]')) === '09:00' && (await val(page, card('private') + ' [data-field=time]')) === '14:30', 'reminder fields remembered on this device after reload');

  // A device that saved OLD links earlier still gets the new built-in links
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('katcci_pay_helper_v1') || '{}');
    st.private = { ...(st.private || {}), link: 'https://buy.stripe.com/eVq3cve2c97hcEY7hhak003' };
    st.ccl16 = { ...(st.ccl16 || {}), link: 'https://buy.stripe.com/14A5kDf6g3MXdJ28llak000' };
    localStorage.setItem('katcci_pay_helper_v1', JSON.stringify(st));
  });
  await page.reload();
  await page.waitForFunction(() => window.KAT_PUBLIC_PRICING !== undefined, null, { timeout: 10000 });
  await page.click(card('private') + ' [data-action="copy"]');
  const privPay2 = await clip(page);
  ok((await val(page, card('private') + ' input[data-field=link]')) === 'https://buy.stripe.com/aFa9AT8HS97hcEYattak008' && /aFa9AT8HS97hcEYattak008/.test(privPay2) && !/eVq3cve2c97hcEY7hhak003/.test(privPay2),
     'old Private link saved on this device is ignored; the new link is used');
  await page.click(card('ccl16') + ' [data-action="copy"]');
  ok(/4gM7sLaQ0cjt0Wg9ppak007/.test(await clip(page)), 'old CCL link saved on this device is ignored');

  // ── Staff tools (demo sign-in) ──
  await page.waitForSelector('text=DEMO MODE', { timeout: 10000 });
  await tap(page, '#signinBtn');
  await page.waitForSelector('#scheduleManager', { state: 'visible' });
  ok((await txt(page, '#mgrEmail')) === 'tony@katcci.com', 'signed in (demo) as tony@katcci.com and allowed');
  await page.waitForSelector('#rosterList .student-row');
  await page.waitForSelector('#rhList .student-row', { state: 'attached' });
  ok((await page.$$('#rosterList .student-row')).length === 4, "roster shows 4 sample students (incl. 2 historical Women's Class students)");
  ok(!(await page.$('#fType option[value=womens]')) && !(await page.$('#sType option[value=womens]')), "Add Class / Add Student: no Women's Class option for new entries");
  await page.waitForSelector('#classList .class-row');
  const rows = await page.$$eval('#classList .class-row', els => els.map(e => ({ t: e.textContent, edit: !!e.querySelector('[data-edit]'), del: !!e.querySelector('[data-del]') })));
  const wRows = rows.filter(r => /Women's Class \(retired\)/.test(r.t));
  ok(rows.length === 4 && wRows.length === 2 && wRows.every(r => !r.edit && r.del && /no online booking/.test(r.t) && !/\$125/.test(r.t)),
     "old Women's class records kept and listed as retired: no price, no edit, still deletable");
  ok(rows.some(r => /16-Hour CCL Certification · \$200/.test(r.t)) && rows.some(r => /3-Hour Renewal · \$140/.test(r.t)), 'schedule list: CCL $200, Renewal $140 from Class Pricing');
  await tap(page, '[data-sedit="s1"]');
  ok((await val(page, '#sType')) === 'womens' && /retired/.test(await page.$eval('#sType', e => e.selectedOptions[0].textContent)), "editing a historical Women's student keeps its class type");
  await tap(page, '#sCancelBtn');
  ok(!(await page.$('#sType option[value=womens]')) && (await val(page, '#sType')) === 'ccl', 'cancel: retired option removed again');
  ok((await page.$$('#rosterList [data-srev]')).length === 4, 'every roster row has a ⭐ Request Review button');
  ok((await page.$$('#rhList .student-row')).length === 2, 'history shows 2 sample requests');
  ok(/Review requested/.test(await page.$eval('[data-srev="s1"]', b => b.closest('.student-row').textContent)), 'roster badge shows Jordan already had a review request');
  ok((await val(page, '#rrUrl')) === DEMO_URL, 'review link pre-filled from settings/reviews');
  ok(!(await visible(page, '#rrLinked')), 'roster-student banner hidden on first load');

  // Quick copy
  ok(await visible(page, '#rqCard') && (await txt(page, '#rqText')) === HELLO(DEMO_URL), 'quick card shows the review message using the configured link');
  ok(!(await visible(page, '#rrCard')) && !(await visible(page, '#rhList')) && !(await visible(page, '#rsCard')), 'advanced review tools collapsed on load');
  ok((await txt(page, '#rrAdvToggle')) === '▸ Send & Track a Review Request', 'collapsed toggle label');
  const countBefore = await page.evaluate(() => window.__demoDb.reviewRequests.size);
  await page.click('#rqCopyBtn');
  ok((await clip(page)) === HELLO(DEMO_URL), 'Copy Review Message copies the exact message');
  ok(/✓ Review message copied/.test(await txt(page, '#toast')), 'shows "✓ Review message copied"');
  await page.waitForTimeout(400);
  ok((await page.evaluate(() => window.__demoDb.reviewRequests.size)) === countBefore, 'copying creates NO review history record');

  await tap(page, '#rrAdvToggle');
  ok(await visible(page, '#rrCard') && await visible(page, '#rhList') && await visible(page, '#rsCard'), 'toggle expands form, history and settings');
  await tap(page, '#rrAdvToggle');
  ok(!(await visible(page, '#rrCard')), 'toggle collapses again');

  // Request from roster
  await tap(page, '[data-srev="s1"]');
  ok(await visible(page, '#rrCard'), 'roster ⭐ opens the tracked form even when collapsed');
  ok((await val(page, '#rrName')) === 'Jordan Rivera' && (await val(page, '#rrPhone')) === '312-555-0101' && (await val(page, '#rrEmail')) === 'jordan.rivera@example.com', 'prefills name, phone, email');
  ok(await visible(page, '#rrLinked') && /Ref s1/.test(await txt(page, '#rrLinkedRef')), 'linked to roster with student reference');
  ok(await page.isChecked('input[name=rrMethod][value=sms]'), 'defaults to SMS when a phone number exists');
  const msg1 = await val(page, '#rrMessage');
  ok(msg1 === HELLO(DEMO_URL), 'tracked message built from the configured default + link');
  ok(await visible(page, '#rrDupe') && /Review request previously opened on/.test(await txt(page, '#rrDupe')), 'duplicate warning shown on the form');
  await page.fill('#rrMessage', msg1 + '\nThanks again!');
  await page.fill('#rrName', 'Jordan R.');
  ok((await val(page, '#rrMessage')).endsWith('Thanks again!'), 'hand-edited message is not overwritten');
  await tap(page, '#rrReviewBtn');
  ok(await visible(page, '#rcModal'), 'confirmation dialog opens');
  ok(/Review request previously opened on/.test(await txt(page, '#rcDupe')) && (await txt(page, '#rcSend')) === '↻ Send Again', 'dialog warns and offers Send Again');
  ok(/Roster student/.test(await txt(page, '#rcLinked')) && (await txt(page, '#rcUrl')) === DEMO_URL, 'dialog shows record link and review link');
  await page.fill('#rcMessage', 'No link here');
  ok(await visible(page, '#rcNoLink'), 'warns when the message has no review link');
  await page.fill('#rcMessage', 'Hi Jordan! Review us: ' + DEMO_URL);
  await tap(page, '#rcEdit');
  ok(!(await visible(page, '#rcModal')), 'Edit closes the dialog');
  await tap(page, '#rrReviewBtn');
  await tap(page, '#rcSend');
  const href1 = await page.evaluate(() => window.__demoLastOpened);
  ok(/^sms:3125550101[&?]body=/.test(href1) && decodeURIComponent(href1).includes('Hi Jordan! Review us'), 'opens sms: with normalized number and final message');
  await page.waitForFunction(() => document.querySelectorAll('#rhList .student-row').length === 3);
  const top = await page.$eval('#rhList .student-row', e => e.textContent);
  ok(/Jordan R\./.test(top) && /Opened in Messages/.test(top) && /Roster/.test(top) && /tony@katcci\.com/.test(top), 'history: Opened in Messages, Roster, requested by');
  ok(!/Sent|Delivered/.test(await txt(page, '#rhList')), 'history never says Sent or Delivered');
  let rec = await lastSaved(page);
  ok(rec.phone === '312-555-0101' && rec.phoneNormalized === '3125550101' && rec.emailNormalized === 'jordan.rivera@example.com' &&
     rec.method === 'sms' && rec.status === 'opened_sms' && rec.linked === 'student' && rec.studentId === 's1' && rec.requestedAt, 'saved record fields correct');

  // Manual request
  await tap(page, '#rrClearBtn');
  ok(!(await visible(page, '#rrLinked')), 'banner hidden after Clear Form');
  await page.fill('#rrPhone', '(312) 555-0199');
  ok((await val(page, '#rrMessage')) === HELLO(DEMO_URL), 'manual request uses the default review message');
  await page.fill('#rrName', 'Walk In Person');
  ok(!(await visible(page, '#rrLinked')) && !(await visible(page, '#rrDupe')) && !(await visible(page, '#rrMatch')), 'manual entry: no banner, no duplicate, no roster match');
  await tap(page, '#rrReviewBtn');
  ok(/Manual entry/.test(await txt(page, '#rcLinked')) && (await txt(page, '#rcSend')) === '💬 Open in Messages', 'manual request: Open in Messages');
  await tap(page, '#rcCancel');
  ok(!(await visible(page, '#rcModal')) && (await val(page, '#rrPhone')) === '(312) 555-0199', 'Cancel keeps the form');
  await tap(page, '#rrReviewBtn'); await tap(page, '#rcSend');
  await page.waitForFunction(() => document.querySelectorAll('#rhList .student-row').length === 4);
  rec = await lastSaved(page);
  ok(rec.linked === 'manual' && rec.studentId === null && rec.phoneNormalized === '3125550199', 'manual request saved as Manual');

  await page.fill('#rrEmail', 'Former.Student@Example.com');
  ok(await page.isChecked('input[name=rrMethod][value=email]') && await visible(page, '#rrDupe'), 'email-only → Email method; duplicate found by email');
  await tap(page, '#rrReviewBtn'); await tap(page, '#rcSend');
  ok((await page.evaluate(() => window.__demoLastOpened)).startsWith('mailto:Former.Student@Example.com?subject='), 'opens mailto: with subject and body');
  await page.waitForFunction(() => document.querySelectorAll('#rhList .student-row').length === 5);

  await page.fill('#rrPhone', '1 (773) 555 0103');
  ok(await visible(page, '#rrMatch') && /Taylor Brooks/.test(await txt(page, '#rrMatch')), 'suggests matching roster student');
  await tap(page, '#rrMatch [data-rrlink]');
  ok(await visible(page, '#rrLinked'), 'Link attaches the roster record');
  await tap(page, '#rrUnlink');
  ok(!(await visible(page, '#rrLinked')), 'Unlink hides the banner');
  await tap(page, '#rrClearBtn'); await tap(page, '#rrReviewBtn');
  ok(/10-digit mobile/.test(await txt(page, '#rrMsg')), 'empty form rejected');
  await page.fill('#rhSearch', '0199');
  ok((await page.$$('#rhList .student-row')).length === 1, 'history search by phone digits');
  await page.fill('#rhSearch', '');

  // Existing tools still work
  await page.fill('#fDate1', '2030-01-10'); await page.fill('#fDate2', '2030-01-11');
  await tap(page, '#saveBtn');
  await page.waitForFunction(() => /added/.test(document.getElementById('mgrMsg').textContent));
  ok((await page.$$('#classList .class-row')).length === 5, 'existing: add class still works');
  await page.fill('#sName', 'Test Person'); await page.fill('#sPhone', '312-555-0142');
  await tap(page, '#sSaveBtn');
  await page.waitForFunction(() => document.querySelectorAll('#rosterList .student-row').length === 5);
  ok(true, 'existing: add student still works');
  await tap(page, '#leadsList [data-ldel]');
  await page.waitForFunction(() => document.querySelectorAll('#leadsList .student-row').length === 1);
  ok(true, 'existing: delete lead still works');

  ok(log.firebase.length === 0, 'demo mode made ZERO requests to Firebase (' + log.firebase.length + ')');
  ok(log.errors.length === 0, 'no JavaScript errors' + (log.errors.length ? ': ' + log.errors.join(' | ') : ''));
  await ctx.close();

  // ── 2. Fresh demo: no review settings yet ──
  console.log('Demo mode (fresh)');
  ({ page, log, ctx } = await openPage(BASE + '?demo=fresh'));
  await page.waitForSelector('text=DEMO MODE', { timeout: 10000 });
  await tap(page, '#signinBtn');
  await page.waitForSelector('#rhList .mgr-hint:not(:empty)', { state: 'attached' });
  await page.waitForTimeout(400);
  ok((await txt(page, '#rqText')) === HELLO(REAL_URL), 'no settings saved: quick card uses the built-in default');
  await tap(page, '#rrAdvToggle');
  ok((await val(page, '#rsUrl')) === REAL_URL, 'settings pre-filled with the default link');
  await tap(page, '#rsCard > summary');
  await page.fill('#rsUrl', 'https://g.page/r/NEW-LINK/review');
  await page.fill('#rsMessage', 'Thanks {name}! Review: {link}');
  await tap(page, '#rsSaveBtn');
  await page.waitForFunction(() => /saved/.test(document.getElementById('rsMsg').textContent));
  await page.waitForTimeout(300);
  ok((await txt(page, '#rqText')) === 'Thanks there! Review: https://g.page/r/NEW-LINK/review', 'quick card follows saved settings');
  ok(log.firebase.length === 0 && log.errors.length === 0, 'fresh demo: no Firebase requests, no JS errors ' + log.errors.join(' | '));
  await ctx.close();

  // ── 3. Demo mode refused on non-preview hosts (local only) ──
  if (/localhost/.test(SITE)) {
    console.log('Non-preview host with ?demo');
    const port = new URL(SITE).port;
    ({ page, log, ctx } = await openPage(`http://staff.example.test:${port}/pay?demo`));
    await page.waitForTimeout(1500);
    ok(!log.demoJs && !(await page.isVisible('text=DEMO MODE')) && await page.isVisible('#signinCard'), 'demo mode refused; real sign-in shown');
    await ctx.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL STAFF CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
