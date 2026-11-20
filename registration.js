// Registration confirmation emails (EmailJS) for regular scheduled-class bookings.
//
// /reserve collects the customer's name, email and mobile number for a scheduled class and, when they
// press "Continue to Secure Payment", stores a short-lived pending registration together with the
// trusted class details and amount (from booking.js / settings/publicPricing — never the URL).
// /confirmed (Stripe's success redirect, ?session_id=cs_...) then sends two EmailJS templates:
// the customer confirmation and Nora's notification. Each template is sent at most once per Stripe
// Checkout Session in this browser; the pending registration is cleared once both have been sent.
//
// Storage:
//   sessionStorage katcci_pending_registration  contact details + class; this tab only, 6-hour limit
//   localStorage   katcci_emails_sent           { sessionId: { customer: true, nora: true } } — no PII
// Customer details never go into a URL and are never written to the console.
(function () {
  var KEY = 'katcci_pending_registration';
  var SENT = 'katcci_emails_sent';
  var MAX_AGE = 6 * 60 * 60 * 1000;   // same window as the pending Google Ads purchase

  // EmailJS (public browser API; public key only — no private key is used or needed).
  var EMAILJS = {
    url: 'https://api.emailjs.com/api/v1.0/email/send',
    serviceId: 'service_h37afn8',
    publicKey: 'VzxulypxbsMUri30R',
    templates: { customer: 'template_fo25dsd', nora: 'template_we6n1w6' }
  };
  var CLASS_KEYS = ['ccl16', 'renewal3'];   // regular classes with online booking

  // ── Validation ──
  function cleanName(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function validName(v) {
    var s = cleanName(v);
    return s.length >= 2 && s.length <= 100 && (s.match(/\p{L}/gu) || []).length >= 2 && !/[<>{}\[\]\\\/@=;:|$#%^*_~`"]|\d/.test(s);
  }
  function cleanEmail(v) { return String(v == null ? '' : v).trim(); }
  function validEmail(v) {
    var s = cleanEmail(v);
    return s.length <= 254 && /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/.test(s) &&
      !/\.\./.test(s);
  }
  // US mobile number: 10 digits (optional leading 1 / +1); area code and exchange can't start with 0/1.
  function phoneDigits(v) {
    var s = String(v == null ? '' : v);
    if (/[^\d\s()+.\-]/.test(s)) return null;
    var d = s.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? d : null;
  }
  function validPhone(v) { return !!phoneDigits(v); }
  function formatPhone(v) { var d = phoneDigits(v); return d ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : ''; }
  function validContact(r) { return !!r && validName(r.customer_name) && validEmail(r.customer_email) && validPhone(r.customer_phone); }

  // ── Pending registration (sessionStorage, short-lived) ──
  function save(r) {
    try { sessionStorage.setItem(KEY, JSON.stringify(r)); return true; } catch (e) { return false; }
  }
  function clear() { try { sessionStorage.removeItem(KEY); } catch (e) {} }
  // The stored registration, or null (missing, malformed, expired or for an unknown class → removed).
  function read() {
    var r = null;
    try { r = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { r = null; }
    if (!r) { clear(); return null; }
    var fresh = typeof r.at === 'number' && Date.now() - r.at >= 0 && Date.now() - r.at < MAX_AGE;
    if (!fresh || CLASS_KEYS.indexOf(r.classKey) === -1 || typeof r.amount !== 'number' || !validContact(r)) { clear(); return null; }
    return r;
  }

  // ── Per-session, per-template "sent" record (no personal details) ──
  function sentFor(sessionId) {
    try {
      var all = JSON.parse(localStorage.getItem(SENT) || '{}') || {};
      var s = all[sessionId] || {};
      return { customer: s.customer === true, nora: s.nora === true };
    } catch (e) { return { customer: false, nora: false }; }
  }
  function markSent(sessionId, which) {
    try {
      var all = JSON.parse(localStorage.getItem(SENT) || '{}') || {};
      all[sessionId] = all[sessionId] || {};
      all[sessionId][which] = true;
      all[sessionId].at = Date.now();
      var ids = Object.keys(all).sort(function (a, b) { return (all[a].at || 0) - (all[b].at || 0); });
      while (ids.length > 20) delete all[ids.shift()];
      localStorage.setItem(SENT, JSON.stringify(all));
    } catch (e) {}
  }

  function money(n) { return '$' + (Number.isInteger(n) ? n : n.toFixed(2)); }
  // Exactly the variables both EmailJS templates use.
  function templateParams(r, sessionId) {
    return {
      customer_name: cleanName(r.customer_name),
      customer_email: cleanEmail(r.customer_email),
      customer_phone: formatPhone(r.customer_phone),
      class_name: r.class_name,
      class_date: r.class_date,
      class_time: r.class_time,
      amount: money(r.amount),
      session_id: sessionId
    };
  }
  // One EmailJS send. Resolves true only on an HTTP 2xx from EmailJS; never rejects.
  function sendTemplate(which, params) {
    return fetch(EMAILJS.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: EMAILJS.serviceId, template_id: EMAILJS.templates[which], user_id: EMAILJS.publicKey, template_params: params })
    }).then(function (res) { return res.ok; }).catch(function () { return false; });
  }

  // Clean up an expired / invalid pending registration on any page that loads this file.
  read();

  window.KAT_REGISTRATION = {
    MAX_AGE: MAX_AGE,
    CLASS_KEYS: CLASS_KEYS,
    EMAILJS: EMAILJS,
    cleanName: cleanName, cleanEmail: cleanEmail,
    validName: validName, validEmail: validEmail, validPhone: validPhone, formatPhone: formatPhone, validContact: validContact,
    save: save, read: read, clear: clear,
    sentFor: sentFor, markSent: markSent,
    templateParams: templateParams, sendTemplate: sendTemplate
  };
})();
