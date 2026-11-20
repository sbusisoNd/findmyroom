'use strict';
const express = require('express');
const multer = require('multer');
const compression = require('compression');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const cfg = require('./config');
const store = require('./db');
const { seedDemo } = require('./seed');

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
const PROV = ['Gauteng', 'Mpumalanga', 'Limpopo', 'KwaZulu-Natal', 'Western Cape', 'Eastern Cape', 'Free State', 'North West', 'Northern Cape'];
const TYPES = ['Backroom', 'Room in House', 'Flat', 'Sharing', 'Student Room'];
const INCL = ['Water', 'Electricity', 'WiFi', 'Private Toilet', 'Shared Toilet', 'Kitchen', 'Parking', 'Furnished'];
const GENDERS = ['Anyone', 'Male', 'Female'];
const NEEDS = ['Private Toilet', 'WiFi', 'Furnished', 'Near Taxi Rank'];
const BUDGET_MAX = { 'Under R1000': 999, 'R1000 - R1500': 1500, 'R1500 - R2000': 2000, 'R2000+': Infinity };
const PRICE_BANDS = { u1000: [0, 999], 1000: [1000, 1500], 1500: [1500, 2000], 2000: [2000, Infinity] };
const REPORT_REASONS = ['Asked for money before viewing', 'Photos are fake', 'Room does not exist', 'Price is different', 'Other'];
const REPORTS_TO_HIDE = 2; // a listing with this many different reporters is hidden automatically
const AVAIL = ['available', 'taken', 'reserved'];
const AV_RANK = { available: 0, reserved: 1, taken: 2 }; // sort order: available first, taken last

/* ------------------------------------------------------------------ */
/* Database start-up                                                   */
/* ------------------------------------------------------------------ */
const isFresh = store.load();
const db = store.db;
if (!db.meta.salt) db.meta.salt = crypto.randomBytes(16).toString('hex');
if (isFresh && cfg.SEED_DEMO) seedDemo(store);

for (const l of db.listings) {
  if (!AVAIL.includes(l.availability)) l.availability = 'available';
  if (!l.availabilityUpdatedAt) l.availabilityUpdatedAt = l.createdAt;
}
store.save();
fs.mkdirSync(cfg.UPLOAD_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
const now = () => new Date().toISOString();
const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);

function clean(value, max, multiline) {
  let s = typeof value === 'string' ? value : value == null ? '' : String(value);
  s = multiline ? s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ') : s.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return s.trim().slice(0, max);
}

const toInt = (v) => (/^\d+$/.test(String(v == null ? '' : v).trim()) ? parseInt(String(v).trim(), 10) : NaN);

function normPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('27') && d.length === 11) return d;
  if (d.startsWith('0') && d.length === 10) return '27' + d.slice(1);
  if (d.length === 9 && /^[1-9]/.test(d)) return '27' + d;
  return null;
}

function fmtPhone(n) {
  if (/^27\d{9}$/.test(n)) {
    const l = '0' + n.slice(2);
    return `${l.slice(0, 3)} ${l.slice(3, 6)} ${l.slice(6)}`;
  }
  return n;
}

const ipHash = (req) => crypto.createHash('sha256').update(db.meta.salt + '|' + req.ip).digest('hex').slice(0, 24);

function imgExt(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const [k, arr] of hits) {
      const keep = arr.filter((x) => t - x < windowMs);
      if (keep.length) hits.set(k, keep);
      else hits.delete(k);
    }
  }, 60000).unref();
  return (req, res, next) => {
    const t = Date.now();
    const arr = (hits.get(req.ip) || []).filter((x) => t - x < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    arr.push(t);
    hits.set(req.ip, arr);
    next();
  };
}

/* ------------------------------------------------------------------ */
/* Listing helpers                                                     */
/* ------------------------------------------------------------------ */
const isLive = (l) => l.status === 'approved' && !l.hidden;

function reviewSummary(listingId) {
  const rs = db.reviews.filter((r) => r.listingId === listingId);
  return {
    total: rs.length,
    photosYes: rs.filter((r) => r.photosMatch).length,
    honestYes: rs.filter((r) => r.honest).length,
  };
}

