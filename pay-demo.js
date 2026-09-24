// Demo / test mode for the staff page (pay.html).
//
// Loaded only when pay.html is opened with ?demo on localhost or a Firebase
// preview channel. It stands in for Firebase Auth and Firestore with an
// in-memory copy of sample data, so the staff tools can be exercised without
// reading or writing the real database. Nothing here talks to Firebase, and
// everything resets when the page is reloaded.
//
//   ?demo        sample classes, students, leads, review history and settings
//   ?demo=fresh  same, but no review settings and no review history yet

const FRESH = new URLSearchParams(location.search).get('demo') === 'fresh';

// ── Timestamps ──
class DemoTimestamp {
  constructor(ms) { this.ms = ms; }
  toDate() { return new Date(this.ms); }
  toMillis() { return this.ms; }
}
const SERVER_TS = { __demoServerTimestamp: true };
const DAY = 86400000;
const ts = daysAgo => new DemoTimestamp(Date.now() - daysAgo * DAY);

function isoInDays(n) {
  const d = new Date(Date.now() + n * DAY);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// ── Sample data (555-01xx numbers and example.com addresses only) ──
const seed = {
  classes: {
    c1: { type: 'ccl', date1: isoInDays(9), date2: isoInDays(10), endDate: isoInDays(10), time: '09:00', price: 175, createdAt: ts(12), updatedAt: ts(12) },
    c2: { type: 'renewal', date1: isoInDays(16), date2: '', endDate: isoInDays(16), time: '18:00', price: 125, createdAt: ts(8), updatedAt: ts(8) },
    c3: { type: 'womens', date1: isoInDays(-5), date2: '', endDate: isoInDays(-5), time: '10:00', price: 125, createdAt: ts(30), updatedAt: ts(30) }
  },
  students: {
    s1: { name: 'Jordan Rivera', phone: '312-555-0101', email: 'jordan.rivera@example.com', classType: 'womens', classDate: isoInDays(-5), paid: 'paid', payMethod: 'Card', waiver: true, notes: '', source: 'manual', createdAt: ts(20), updatedAt: ts(20) },
    s2: { name: 'Casey Morgan', phone: '(708) 555-0102', email: '', classType: 'womens', classDate: isoInDays(-5), paid: 'paid', payMethod: 'Zelle', waiver: true, notes: '', source: 'manual', createdAt: ts(19), updatedAt: ts(19) },
    s3: { name: 'Taylor Brooks', phone: '773.555.0103', email: 'taylor.b@example.com', classType: 'ccl', classDate: isoInDays(9), paid: 'pending', payMethod: '', waiver: false, notes: 'needs rental firearm', source: 'manual', createdAt: ts(3), updatedAt: ts(3) },
    s4: { name: 'Sam Patel', phone: '+1 312 555 0104', email: 'sam.patel@example.com', classType: 'private', classDate: isoInDays(-12), paid: 'paid', payMethod: 'Cash', waiver: true, notes: '', source: 'manual', createdAt: ts(15), updatedAt: ts(15) }
  },
  leads: {
    l1: { name: 'Alex Kim', phone: '312-555-0110', classType: '3-Hour Renewal', message: 'When is the next renewal class?', createdAt: ts(1) },
    l2: { name: 'Robin Lee', phone: '630-555-0111', classType: 'Not sure yet', message: '', createdAt: ts(4) }
  },
  reviewRequests: FRESH ? {} : {
    r1: { name: 'Jordan Rivera', phone: '312-555-0101', email: 'jordan.rivera@example.com',
          phoneNormalized: '3125550101', emailNormalized: 'jordan.rivera@example.com', method: 'sms',
          message: 'Hi Jordan, thank you for training with KAT CCI! …', reviewUrl: 'https://g.page/r/DEMO-ONLY/review',
          requestedAt: ts(3), requestedBy: 'nora@katcci.com', studentId: 's1', linked: 'student', status: 'opened_sms' },
    // r2 predates the normalized fields, to exercise the fallback.
    r2: { name: '', phone: '', email: 'Former.Student@example.com ', method: 'email',
          message: 'Hi there, thank you for training with KAT CCI! …', reviewUrl: 'https://g.page/r/DEMO-ONLY/review',
          requestedAt: ts(40), requestedBy: 'tony@midwayspeedpark.com', studentId: null, linked: 'manual', status: 'opened_email' }
  },
  settings: FRESH ? {} : {
    reviews: {
      googleReviewUrl: 'https://g.page/r/DEMO-ONLY/review',
      defaultMessage: 'Hello, thank you for training with KAT CCI! If you have a minute, we would really appreciate a quick Google review. It helps other students find us:\n\n{link}\n\n— Kat CCI',
      updatedAt: ts(10), updatedBy: 'nora@katcci.com'
    }
  }
};

const db = {};
for (const [name, docs] of Object.entries(seed)) db[name] = new Map(Object.entries(docs));
window.__demoDb = db;   // lets automated tests inspect what would have been saved

// ── Refs & queries ──
const clone = obj => ({ ...obj });
let nextId = 1;

function resolveServerTimestamps(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) out[k] = v === SERVER_TS ? new DemoTimestamp(Date.now()) : v;
  return out;
}

