// Regular (non-promotional) online booking for scheduled classes.
// Homepage class cards link to /reserve?class=<scheduled class id>. The reserve page loads that
// class record (type, dates, time) from the public schedule. The Stripe checkout URL comes ONLY from
// the table below — never from the URL or Firestore. The tuition comes ONLY from settings/publicPricing
// (one price per class type), which publishes a regular price only when the saved website price equals
// the Stripe amount an editor has confirmed in Class Pricing (enforced by the Firestore rules). A class
// record's own legacy `price` field is ignored for these fixed-price types. Promotions live in
// promos.js and are separate. Needs promos.js loaded first for checkoutUrl (ad attribution).
(function () {
  // Trusted approved Stripe Payment Links (fixed), keyed by schedule class type.
  // Keep in step with the staff page's DEFAULT_LINKS (pay.html) — the same approved links.
  var REGULAR = {
    ccl: {
      classKey: 'ccl16',                    // /reserve acknowledgments + pricing field
      title: '16-Hour CCL Certification',
      checkoutUrl: 'https://buy.stripe.com/14A5kDf6g3MXdJ28llak000',
      paired: true,
      info: ['+ $150 Illinois state fee, paid separately to ISP',
             'Day 2 range fees: $23 lane fee + $6 range waiver, paid at the range',
             'Firearm rental with ammo: $25 (optional)',
             'Eye & ear protection included']
    },
    renewal: {
      classKey: 'renewal3',
      title: '3-Hour CCL Renewal',
      checkoutUrl: 'https://buy.stripe.com/6oU7sLgakcjt34ocBBak002',
      paired: false,
      info: ['+ $150 Illinois state renewal fee, paid separately to ISP',
             'Range fees: $23 lane fee + $6 range waiver, paid on-site',
             'Firearm rental with ammo: $25 (optional)',
             'Eye & ear protection included']
    },
    womens: {
      classKey: 'womens',
      title: "Women's Class",
      checkoutUrl: 'https://buy.stripe.com/eVqdR92ju6Z934odFFak001',
      paired: false,
      info: ['Course materials and eye & ear protection included']
    }
  };

  var PROJECT = 'katcci';
  var API_KEY = 'AIzaSyCSZwkehqzmMChhaW93uPScZ3GCIjqnO2E';   // public web key (same as the site's Firebase config)
  var DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/';

  function chicagoToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  }

  // A usable price: positive, at most 2 decimals, below 100,000.
  function validPrice(v) {
    return typeof v === 'number' && isFinite(v) && v > 0 && v < 100000 && Math.abs(Math.round(v * 100) - v * 100) < 1e-9;
  }

  function fieldValue(v) {
    if (!v) return undefined;
    if (v.nullValue !== undefined) return null;
    if (v.stringValue != null) return v.stringValue;
    if (v.integerValue != null) return Number(v.integerValue);
    if (v.doubleValue != null) return v.doubleValue;
    return undefined;
  }

  // Public pricing: { privateFrom, ccl16, renewal3, womens } — a regular value is present only when
  // that class can be booked online at that price; null means online booking is paused.
  var publicPricingPromise = null;
  function loadPublicPricing() {
    if (!publicPricingPromise) {
      publicPricingPromise = fetch(DOCS + 'settings/publicPricing?key=' + API_KEY)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (doc) {
          if (!doc || !doc.fields) return null;
          var out = {};
          ['privateFrom', 'ccl16', 'renewal3', 'womens'].forEach(function (k) { out[k] = fieldValue(doc.fields[k]); });
          return out;
        })
        .catch(function () { return null; });
    }
    return publicPricingPromise;
  }

  // Current online-bookable price for a class type, or null when booking is paused.
  function bookablePrice(type, pub) {
    var e = REGULAR[type];
    var v = e && pub ? pub[e.classKey] : null;
    return validPrice(v) ? v : null;
  }

  // Online booking at the class type's current published price (the class record's legacy price is
  // not used). No published price (website ≠ confirmed Stripe amount, or unreadable) → not bookable.
  function entryFor(cls, pub) {
    var e = cls && REGULAR[cls.type];
    var price = cls ? bookablePrice(cls.type, pub) : null;
    if (!e || price == null) return null;
    return { classKey: e.classKey, title: e.title, checkoutUrl: e.checkoutUrl, paired: e.paired, info: e.info, price: price };
  }

  function isBookable(cls, pub) {
    return !!entryFor(cls, pub) && !!cls.date1 && (cls.endDate || cls.date1) >= chicagoToday();
  }

  function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9]{1,64}$/.test(id); }

  // /reserve link for one scheduled class, carrying this visit's ad parameters.
  function reserveUrl(id, attr) {
    var q = new URLSearchParams({ class: id });
    Object.keys(attr || {}).forEach(function (k) { q.set(k, attr[k]); });
    return '/reserve?' + q.toString();
  }

  // Read one scheduled class from the public schedule (Firestore REST, read-only).
  function loadClass(id) {
    if (!validId(id)) return Promise.resolve(null);
    return fetch(DOCS + 'classes/' + encodeURIComponent(id) + '?key=' + API_KEY)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) {
        if (!doc || !doc.fields) return null;
        var out = { id: id };
        ['type', 'date1', 'date2', 'endDate', 'time', 'price'].forEach(function (k) {
          var v = fieldValue(doc.fields[k]);
          if (v != null) out[k] = v;
        });
        return out;
      }).catch(function () { return null; });
  }

  // Stripe link from the trusted table, plus utm_* and a client_reference_id — same method as promos.
  function checkoutUrl(cls, pub, attr) {
    var e = entryFor(cls, pub);
    return window.KAT_PROMOS.checkoutUrl({ id: 'class-' + cls.id, checkoutUrl: e.checkoutUrl }, attr);
  }

  // Price for a staff-texted link, only when its Stripe link is exactly the approved regular checkout
  // for that class (query string ignored) and that class is currently bookable. Otherwise null.
  function regularPriceFor(classKey, url, pub) {
    var base;
    try { var u = new URL(url); base = u.origin + u.pathname; } catch (e) { return null; }
    for (var t in REGULAR) {
      if (REGULAR[t].classKey === classKey && REGULAR[t].checkoutUrl === base) return bookablePrice(t, pub);
    }
    return null;
  }

  // Approved regular checkouts per schedule class type: { ccl: { classKey, checkoutUrl, title }, ... }.
  // URLs only — amounts are confirmed by editors in Class Pricing.
  function regularCheckouts() {
    var out = {};
    Object.keys(REGULAR).forEach(function (t) {
      out[t] = { classKey: REGULAR[t].classKey, checkoutUrl: REGULAR[t].checkoutUrl, title: REGULAR[t].title };
    });
    return out;
  }

  // Homepage Private card "From $___" from settings/publicPricing.privateFrom. Missing/invalid → $250.
  var PRIVATE_FROM_FALLBACK = 250;
  function showPrivateFrom(data) {
    var el = document.getElementById('ucPrivatePrice');
    if (!el) return;
    var v = data && data.privateFrom;
    var n = validPrice(v) ? v : PRIVATE_FROM_FALLBACK;
    el.textContent = 'From $' + (Number.isInteger(n) ? n : n.toFixed(2));
  }

  window.KAT_BOOKING = {
    loadPublicPricing: loadPublicPricing,
    bookablePrice: bookablePrice,
    validPrice: validPrice,
    showPrivateFrom: showPrivateFrom,
    regularCheckouts: regularCheckouts,
    regularPriceFor: regularPriceFor,
    entryFor: entryFor,
    isBookable: isBookable,
    reserveUrl: reserveUrl,
    loadClass: loadClass,
    checkoutUrl: checkoutUrl
  };
})();