const waitingCount = (id) => db.waiting.filter((w) => w.listingId === id && !w.notified).length;

function publicListing(l) {
  return {
    id: l.id,
    area: l.area,
    prov: l.prov,
    price: l.price,
    dep: l.dep,
    type: l.type,
    inc: l.inc,
    for: l.for,
    who: String(l.fullName).split(/\s+/)[0],
    v: l.v,
    since: new Date(l.createdAt).getUTCFullYear(),
    rented: l.roomsRented || 0,
    desc: l.desc,
    photos: l.photos,
    demo: !!l.demo,
    reviews: reviewSummary(l.id),
    availability: l.availability,
    availabilityUpdatedAt: l.availabilityUpdatedAt,
    waitingCount: waitingCount(l.id),
  };
}

function filterListings(q) {
  const loc = clean(q.q, 60).toLowerCase();
  const prov = PROV.includes(q.prov) ? q.prov : '';
  const band = PRICE_BANDS[q.price];
  const type = TYPES.includes(q.type) ? q.type : '';
  const gender = q.for === 'Male' || q.for === 'Female' ? q.for : '';
  const minV = [2, 3].includes(Number(q.v)) ? Number(q.v) : 0;
  const show = AVAIL.includes(q.show) ? q.show : '';
  const inc = clean(q.inc, 200)
    .split(',')
    .filter((x) => INCL.includes(x));

  return db.listings
    .filter(
      (l) =>
        isLive(l) &&
        (!loc || (l.area + ' ' + l.prov).toLowerCase().includes(loc)) &&
        (!prov || l.prov === prov) &&
        (!band || (l.price >= band[0] && l.price <= band[1])) &&
        (!type || l.type === type) &&
        (!gender || l.for === 'Anyone' || l.for === gender) &&
        (!minV || l.v >= minV) &&
        (!show || l.availability === show) &&
        inc.every((i) => l.inc.includes(i))
    )
    .sort((a, b) => AV_RANK[a.availability] - AV_RANK[b.availability] || b.v - a.v || (a.createdAt < b.createdAt ? 1 : -1));
}