function sortValue(v) {
  if (v instanceof DemoTimestamp) return v.ms;
  return v == null ? '' : v;
}

function runQuery(ref) {
  const coll = db[ref.path] || new Map();
  let rows = [...coll.entries()].map(([id, data]) => ({ id, data }));
  for (const c of ref.constraints || []) {
    if (c.type === 'orderBy') {
      const dir = c.dir === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const x = sortValue(a.data[c.field]), y = sortValue(b.data[c.field]);
        return x < y ? -dir : x > y ? dir : 0;
      });
    }
  }
  return rows;
}

function snapshotFor(ref) {
  if (ref.kind === 'doc') {
    const data = (db[ref.path] || new Map()).get(ref.id);
    return { id: ref.id, exists: () => !!data, data: () => (data ? clone(data) : undefined) };
  }
  const docs = runQuery(ref).map(r => ({ id: r.id, data: () => clone(r.data) }));
  return { docs, size: docs.length, empty: !docs.length };
}

const listeners = new Set();
function notify(path) {
  for (const l of listeners) {
    if (l.ref.path === path) setTimeout(() => l.active && l.next(snapshotFor(l.ref)), 0);
  }
}

// Short delay so the UI behaves like a real network round trip.
const later = (fn, ms = 250) => new Promise((resolve, reject) =>
  setTimeout(() => { try { resolve(fn()); } catch (e) { reject(e); } }, ms));

export const store = {
  getFirestore: () => ({ demo: true }),
  collection: (_db, path) => ({ kind: 'collection', path }),
  doc: (_db, path, id) => ({ kind: 'doc', path, id }),
  query: (ref, ...constraints) => ({ ...ref, constraints }),
  orderBy: (field, dir = 'asc') => ({ type: 'orderBy', field, dir }),
  serverTimestamp: () => SERVER_TS,

  onSnapshot(ref, next) {
    const l = { ref, next, active: true };
    listeners.add(l);
    setTimeout(() => l.active && next(snapshotFor(ref)), 150);
    return () => { l.active = false; listeners.delete(l); };
  },

  addDoc: (ref, data) => later(() => {
    const id = 'demo' + (nextId++);
    (db[ref.path] = db[ref.path] || new Map()).set(id, resolveServerTimestamps(data));
    notify(ref.path);
    return { id };
  }),

  setDoc: (ref, data, opts) => later(() => {
    const coll = (db[ref.path] = db[ref.path] || new Map());
    const base = opts && opts.merge ? (coll.get(ref.id) || {}) : {};
    coll.set(ref.id, { ...base, ...resolveServerTimestamps(data) });
    notify(ref.path);
  }),

  updateDoc: (ref, data) => later(() => {
    const coll = db[ref.path] || new Map();
    if (!coll.has(ref.id)) throw new Error('No document to update (demo).');
    coll.set(ref.id, { ...coll.get(ref.id), ...resolveServerTimestamps(data) });
    notify(ref.path);
  }),

  deleteDoc: ref => later(() => {
    (db[ref.path] || new Map()).delete(ref.id);
    notify(ref.path);
  })
};

// ── Auth ──
let currentUser = null;
const authListeners = new Set();
function notifyAuth() { for (const cb of authListeners) setTimeout(() => cb(currentUser), 0); }

export const auth = {
  getAuth: () => ({ demo: true }),
  GoogleAuthProvider: class {},
  signInWithPopup: () => later(() => {
    currentUser = { email: 'tony@katcci.com', displayName: 'Demo Staff', emailVerified: true };
    notifyAuth();
    return { user: currentUser };
  }, 200),
  signOut: () => later(() => { currentUser = null; notifyAuth(); }, 50),
  onAuthStateChanged(_auth, cb) {
    authListeners.add(cb);
    setTimeout(() => cb(currentUser), 0);
    return () => authListeners.delete(cb);
  }
};

// ── Banner ──
const banner = document.createElement('div');
banner.setAttribute('role', 'status');
banner.style.cssText = 'position:sticky;top:0;z-index:200;margin:-16px -16px 16px;padding:10px 16px;' +
  'background:#1d4ed8;color:#fff;font-size:.82rem;font-weight:700;text-align:center;line-height:1.4;';
banner.textContent = '🧪 DEMO MODE: sample data only. Nothing is read from or saved to Firebase, and it all resets on reload.' +
  (FRESH ? ' (Fresh start: no review settings or history yet.)' : '');
const opened = document.createElement('div');
opened.style.cssText = 'margin-top:4px;font-weight:600;font-family:Menlo,monospace;font-size:.72rem;' +
  'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9;';
banner.appendChild(opened);
document.body.prepend(banner);

// Called by pay.html right before it opens an sms:/mailto: link, so the link is
// visible even on a computer with no texting app.
export function noteOpened(href) {
  window.__demoLastOpened = href;
  opened.textContent = 'Last link opened: ' + decodeURIComponent(href);
}
