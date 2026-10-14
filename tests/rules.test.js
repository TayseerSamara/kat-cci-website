// Firestore security rules (firestore.rules in this repo) checked with Google's Rules test API.
// Nothing is deployed. Needs tony@katcci.com signed in to the Firebase CLI; otherwise SKIPPED.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = 'katcci';
const D = '/databases/(default)/documents/';
let fails = 0;
const ok = (c, l) => { console.log((c ? '  ✔ ' : '  ✘ ') + l); if (!c) fails++; };

function token() {
  try {
    const c = require(path.join(os.homedir(), '.config/configstore/firebase-tools.json'));
    const a = [{ user: c.user, tokens: c.tokens }, ...(c.additionalAccounts || [])].find(x => x.user && x.user.email === 'tony@katcci.com');
    return a && a.tokens && Date.now() < a.tokens.expires_at - 60000 ? a.tokens.access_token : null;
  } catch (e) { return null; }
}
const who = (email, verified = true) => ({ uid: 'u-' + email, token: { email, email_verified: verified } });
const EDITOR = 'nora@katcci.com', TONY = 'tony@katcci.com', OTHER = 'someone@gmail.com';
const PR_OLD = { ccl16: 175, renewal3: 125, womens: 125, privateFrom: 200, updatedBy: EDITOR };
const PR_MATCH = { ...PR_OLD, ccl16Stripe: 175, renewal3Stripe: 125, womensStripe: 125 };
const PUB_OK = { privateFrom: 200, ccl16: 175, renewal3: 125, womens: 125 };
const PRICING = (o, by = EDITOR) => ({ ccl16: 175, renewal3: 125, womens: 125, privateFrom: 250, ccl16Stripe: 175, renewal3Stripe: 125, womensStripe: 125, updatedBy: by, ...o });

