// Regular (non-promotional) online booking for scheduled classes.
// Homepage class cards link to /reserve?class=<scheduled class id>. The reserve page loads that
// class record (date, time, type) from the public schedule, and takes the price and Stripe checkout
// ONLY from the table below — never from the URL. Promotional offers live in promos.js and are separate.
// Needs promos.js loaded first (shared ad-attribution handling).
(function () {
  // Trusted regular prices and approved Stripe Payment Links, keyed by schedule class type.
  // Keep in step with the staff page's DEFAULT_LINKS (pay.html) — the same approved links.
  var REGULAR = {
    ccl: {
      classKey: 'ccl16',                    // /reserve acknowledgments
      title: '16-Hour CCL Certification',
      price: 175,
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
      price: 125,
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
      price: 125,
      checkoutUrl: 'https://buy.stripe.com/eVqdR92ju6Z934odFFak001',
      paired: false,
      info: ['Course materials and eye & ear protection included']
    }
  };

  var PROJECT = 'katcci';
  var API_KEY = 'AIzaSyCSZwkehqzmMChhaW93uPScZ3GCIjqnO2E';   // public web key (same as the site's Firebase config)

  function chicagoToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  }

  // Online booking is offered only when the scheduled class's listed price matches the
  // trusted checkout price, so a customer is never charged a different amount than advertised.
  function entryFor(cls) {
    var e = cls && REGULAR[cls.type];
    if (!e || Number(cls.price) !== e.price) return null;
    return e;
  }

  function isBookable(cls) {
    return !!entryFor(cls) && !!cls.date1 && (cls.endDate || cls.date1) >= chicagoToday();
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
    var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT +
      '/databases/(default)/documents/classes/' + encodeURIComponent(id) + '?key=' + API_KEY;
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (doc) {
      if (!doc || !doc.fields) return null;
      var f = doc.fields, out = { id: id };
      ['type', 'date1', 'date2', 'endDate', 'time', 'price'].forEach(function (k) {
        var v = f[k];
        if (v) out[k] = v.stringValue != null ? v.stringValue : v.integerValue != null ? Number(v.integerValue) : v.doubleValue;
      });
      return out;
    }).catch(function () { return null; });
  }

  // Stripe link from the trusted table, plus utm_* and a client_reference_id — same method as promos.
  function checkoutUrl(cls, attr) {
    var e = entryFor(cls);
    return window.KAT_PROMOS.checkoutUrl({ id: 'class-' + cls.id, checkoutUrl: e.checkoutUrl }, attr);
  }

  // Regular price for a staff-texted link, only when its Stripe link is exactly the approved
  // regular checkout for that class (query string ignored). Otherwise null.
  function regularPriceFor(classKey, url) {
    var base;
    try { var u = new URL(url); base = u.origin + u.pathname; } catch (e) { return null; }
    for (var t in REGULAR) {
      if (REGULAR[t].classKey === classKey && REGULAR[t].checkoutUrl === base) return REGULAR[t].price;
    }
    return null;
  }

  window.KAT_BOOKING = {
    regularPriceFor: regularPriceFor,
    entryFor: entryFor,
    isBookable: isBookable,
    reserveUrl: reserveUrl,
    loadClass: loadClass,
    checkoutUrl: checkoutUrl
  };
})();
