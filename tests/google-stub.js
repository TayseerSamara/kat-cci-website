// Pages load the Google tag. Test runs must not send hits to the real Google Ads account,
// so Google tag/ads/analytics requests are answered locally (empty responses) and recorded.
const GOOGLE = /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|googleadservices\.com|doubleclick\.net|googlesyndication\.com)\/|^https:\/\/www\.google\.com\/(pagead|ccm|ads)\//;

async function stubGoogle(ctx, seen = []) {
  await ctx.route(GOOGLE, r => {
    seen.push(r.request().url());
    const js = r.request().resourceType() === 'script';
    r.fulfill({ status: js ? 200 : 204, contentType: js ? 'text/javascript' : 'text/plain', body: '' });
  });
  return seen;
}

module.exports = { stubGoogle, GOOGLE };