// [expect, user|null, method, path, data|undefined, label]
const CASES = [
  // settings/publicPricing — public read; editors write it only as a mirror of settings/pricing
  // (8th element = settings/pricing as it will be after the write, via getAfter; 'none' = missing)
  ['ALLOW', null, 'get', 'settings/publicPricing', undefined, 'public can read settings/publicPricing'],
  ['DENY', null, 'create', 'settings/publicPricing', PUB_OK, 'public cannot write it', true, PR_MATCH],
  ['DENY', OTHER, 'update', 'settings/publicPricing', PUB_OK, 'other Google accounts cannot write it', true, PR_MATCH],
  ['ALLOW', EDITOR, 'create', 'settings/publicPricing', PUB_OK, 'Nora: all matched → public prices 175/125/125, From 200', true, PR_MATCH],
  ['ALLOW', TONY, 'update', 'settings/publicPricing', { privateFrom: 200, ccl16: 185, renewal3: 125, womens: 125 }, 'tony@katcci.com: CCL 185 confirmed in Stripe → public 185', true, { ...PR_MATCH, ccl16: 185, ccl16Stripe: 185 }],
  ['ALLOW', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 200, ccl16: null, renewal3: 125, womens: 125 }, 'CCL website 185 vs Stripe 175 → public ccl16 null (paused)', true, { ...PR_MATCH, ccl16: 185 }],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 200, ccl16: 185, renewal3: 125, womens: 125 }, 'mismatch cannot be published as bookable', true, { ...PR_MATCH, ccl16: 185 }],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 200, ccl16: 150, renewal3: 125, womens: 125 }, 'public price different from saved pricing refused', true, PR_MATCH],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 200, ccl16: null, renewal3: 125, womens: 125 }, 'cannot null a matched class', true, PR_MATCH],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 275, ccl16: 175, renewal3: 125, womens: 125 }, 'privateFrom must equal saved pricing', true, PR_MATCH],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { ...PUB_OK, checkoutUrl: 'https://buy.stripe.com/x' }, 'extra field (e.g. a Stripe link) refused', true, PR_MATCH],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 200 }, 'missing regular fields refused', true, PR_MATCH],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 200, ccl16: 175, renewal3: 125, womens: 125 }, 'refused while settings/pricing lacks confirmed Stripe amounts (today\'s production doc)', true, PR_OLD],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', PUB_OK, 'refused when settings/pricing does not exist', true, 'none'],
  ['DENY', EDITOR, 'delete', 'settings/publicPricing', undefined, 'delete refused'],
  ['DENY', TONY, 'update', 'settings/publicPricing', PUB_OK, 'unverified editor email refused', false, PR_MATCH],
  // settings/pricing — editors only
  ['DENY', null, 'get', 'settings/pricing', undefined, 'public cannot read settings/pricing'],
  ['DENY', OTHER, 'get', 'settings/pricing', undefined, 'other accounts cannot read settings/pricing'],
  ['ALLOW', EDITOR, 'get', 'settings/pricing', undefined, 'editors can read settings/pricing'],
  ['DENY', null, 'update', 'settings/pricing', PRICING({}), 'public cannot write settings/pricing'],
  ['DENY', OTHER, 'update', 'settings/pricing', PRICING({}, OTHER), 'other accounts cannot write settings/pricing'],
  ['ALLOW', EDITOR, 'update', 'settings/pricing', PRICING({ ccl16: 185, ccl16Stripe: 185 }), 'Nora can save prices + confirmed Stripe amounts', true, undefined, true],
  ['ALLOW', EDITOR, 'update', 'settings/pricing', PRICING({ ccl16: 185 }), 'Nora can save a website/Stripe mismatch (booking then paused)', true, undefined, true],
  ['DENY', EDITOR, 'update', 'settings/pricing', { ccl16: 175, renewal3: 125, womens: 125, privateFrom: 250, updatedBy: EDITOR }, 'missing confirmed Stripe amounts refused', true, undefined, true],
  ['DENY', EDITOR, 'update', 'settings/pricing', PRICING({ ccl16Stripe: 0 }), 'zero Stripe amount refused', true, undefined, true],
  ['DENY', EDITOR, 'update', 'settings/pricing', PRICING({ womensStripe: '125' }), 'text Stripe amount refused', true, undefined, true],
  ['DENY', EDITOR, 'update', 'settings/pricing', PRICING({ ccl16: -5 }), 'invalid price refused', true, undefined, true],
  ['DENY', EDITOR, 'update', 'settings/pricing', PRICING({ checkoutUrl: 'https://buy.stripe.com/x' }), 'Stripe URL / extra field refused', true, undefined, true],
  ['DENY', EDITOR, 'update', 'settings/pricing', PRICING({}, OTHER), 'updatedBy must be the saving editor', true, undefined, true],
  // everything else unchanged
  ['ALLOW', null, 'get', 'classes/c1', undefined, 'classes: public read (unchanged)'],
  ['DENY', null, 'update', 'classes/c1', { price: 1 }, 'classes: public write denied (unchanged)'],
  ['ALLOW', EDITOR, 'update', 'classes/c1', { price: 175 }, 'classes: editors write (unchanged)'],
  ['DENY', null, 'get', 'students/s1', undefined, 'students: public denied (unchanged)'],
  ['ALLOW', TONY, 'get', 'students/s1', undefined, 'students: editors read (unchanged)'],
  ['DENY', null, 'get', 'leads/l1', undefined, 'leads: public read denied (unchanged)'],
  ['DENY', null, 'get', 'reviewRequests/r1', undefined, 'reviewRequests: public denied (unchanged)'],
  ['DENY', null, 'get', 'settings/reviews', undefined, 'settings/reviews: public denied (unchanged)'],
  ['DENY', null, 'get', 'settings/other', undefined, 'other settings documents locked'],
  ['DENY', EDITOR, 'get', 'anything/else', undefined, 'unknown collections locked']
];

(async () => {
  const t = token();
  if (!t) { console.log('  SKIPPED — tony@katcci.com is not signed in to the Firebase CLI (run: firebase login:add)'); process.exit(0); }
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');
  const testCases = CASES.map(([expectation, user, method, p, data, , verified, after, stamp]) => {
    const request = { path: D + p, method };
    if (user) request.auth = who(user, verified !== false);
    if (data !== undefined) request.resource = { data };
    // settings/pricing writes: updatedAt must be request.time.
    if (stamp) { request.time = '2026-10-13T12:00:00Z'; request.resource.data = { ...data, updatedAt: '2026-10-13T12:00:00Z' }; }
    const tc = { expectation, request };
    if (method !== 'create') tc.resource = { data: { privateFrom: 250, price: 175 } };
    if (after !== undefined) {
      const exists = after !== 'none';
      tc.functionMocks = [
        { function: 'existsAfter', args: [{ anyValue: {} }], result: { value: exists } },
        exists ? { function: 'getAfter', args: [{ anyValue: {} }], result: { value: { data: after } } }
               : { function: 'getAfter', args: [{ anyValue: {} }], result: { undefined: {} } }
      ];
    }
    return tc;
  });
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: src }] }, testSuite: { testCases } })
  }).then(r => r.json());
  if (res.error || (res.issues && res.issues.length)) { console.log(JSON.stringify(res.error || res.issues, null, 1)); process.exit(1); }
  CASES.forEach((c, i) => ok(res.testResults[i].state === 'SUCCESS', `${c[0]}  ${c[5]}`));
  console.log(fails ? `\n${fails} FAILED` : '\nALL RULES CHECKS PASSED (nothing deployed)');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
