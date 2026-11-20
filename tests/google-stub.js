// Pages load the Google tag. Test runs must not send hits to the real Google Ads account,
// so Google tag/ads/analytics requests are answered locally (empty responses) and recorded.
// EmailJS is answered locally too ("OK"), so no test run can ever send a real email; suites that
// need to inspect or fail EmailJS calls install their own route afterwards (it takes precedence).
const GOOGLE = /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|googleadservices\.com|doubleclick\.net|googlesyndication\.com)\/|^https:\/\/www\.google\.com\/(pagead|ccm|ads)\//;
const EMAILJS = /^https:\/\/([a-z0-9-]+\.)*emailjs\.com\//;

async function stubGoogle(ctx, seen = []) {
  await ctx.route(EMAILJS, r => r.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' }));
  await ctx.route(GOOGLE, r => {
    seen.push(r.request().url());
    const js = r.request().resourceType() === 'script';
    r.fulfill({ status: js ? 200 : 204, contentType: js ? 'text/javascript' : 'text/plain', body: '' });
  });
  return seen;
}

// Contact details on /reserve (scheduled-class bookings), when the page shows them.
const CONTACT = { name: 'Test Customer', email: 'test.customer@example.com', phone: '312-555-0142' };
async function fillContact(page, c = CONTACT) {
  if (!(await page.isVisible('#contactBlock'))) return false;
  await page.fill('#custName', c.name);
  await page.fill('#custEmail', c.email);
  await page.fill('#custPhone', c.phone);
  return true;
}

module.exports = { stubGoogle, GOOGLE, EMAILJS, CONTACT, fillContact };
