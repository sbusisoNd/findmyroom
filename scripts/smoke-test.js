'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fmr-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.ADMIN_PASSWORD = 'test-pass';
process.env.WHATSAPP_NUMBER = '27719998888';
process.env.TRUST_PROXY = '1'; 
process.env.SEED_DEMO = 'true';

const { start } = require('../server');
const server = start(0);
const base = () => `http://127.0.0.1:${server.address().port}`;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

async function call(p, { method = 'GET', json, form, token, ip, redirect = 'manual' } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (ip) headers['X-Forwarded-For'] = ip;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const r = await fetch(base() + p, { method, headers, body, redirect });
  let data = null;
  const text = await r.text();
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: r.status, data, headers: r.headers };
}

function listingForm(over = {}, { photos = 4, fake = false } = {}) {
  const fd = new FormData();
  const f = { fullName: 'Test Landlord', phone: '071 234 5678', prov: 'Gauteng', area: 'Soweto (Zola)', street: '12 Test Street', price: '1300', dep: '1300', type: 'Backroom', for: 'Anyone', desc: 'A clean backroom near the taxi rank. Quiet yard.', agree: 'on', ...over };
  for (const [k, v] of Object.entries(f)) if (v !== null) fd.append(k, v);
  fd.append('inc', 'Water');
  fd.append('inc', 'WiFi');
  for (let i = 0; i < photos; i++) {
    fd.append('photos', new Blob([fake ? Buffer.from('this is not an image file') : PNG], { type: 'image/png' }), `p${i}.png`);
  }
  return fd;
}

