// Promotional offers shown in the homepage popup (once per browser session) and
// confirmed on the /reserve page. Regular class prices elsewhere on the site are
// unchanged. Ad parameters (utm_*, gclid, ...) are carried to Stripe when present.
//
// Labels: `badge` is the headline tag; a percentage ("20% OFF") is shown only when
// showPercent is true, so no promo claims a percentage unless it is set on purpose.
//
// A promo only appears when:
//   • checkoutUrl is set to a KAT Stripe Payment Link that charges exactly `price`, and
//   • today (Chicago time) is on or before `showUntil`.
// Leave checkoutUrl empty to keep a promo switched off.
(function () {
  var PROMOS = [
    {
      id: 'ccl-2026-10-17',
      classKey: 'ccl16',                    // matches /reserve acknowledgments
      title: '16-Hour CCL Certification',
      dates: 'Sat, Oct 17 & Sun, Oct 18',
      time: '10:00 AM',
      showUntil: '2026-10-16',              // last day to book (day before class)
      regular: 175,
      price: 160,                           // save $15 (about 8.6%), so no percentage shown
      badge: 'SPECIAL PROMO',
      showPercent: false,
      fineprint: '+ $150 state fee',
      checkoutUrl: 'https://buy.stripe.com/bJe28rcY86Z9cEYeJJak005'   // $160.00 (verified)
    },
    {
      id: 'womens-2026-10-24',
      classKey: 'womens',
      title: "Women's Class",
      dates: 'Sat, Oct 24',
      time: '12:00 PM',
      showUntil: '2026-10-23',
      regular: 125,
      price: 100,
      showPercent: true,                    // exactly 20% off
      fineprint: '',
      checkoutUrl: 'https://buy.stripe.com/4gM5kD6zK4R15cwbxxak006'   // $100.00 (verified)
    }
  ];

  // Campaign wording used by the homepage popup and its reopen button.
  var CAMPAIGN = {
    note: 'Limited-time website promotion — book through this offer to receive the promotional price.',
    buttonLabel: '🎉 October Special — View Offers'
  };

  // Ad / campaign parameters carried from the landing page through to Stripe.
  var ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                          'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid'];
  var STRIPE_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid'];
  var STORAGE_KEY = 'katcci_attribution';

  function chicagoToday() {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  }

  function isStripeCheckout(url) {
    try {
      var u = new URL(url);
      return u.protocol === 'https:' &&
        (u.hostname === 'buy.stripe.com' || u.hostname === 'checkout.stripe.com');
    } catch (e) { return false; }
  }

  function isActive(p) {
    return !!p && isStripeCheckout(p.checkoutUrl) && chicagoToday() <= p.showUntil;
  }

  function withSavings(p) {
    var out = {};
    for (var k in p) out[k] = p[k];
    out.save = p.regular - p.price;
    out.percentOff = Math.round((1 - p.price / p.regular) * 100);
    out.percentLabel = p.showPercent ? out.percentOff + '% OFF' : '';
    out.badgeText = p.badge || out.percentLabel || 'SPECIAL PROMO';
    return out;
  }

  function activePromos() {
    return PROMOS.filter(isActive).map(withSavings);
  }

  function findActive(id) {
    for (var i = 0; i < PROMOS.length; i++) {
      if (PROMOS[i].id === id) return isActive(PROMOS[i]) ? withSavings(PROMOS[i]) : null;
    }
    return null;
  }

  // Attribution from the current URL, falling back to what this visit stored earlier.
  function readAttribution() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = {};
    ATTRIBUTION_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) fromUrl[k] = v.slice(0, 500);
    });
    var stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) {}
    if (Object.keys(fromUrl).length) {
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fromUrl)); } catch (e) {}
      return fromUrl;
    }
    return stored;
  }

  function reserveUrl(p, attr) {
    var q = new URLSearchParams({ promo: p.id });
    ATTRIBUTION_KEYS.forEach(function (k) { if (attr && attr[k]) q.set(k, attr[k]); });
    return '/reserve?' + q.toString();
  }

  // Stripe Payment Links accept utm_* (shown in Stripe's reports) and a
  // client_reference_id (letters, digits, - and _ only, up to 200 characters).
  function checkoutUrl(p, attr) {
    var u = new URL(p.checkoutUrl);
    STRIPE_UTM_KEYS.forEach(function (k) { if (attr && attr[k]) u.searchParams.set(k, attr[k]); });
    var ref = p.id;
    for (var i = 0; i < CLICK_ID_KEYS.length; i++) {
      var id = attr && attr[CLICK_ID_KEYS[i]];
      if (id) { ref += '__' + CLICK_ID_KEYS[i] + '_' + id; break; }
    }
    u.searchParams.set('client_reference_id', ref.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200));
    return u.toString();
  }

  window.KAT_PROMOS = {
    campaign: CAMPAIGN,
    activePromos: activePromos,
    findActive: findActive,
    readAttribution: readAttribution,
    reserveUrl: reserveUrl,
    checkoutUrl: checkoutUrl
  };
})();
