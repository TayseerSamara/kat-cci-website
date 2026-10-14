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

// [expect, user|null, method, path, data|undefined, label]
const CASES = [
  // settings/publicPricing — public read; editors write privateFrom only
  ['ALLOW', null, 'get', 'settings/publicPricing', undefined, 'public can read settings/publicPricing'],
  ['DENY', null, 'create', 'settings/publicPricing', { privateFrom: 275 }, 'public cannot write it'],
  ['DENY', OTHER, 'update', 'settings/publicPricing', { privateFrom: 275 }, 'other Google accounts cannot write it'],
  ['ALLOW', EDITOR, 'create', 'settings/publicPricing', { privateFrom: 275 }, 'Nora can write { privateFrom: 275 }'],
  ['ALLOW', TONY, 'update', 'settings/publicPricing', { privateFrom: 275.5 }, 'tony@katcci.com can write { privateFrom: 275.5 }'],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 275, checkoutUrl: 'https://buy.stripe.com/x' }, 'extra field (e.g. a Stripe link) refused'],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 275, ccl16: 175 }, 'other prices refused in the public document'],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: -1 }, 'negative price refused'],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: 0 }, 'zero refused'],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', { privateFrom: '275' }, 'text instead of a number refused'],
  ['DENY', EDITOR, 'update', 'settings/publicPricing', {}, 'missing privateFrom refused'],
  ['DENY', EDITOR, 'delete', 'settings/publicPricing', undefined, 'delete refused'],
  ['DENY', TONY, 'update', 'settings/publicPricing', { privateFrom: 275 }, 'unverified editor email refused', false],
  // settings/pricing — editors only
  ['DENY', null, 'get', 'settings/pricing', undefined, 'public cannot read settings/pricing'],
  ['DENY', OTHER, 'get', 'settings/pricing', undefined, 'other accounts cannot read settings/pricing'],
  ['ALLOW', EDITOR, 'get', 'settings/pricing', undefined, 'editors can read settings/pricing'],
  ['DENY', null, 'update', 'settings/pricing', { ccl16: 175, renewal3: 125, womens: 125, privateFrom: 250 }, 'public cannot write settings/pricing'],
  ['DENY', EDITOR, 'update', 'settings/pricing', { ccl16: -5, renewal3: 125, womens: 125, privateFrom: 250, updatedBy: EDITOR }, 'invalid price refused'],
  ['DENY', EDITOR, 'update', 'settings/pricing', { ccl16: 175, renewal3: 125, womens: 125, privateFrom: 250, checkoutUrl: 'x', updatedBy: EDITOR }, 'extra field refused'],
  ['DENY', EDITOR, 'update', 'settings/pricing', { ccl16: 175, renewal3: 125, womens: 125, privateFrom: 250, updatedBy: OTHER }, 'updatedBy must be the saving editor'],
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
  const testCases = CASES.map(([expectation, user, method, p, data, , verified]) => {
    const request = { path: D + p, method };
    if (user) request.auth = who(user, verified !== false);
    if (data !== undefined) request.resource = { data };
    const tc = { expectation, request };
    if (method !== 'create') tc.resource = { data: { privateFrom: 250, price: 175 } };
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