function matchesFor(r) {
  const t = r.area.toLowerCase();
  const budget = BUDGET_MAX[r.budget] ?? Infinity;
  return db.listings.filter((l) => {
    if (!isLive(l) || l.prov !== r.prov) return false;
    const a = l.area.toLowerCase();
    const base = a.split(' (')[0];
    if (!(a.includes(t) || t.includes(base))) return false;
    if (l.price > budget) return false;
    if (l.for !== 'Anyone' && l.for !== r.gender) return false;
    if (r.needs.includes('Private Toilet') && !l.inc.includes('Private Toilet')) return false;
    if (r.needs.includes('WiFi') && !l.inc.includes('WiFi')) return false;
    if (r.needs.includes('Furnished') && !l.inc.includes('Furnished')) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* App set-up                                                          */
/* ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
if (cfg.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(cfg.TRUST_PROXY) ? Number(cfg.TRUST_PROXY) : cfg.TRUST_PROXY);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob: https://images.unsplash.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});
app.use(compression());
app.use(express.json({ limit: '50kb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4, fields: 40, fieldSize: 10000, parts: 60 },
}).array('photos', 4);

function uploadMiddleware(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Each photo must be smaller than 5MB.'
        : err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT'
          ? 'Please upload exactly 4 photos.'
          : 'We could not read your upload. Please try again.';
    res.status(400).json({ error: msg });
  });
}

const bad = (res, msg) => res.status(400).json({ error: msg });

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/config', (req, res) => {
  res.json({
    whatsapp: cfg.WHATSAPP_NUMBER,
    email: cfg.SUPPORT_EMAIL,
    facebook: cfg.FACEBOOK_URL,
    tiktok: cfg.TIKTOK_URL,
    founder: cfg.FOUNDER_NAME,
  });
});

app.get('/api/listings', (req, res) => {
  const all = filterListings(req.query);
  const limit = Math.min(Math.max(toInt(req.query.limit) || 100, 1), 100);
  res.json({ total: all.length, items: all.slice(0, limit).map(publicListing) });
});

app.get('/api/rooms', (req, res) => {
  const all = filterListings(req.query);
  const limit = Math.min(Math.max(toInt(req.query.limit) || 100, 1), 100);
  res.json({ total: all.length, items: all.slice(0, limit).map(publicListing) });
});

app.get('/api/listings/:id', (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l || l.status !== 'approved') return res.status(404).json({ error: 'Room not found.' });
  if (l.hidden) return res.status(410).json({ error: 'This listing is hidden while we check reports about it.', hidden: true });
  const similar = db.listings
    .filter((x) => x.id !== l.id && isLive(x) && (x.prov === l.prov || x.type === l.type))
    .sort((a, b) => AV_RANK[a.availability] - AV_RANK[b.availability] || b.v - a.v)
    .slice(0, 3)
    .map(publicListing);
  res.json({ item: publicListing(l), similar });
});

app.get('/go/:id', (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l || !isLive(l)) return res.status(404).type('text').send('This room is not available.');
  if (l.availability === 'taken') {
    return res.status(410).type('text').send('This room is taken. Go back and tap "Notify Me" to get a message if it becomes available.');
  }
  const number = l.demo ? cfg.WHATSAPP_NUMBER : l.phone;
  const text = `Hi, I saw your room in ${l.area} (R${l.price}) on FindMyRoom. Is it still available? I would like to view it first.`;
  res.redirect(302, `https://wa.me/${number}?text=${encodeURIComponent(text)}`);
});

app.post('/api/listings', limiter(10, 3600e3), uploadMiddleware, (req, res) => {
  const b = req.body || {};
  if (clean(b.website, 100)) return res.json({ ok: true });

  const fullName = clean(b.fullName, 60);
  if (fullName.length < 2) return bad(res, 'Please enter your full name.');
  const phone = normPhone(b.phone);
  if (!phone) return bad(res, 'Please enter a valid South African WhatsApp number, for example 071 234 5678.');
  if (!PROV.includes(b.prov)) return bad(res, 'Please choose a province.');
  const area = clean(b.area, 60);
  if (area.length < 2) return bad(res, 'Please enter the town, township or area.');
  const street = clean(b.street, 80);
  const price = toInt(b.price);
  if (!(price >= 100 && price <= 50000)) return bad(res, 'Please enter the monthly rent in Rands (R100 to R50 000).');
  const dep = b.dep === '' || b.dep == null ? 0 : toInt(b.dep);
  if (!(dep >= 0 && dep <= 100000)) return bad(res, 'Please enter a valid deposit amount.');
  if (!TYPES.includes(b.type)) return bad(res, 'Please choose a room type.');
  const inc = [...new Set([].concat(b.inc || []).filter((x) => INCL.includes(x)))];
  const forWho = GENDERS.includes(b.for) ? b.for : 'Anyone';
  const desc = clean(b.desc, 400, true);
  if (desc.length < 10) return bad(res, 'Please write a short description of the room (2 sentences).');
  if (!['on', 'true', true].includes(b.agree)) return bad(res, 'Please tick the box to promise you will not ask for payment before viewing.');

  const files = req.files || [];
  if (files.length !== 4) return bad(res, 'Please upload 4 photos: room, toilet, kitchen and outside.');
  const exts = files.map((f) => imgExt(f.buffer));
  if (exts.some((x) => !x)) return bad(res, 'Photos must be JPG, PNG or WebP pictures.');

  const dup = db.listings.find((l) => l.phone === phone && l.area.toLowerCase() === area.toLowerCase() && l.price === price && l.status !== 'rejected');
  if (dup) return res.status(409).json({ error: 'This room is already on FindMyRoom.' });

  const photos = files.map((f, i) => {
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${exts[i]}`;
    fs.writeFileSync(path.join(cfg.UPLOAD_DIR, name), f.buffer);
    return '/uploads/' + name;
  });

  const id = store.nextId('listings');
  db.listings.push({
    id,
    fullName,
    phone,
    prov: b.prov,
    area,
    street,
    price,
    dep,
    type: b.type,
    inc,
    for: forWho,
    desc,
    photos,
    v: 0,
    roomsRented: 0,
    status: 'pending',
    availability: 'available',
    availabilityUpdatedAt: now(),
    hidden: false,
    flagged: false,
    demo: false,
    createdAt: now(),
  });
  store.save();
  res.status(201).json({ ok: true, id });
});

app.post('/api/listings/:id/report', limiter(20, 3600e3), (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l || l.status !== 'approved') return res.status(404).json({ error: 'Room not found.' });
  const reason = REPORT_REASONS.includes((req.body || {}).reason) ? req.body.reason : null;
  if (!reason) return bad(res, 'Please choose a reason.');

  const ip = ipHash(req);
  const already = db.reports.some((r) => r.listingId === l.id && r.ip === ip && !r.dismissed);
  if (!already) {
    db.reports.push({ id: store.nextId('reports'), listingId: l.id, reason, ip, dismissed: false, createdAt: now() });
  }
  const reporters = new Set(db.reports.filter((r) => r.listingId === l.id && !r.dismissed).map((r) => r.ip));
  if (reporters.size >= REPORTS_TO_HIDE && !l.hidden) {
    l.hidden = true;
    l.flagged = true;
    l.hiddenAt = now();
  }
  store.save();
  res.json({ ok: true, hidden: !!l.hidden });
});

app.post('/api/listings/:id/reviews', limiter(20, 3600e3), (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l || !isLive(l)) return res.status(404).json({ error: 'Room not found.' });
  const { photosMatch, honest } = req.body || {};
  if (typeof photosMatch !== 'boolean' || typeof honest !== 'boolean') return bad(res, 'Please answer both questions.');
  const ip = ipHash(req);
  if (db.reviews.some((r) => r.listingId === l.id && r.ip === ip)) {
    return res.status(409).json({ error: 'You already reviewed this room. Thank you!' });
  }
  db.reviews.push({ id: store.nextId('reviews'), listingId: l.id, photosMatch, honest, ip, createdAt: now() });
  store.save();
  res.status(201).json({ ok: true, reviews: reviewSummary(l.id) });
});

app.post('/api/listings/:id/waiting-list', limiter(20, 3600e3), (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l || !isLive(l)) return res.status(404).json({ error: 'Room not found.' });
  const b = req.body || {};
  const name = clean(b.name, 60);
  if (name.length < 2) return bad(res, 'Please enter your name.');
  const digits = String(b.whatsapp || '').replace(/[\s-]/g, '');
  if (!/^0\d{9}$/.test(digits)) return bad(res, 'Please enter a 10 digit WhatsApp number that starts with 0.');
  if (l.availability === 'available') return bad(res, 'This room is available now. You can WhatsApp the landlord.');
  const phone = '27' + digits.slice(1);
  if (db.waiting.some((w) => w.listingId === l.id && w.phone === phone && !w.notified)) {
    return res.status(409).json({ error: 'You are already on the waiting list for this room.' });
  }
  db.waiting.push({ id: store.nextId('waiting'), listingId: l.id, name, phone, notified: false, createdAt: now() });
  store.save();
  res.status(201).json({ ok: true, waitingCount: waitingCount(l.id) });
});

app.post('/api/rooms/:id/waiting-list', limiter(20, 3600e3), (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l || !isLive(l)) return res.status(404).json({ error: 'Room not found.' });
  const b = req.body || {};
  const name = clean(b.name, 60);
  if (name.length < 2) return bad(res, 'Please enter your name.');
  const digits = String(b.whatsapp || '').replace(/[\\s-]/g, '');
  if (!/^0\\d{9}$/.test(digits)) return bad(res, 'Please enter a 10 digit WhatsApp number that starts with 0.');
  if (l.availability === 'available') return bad(res, 'This room is available now. You can WhatsApp the landlord.');
  const phone = '27' + digits.slice(1);
  if (db.waiting.some((w) => w.listingId === l.id && w.phone === phone && !w.notified)) {
    return res.status(409).json({ error: 'You are already on the waiting list for this room.' });
  }
  db.waiting.push({ id: store.nextId('waiting'), listingId: l.id, name, phone, notified: false, createdAt: now() });
  store.save();
  res.status(201).json({ ok: true, waitingCount: waitingCount(l.id) });
});

app.get('/api/scams', (req, res) => {
  const items = db.scams
    .filter((s) => s.status === 'approved')
    .sort(newestFirst)
    .map((s) => ({ number: fmtPhone(s.number), what: s.details[0] || '', count: s.count, date: s.createdAt }));
  res.json({ items });
});

app.post('/api/scams', limiter(10, 3600e3), (req, res) => {
  const b = req.body || {};
  if (clean(b.website, 100)) return res.json({ ok: true });
  const raw = clean(b.number, 30);
  let number = normPhone(raw);
  if (!number) {
    const d = raw.replace(/\D/g, '');
    if (d.length >= 7 && d.length <= 15) number = d;
    else return bad(res, 'Please enter the scammer’s phone number.');
  }
  const what = clean(b.what, 500, true);
  if (what.length < 10) return bad(res, 'Please tell us what happened (a few words is fine).');
  const reporterRaw = clean(b.reporter, 30);
  const reporter = reporterRaw ? normPhone(reporterRaw) : '';
  if (reporterRaw && !reporter) return bad(res, 'Your WhatsApp number does not look right. You can leave it empty.');

  const ip = ipHash(req);
  const existing = db.scams.find((s) => s.number === number && s.status !== 'rejected');
  if (existing) {
    if (!existing.ips.includes(ip)) {
      existing.ips.push(ip);
      existing.count += 1;
      if (existing.details.length < 5) existing.details.push(what);
      if (reporter && !existing.reporters.includes(reporter)) existing.reporters.push(reporter);
    }
  } else {
    db.scams.push({
      id: store.nextId('scams'),
      number,
      status: 'pending',
      count: 1,
      details: [what],
      reporters: reporter ? [reporter] : [],
      ips: [ip],
      createdAt: now(),
    });
  }
  store.save();
  res.status(201).json({ ok: true });
});

app.post('/api/requests', limiter(10, 3600e3), (req, res) => {
  const b = req.body || {};
  if (clean(b.website, 100)) return res.json({ ok: true });
  const name = clean(b.name, 60);
  if (name.length < 2) return bad(res, 'Please enter your name.');
  const phone = normPhone(b.phone);
  if (!phone) return bad(res, 'Please enter a valid South African WhatsApp number, for example 071 234 5678.');
  if (!PROV.includes(b.prov)) return bad(res, 'Please choose a province.');
  const area = clean(b.area, 60);
  if (area.length < 2) return bad(res, 'Please enter the area you want.');
  if (!(b.budget in BUDGET_MAX)) return bad(res, 'Please choose your budget.');
  const moveIn = clean(b.moveIn, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(moveIn) || Number.isNaN(Date.parse(moveIn))) return bad(res, 'Please choose your move-in date.');
  if (!['Male', 'Female'].includes(b.gender)) return bad(res, 'Please choose Male or Female.');
  const needs = [...new Set([].concat(b.needs || []).filter((x) => NEEDS.includes(x)))];

  db.requests.push({
    id: store.nextId('requests'),
    name,
    phone,
    prov: b.prov,
    area,
    budget: b.budget,
    moveIn,
    gender: b.gender,
    needs,
    createdAt: now(),
  });
  store.save();
  res.status(201).json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Admin API (password protected)                                      */
/* ------------------------------------------------------------------ */
const sessions = new Map(); 
const SESSION_MS = 8 * 3600e3;

function adminAuth(req, res, next) {
  const m = /^Bearer (\w{20,})$/.exec(req.get('authorization') || '');
  const exp = m && sessions.get(m[1]);
  if (!exp || exp < Date.now()) {
    if (m) sessions.delete(m[1]);
    return res.status(401).json({ error: 'Please log in.' });
  }
  next();
}

app.post('/api/admin/login', limiter(10, 15 * 60e3), (req, res) => {
  if (!safeEq((req.body || {}).password || '', cfg.ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  res.json({ token });
});

app.get('/api/admin/data', adminAuth, (req, res) => {
  const listings = db.listings
    .slice()
    .sort(newestFirst)
    .map((l) => ({
      ...l,
      reports: db.reports.filter((r) => r.listingId === l.id).map((r) => ({ reason: r.reason, at: r.createdAt, dismissed: !!r.dismissed })),
      reviews: reviewSummary(l.id),
      waitingCount: waitingCount(l.id),
      waiting: db.waiting.filter((w) => w.listingId === l.id && !w.notified).map((w) => ({ name: w.name, phone: w.phone })),
    }));
  const requests = db.requests
    .slice()
    .sort(newestFirst)
    .map((r) => ({ ...r, matches: matchesFor(r).map((l) => ({ id: l.id, area: l.area, price: l.price })) }));
  const scams = db.scams.slice().sort(newestFirst).map(({ ips, ...s }) => s);
  res.json({
    listings,
    scams,
    requests,
    stats: {
      pending: db.listings.filter((l) => l.status === 'pending').length,
      live: db.listings.filter(isLive).length,
      flagged: db.listings.filter((l) => l.hidden && l.flagged).length,
      scamsPending: db.scams.filter((s) => s.status === 'pending').length,
      requests: db.requests.length,
    },
  });
});

app.patch('/api/admin/listings/:id', adminAuth, (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  if (b.status !== undefined) {
    if (!['pending', 'approved', 'rejected'].includes(b.status)) return bad(res, 'Bad status.');
    l.status = b.status;
    if (b.status === 'approved' && l.v < 1) l.v = 1; 
    l.reviewedAt = now();
  }
  if (b.v !== undefined) {
    if (![1, 2, 3].includes(Number(b.v))) return bad(res, 'Bad verification level.');
    l.v = Number(b.v);
  }
  if (b.roomsRented !== undefined) {
    const n = toInt(b.roomsRented);
    if (!(n >= 0 && n <= 9999)) return bad(res, 'Bad number.');
    l.roomsRented = n;
  }
  if (b.hidden !== undefined) {
    l.hidden = !!b.hidden;
    if (!l.hidden) {
      l.flagged = false;
      db.reports.forEach((r) => {
        if (r.listingId === l.id) r.dismissed = true;
      });
    }
  }
  store.save();
  res.json({ ok: true });
});

const ADMIN_PASSWORD = 'admin123'; // TODO: move to .env later

function adminPasswordAuth(req, res, next) {
  const pw = (req.get('Authorization') || '').replace('Bearer ', '') || 
             (req.body && req.body.password) || '';
  if (pw !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong password.' });
  next();
}

app.get('/api/admin/rooms', adminPasswordAuth, (req, res) => {
  res.json({ items: db.listings.map((l) => ({ id: l.id, area: l.area, price: l.price, type: l.type, fullName: l.fullName, phone: l.phone, availability: l.availability, availabilityUpdatedAt: l.availabilityUpdatedAt, waitingCount: waitingCount(l.id) })) });
});

// --- Admin: change availability for /api/rooms/:id ---
app.post('/api/admin/rooms/:id/availability', adminPasswordAuth, (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l) return res.status(404).json({ error: 'Not found.' });
  const a = (req.body || {}).availability;
  if (!AVAIL.includes(a)) return bad(res, 'Availability must be available, taken or reserved.');
  const before = l.availability;
  l.availability = a;
  l.availabilityUpdatedAt = now();
  store.save();
  res.json({ ok: true, id: l.id, before, availability: a, availabilityUpdatedAt: l.availabilityUpdatedAt, waitingCount: waitingCount(l.id) });
});

app.post('/api/admin/listings/:id/availability', adminAuth, (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l) return res.status(404).json({ error: 'Not found.' });
  const a = (req.body || {}).availability;
  if (!AVAIL.includes(a)) return bad(res, 'Availability must be available, taken or reserved.');
  const before = l.availability;
  l.availability = a;
  l.availabilityUpdatedAt = now();
  store.save();
  res.json({ ok: true, id: l.id, before, availability: a, availabilityUpdatedAt: l.availabilityUpdatedAt, waitingCount: waitingCount(l.id) });
});
// TODO: connect the real WhatsApp Business API here later.
app.post('/api/admin/listings/:id/notify', adminAuth, (req, res) => {
  const l = db.listings.find((x) => x.id === toInt(req.params.id));
  if (!l) return res.status(404).json({ error: 'Not found.' });
  if (l.availability !== 'available') return bad(res, 'Mark the room as available first.');
  const origin = `${req.protocol}://${req.get('host')}`;
  const people = db.waiting.filter((w) => w.listingId === l.id && !w.notified);
  for (const w of people) {
    const message = `Hi ${w.name}, good news! The room in ${l.area} (R${l.price}) is available again: ${origin}/#/room/${l.id} Remember: never pay before you view the room.`;
    db.notifications.push({ id: store.nextId('notifications'), listingId: l.id, waitingId: w.id, name: w.name, phone: w.phone, message, simulated: true, createdAt: now() });
    w.notified = true;
    w.notifiedAt = now();
    console.log(`[notify - TEST MODE, not sent] to 0${w.phone.slice(2)}: ${message}`);
  }
  store.save();
  res.json({ ok: true, count: people.length });
});

app.delete('/api/admin/listings/:id', adminAuth, (req, res) => {
  const i = db.listings.findIndex((x) => x.id === toInt(req.params.id));
  if (i < 0) return res.status(404).json({ error: 'Not found.' });
  const [l] = db.listings.splice(i, 1);
  for (const p of l.photos) {
    if (p.startsWith('/uploads/')) fs.unlink(path.join(cfg.UPLOAD_DIR, path.basename(p)), () => {});
  }
  db.reports = db.reports.filter((r) => r.listingId !== l.id);
  db.reviews = db.reviews.filter((r) => r.listingId !== l.id);
  db.waiting = db.waiting.filter((w) => w.listingId !== l.id);
  store.save();
  res.json({ ok: true });
});

app.patch('/api/admin/scams/:id', adminAuth, (req, res) => {
  const s = db.scams.find((x) => x.id === toInt(req.params.id));
  if (!s) return res.status(404).json({ error: 'Not found.' });
  if (!['pending', 'approved', 'rejected'].includes((req.body || {}).status)) return bad(res, 'Bad status.');
  s.status = req.body.status;
  store.save();
  res.json({ ok: true });
});

app.delete('/api/admin/scams/:id', adminAuth, (req, res) => {
  const n = db.scams.length;
  db.scams = db.scams.filter((x) => x.id !== toInt(req.params.id));
  if (db.scams.length === n) return res.status(404).json({ error: 'Not found.' });
  store.save();
  res.json({ ok: true });
});

app.delete('/api/admin/requests/:id', adminAuth, (req, res) => {
  const n = db.requests.length;
  db.requests = db.requests.filter((x) => x.id !== toInt(req.params.id));
  if (db.requests.length === n) return res.status(404).json({ error: 'Not found.' });
  store.save();
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Static files and error handling                                     */
/* ------------------------------------------------------------------ */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use('/uploads', express.static(cfg.UPLOAD_DIR, { maxAge: '7d', immutable: true, index: false }));
app.use(express.static(path.join(cfg.ROOT, 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too big.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

function start(port = cfg.PORT) {
  const server = app.listen(port, () => {
    console.log(`\nFindMyRoom is running:`);
    console.log(`  Website: http://localhost:${server.address().port}`);
    console.log(`  Admin:   http://localhost:${server.address().port}/admin`);
    if (cfg.ADMIN_PASSWORD === 'admin123') {
      console.log('\n  WARNING: you are using the default admin password (admin123).');
      console.log('  Create a .env file and set ADMIN_PASSWORD before putting the site online.\n');
    }
  });
  return server;
}

if (require.main === module) start();

module.exports = { app, start, store };