(async () => {
  console.log('\nPublic pages and files');
  let r = await call('/');
  check('home page is served', r.status === 200 && /FindMyRoom/.test(r.data));
  check('security headers are set', /default-src 'self'/.test(r.headers.get('content-security-policy') || '') && r.headers.get('x-content-type-options') === 'nosniff');
  r = await call('/admin');
  check('admin page is served', r.status === 200 && /FindMyRoom Admin/.test(r.data));
  for (const p of ['/server.js', '/.env', '/data/db.json', '/config.js']) {
    r = await call(p);
    check(`${p} is NOT downloadable`, r.status === 404);
  }
  r = await call('/api/config');
  check('config returns support number', r.data.whatsapp === '27719998888');

  console.log('\nBrowsing and filters');
  r = await call('/api/listings');
  check('12 example rooms are live', r.data.total === 12, r.data.total);
  check('landlord phone numbers are never in the public data', !/"phone"|2771000|"street"/.test(JSON.stringify(r.data)));
  const all = r.data.items;
  r = await call('/api/listings?prov=Gauteng');
  check('province filter', r.data.items.length === 4 && r.data.items.every((x) => x.prov === 'Gauteng'), r.data.items.length);
  r = await call('/api/listings?price=u1000');
  check('price "Under R1000" filter', r.data.items.length > 0 && r.data.items.every((x) => x.price < 1000));
  r = await call('/api/listings?price=2000');
  check('price "R2000+" filter', r.data.items.length === 2 && r.data.items.every((x) => x.price >= 2000), r.data.items.length);
  r = await call('/api/listings?v=3');
  check('gold-verified filter', r.data.items.length === 3 && r.data.items.every((x) => x.v === 3), r.data.items.length);
  r = await call('/api/listings?q=soweto');
  check('location search "soweto"', r.data.items.length === 1 && /Soweto/.test(r.data.items[0].area));
  r = await call('/api/listings?inc=WiFi,Kitchen,Parking');
  check('"included" filter needs ALL selected items', r.data.items.length === 2 && r.data.items.every((x) => ['WiFi', 'Kitchen', 'Parking'].every((i) => x.inc.includes(i))), r.data.items.length);
  r = await call('/api/listings?for=Male');
  check('gender filter keeps "Anyone" rooms', r.data.items.every((x) => x.for === 'Male' || x.for === 'Anyone') && !r.data.items.some((x) => x.for === 'Female'));
  r = await call('/api/listings?limit=6');
  check('limit works (home page featured rooms)', r.data.items.length === 6 && r.data.total === 12);
  check('gold rooms are listed first', all[0].v === 3);
  r = await call('/api/listings/1');
  check('room details include 4 photos + similar rooms', r.status === 200 && r.data.item.photos.length === 4 && r.data.similar.length > 0 && !('phone' in r.data.item));
  r = await call('/api/listings/9999');
  check('unknown room gives 404', r.status === 404);

  console.log('\nWhatsApp button');
  r = await call('/go/1');
  check('example room sends people to YOUR support WhatsApp', r.status === 302 && r.headers.get('location').startsWith('https://wa.me/27719998888?text='), r.headers.get('location'));

  console.log('\nLandlord: list a room');
  r = await call('/api/listings', { method: 'POST', form: listingForm({}, { fake: true }) });
  check('a fake (non-image) photo is rejected', r.status === 400 && /JPG|PNG/.test(r.data.error), JSON.stringify(r.data));
  r = await call('/api/listings', { method: 'POST', form: listingForm({ agree: null }) });
  check('must agree "no payment before viewing"', r.status === 400 && /tick/.test(r.data.error), JSON.stringify(r.data));
  r = await call('/api/listings', { method: 'POST', form: listingForm({ phone: '12345' }) });
  check('invalid phone number is rejected', r.status === 400 && /WhatsApp/.test(r.data.error));
  r = await call('/api/listings', { method: 'POST', form: listingForm({}, { photos: 2 }) });
  check('fewer than 4 photos is rejected', r.status === 400 && /4 photos/.test(r.data.error));
  r = await call('/api/listings', { method: 'POST', form: listingForm({ fullName: '<img src=x onerror=alert(1)>' }) });
  check('good listing is accepted', r.status === 201 && r.data.ok, JSON.stringify(r.data));
  const newId = r.data.id;
  r = await call('/api/listings', { method: 'POST', form: listingForm({ fullName: '<img src=x onerror=alert(1)>' }) });
  check('same room cannot be listed twice', r.status === 409);
  r = await call('/api/listings');
  check('new listing is NOT public until approved', r.data.total === 12 && !r.data.items.some((x) => x.id === newId));
  r = await call('/go/' + newId);
  check('pending listing WhatsApp link does not work', r.status === 404);
  const files = fs.readdirSync(process.env.UPLOAD_DIR);
  check('4 photos were saved on the server', files.length === 4 && files.every((f) => /\.png$/.test(f)), files.join(','));
  r = await call('/uploads/' + files[0]);
  check('uploaded photo is served as an image', r.status === 200 && /image\/png/.test(r.headers.get('content-type')));

  console.log('\nAdmin');
  r = await call('/api/admin/data');
  check('admin data needs a login', r.status === 401);
  r = await call('/api/admin/login', { method: 'POST', json: { password: 'wrong' } });
  check('wrong password is refused', r.status === 401);
  r = await call('/api/admin/login', { method: 'POST', json: { password: 'test-pass' } });
  check('right password gives a token', r.status === 200 && /^\w{20,}$/.test(r.data.token));
  const token = r.data.token;
  r = await call('/api/admin/data', { token });
  const mine = r.data.listings.find((l) => l.id === newId);
  check('admin sees the pending listing with phone number', mine && mine.status === 'pending' && mine.phone === '27712345678' && mine.street === '12 Test Street', JSON.stringify(mine && mine.phone));
  check('admin stats count pending listings', r.data.stats.pending === 1);
  r = await call('/api/admin/listings/' + newId, { method: 'PATCH', token, json: { status: 'approved' } });
  check('admin can approve', r.status === 200);
  r = await call('/api/listings/' + newId);
  check('approved listing is public, level 1 (phone verified), no phone leaked', r.status === 200 && r.data.item.v === 1 && !JSON.stringify(r.data).includes('27712345678'));
  check('landlord first name only', r.data.item.who === '<img');
  r = await call('/go/' + newId);
  check("real listing's WhatsApp button uses the landlord's number", r.headers.get('location').startsWith('https://wa.me/27712345678?text='), r.headers.get('location'));
  r = await call('/api/admin/listings/' + newId, { method: 'PATCH', token, json: { v: 2, roomsRented: 3 } });
  r = await call('/api/listings/' + newId);
  check('admin can set badge level and rooms rented', r.data.item.v === 2 && r.data.item.rented === 3);

  console.log('\nReports: 2 different people hide a listing');
  r = await call(`/api/listings/${newId}/report`, { method: 'POST', json: { reason: 'Nonsense' }, ip: '1.1.1.1' });
  check('report needs a valid reason', r.status === 400);
  r = await call(`/api/listings/${newId}/report`, { method: 'POST', json: { reason: 'Photos are fake' }, ip: '1.1.1.1' });
  check('first report: thanks, still visible', r.status === 200 && r.data.hidden === false);
  r = await call(`/api/listings/${newId}/report`, { method: 'POST', json: { reason: 'Photos are fake' }, ip: '1.1.1.1' });
  check('same person reporting again does NOT count twice', r.data.hidden === false);
  r = await call('/api/listings/' + newId);
  check('listing is still visible after 1 reporter', r.status === 200);
  r = await call(`/api/listings/${newId}/report`, { method: 'POST', json: { reason: 'Asked for money before viewing' }, ip: '2.2.2.2' });
  check('second different reporter auto-hides the listing', r.status === 200 && r.data.hidden === true);
  r = await call('/api/listings/' + newId);
  check('hidden listing returns 410', r.status === 410 && r.data.hidden === true);
  r = await call('/api/listings');
  check('hidden listing is gone from search', !r.data.items.some((x) => x.id === newId));
  r = await call('/go/' + newId);
  check('hidden listing WhatsApp link stops working', r.status === 404);
  r = await call('/api/admin/data', { token });
  check('admin sees it flagged', r.data.stats.flagged === 1 && r.data.listings.find((l) => l.id === newId).reports.length === 2);
  r = await call('/api/admin/listings/' + newId, { method: 'PATCH', token, json: { hidden: false } });
  r = await call('/api/listings/' + newId);
  check('admin can restore it (reports cleared)', r.status === 200);
  r = await call(`/api/listings/${newId}/report`, { method: 'POST', json: { reason: 'Other' }, ip: '3.3.3.3' });
  check('old reports no longer count after restore', r.data.hidden === false);

  console.log('\nTenant reviews');
  r = await call(`/api/listings/${newId}/reviews`, { method: 'POST', json: { photosMatch: true } });
  check('review needs both answers', r.status === 400);
  r = await call(`/api/listings/${newId}/reviews`, { method: 'POST', json: { photosMatch: true, honest: false }, ip: '4.4.4.4' });
  check('review is saved', r.status === 201 && r.data.reviews.total === 1 && r.data.reviews.photosYes === 1 && r.data.reviews.honestYes === 0);
  r = await call(`/api/listings/${newId}/reviews`, { method: 'POST', json: { photosMatch: true, honest: true }, ip: '4.4.4.4' });
  check('one review per person', r.status === 409);

  console.log('\nScam wall');
  r = await call('/api/scams', { method: 'POST', json: { number: '060 111 2222', what: 'Asked me for R500 on eWallet before viewing.' }, ip: '5.5.5.5' });
  check('scam report accepted', r.status === 201);
  r = await call('/api/scams');
  check('unchecked scam report is NOT public', r.data.items.length === 0);
  r = await call('/api/scams', { method: 'POST', json: { number: '+27 60 111 2222', what: 'He also said he was overseas.' }, ip: '6.6.6.6' });
  r = await call('/api/scams', { method: 'POST', json: { number: '0601112222', what: 'Same person again from the same visitor.' }, ip: '6.6.6.6' });
  r = await call('/api/admin/data', { token });
  const sc = r.data.scams;
  check('same number in different formats is merged, one count per visitor', sc.length === 1 && sc[0].count === 2 && !('ips' in sc[0]), JSON.stringify(sc.map((s) => [s.number, s.count])));
  r = await call('/api/admin/scams/' + sc[0].id, { method: 'PATCH', token, json: { status: 'approved' } });
  r = await call('/api/scams');
  check('approved scam shows on the wall', r.data.items.length === 1 && r.data.items[0].number === '060 111 2222' && r.data.items[0].count === 2, JSON.stringify(r.data.items));

  console.log('\nTenant requests');
  r = await call('/api/requests', { method: 'POST', json: { name: 'Lerato', phone: '082 555 1234', prov: 'Gauteng', area: 'Soweto', budget: 'R1000 - R1500', moveIn: '2026-12-01', gender: 'Female', needs: ['WiFi', 'Bogus'] } });
  check('tenant request accepted', r.status === 201, JSON.stringify(r.data));
  r = await call('/api/requests', { method: 'POST', json: { name: 'X', phone: '082 555 1234', prov: 'Gauteng', area: 'Soweto', budget: 'R1000 - R1500', moveIn: 'not-a-date', gender: 'Female' } });
  check('bad request data is rejected', r.status === 400);
  r = await call('/api/admin/data', { token });
  const req = r.data.requests[0];
  check('request is saved, bogus option dropped, phone normalised', req.needs.join() === 'WiFi' && req.phone === '27825551234');
  check('admin sees matching live rooms for the request', req.matches.length === 1 && req.matches[0].id === newId, JSON.stringify(req.matches));

  console.log('\nHoneypot and delete');
  r = await call('/api/requests', { method: 'POST', json: { website: 'http://spam', name: 'Bot' } });
  r = await call('/api/admin/data', { token });
  check('bots that fill the hidden field are silently dropped', r.data.requests.length === 1);
  r = await call('/api/admin/listings/' + newId, { method: 'DELETE', token });
  await new Promise((res) => setTimeout(res, 200));
  check('deleting a listing removes it and its photos', r.status === 200 && fs.readdirSync(process.env.UPLOAD_DIR).length === 0);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
