
(function () {
'use strict';

/* ---------- constants ---------- */
const PROV = ['Gauteng', 'Mpumalanga', 'Limpopo', 'KwaZulu-Natal', 'Western Cape', 'Eastern Cape', 'Free State', 'North West', 'Northern Cape'];
const TYPES = ['Backroom', 'Room in House', 'Flat', 'Sharing', 'Student Room'];
const INCL = ['Water', 'Electricity', 'WiFi', 'Private Toilet', 'Shared Toilet', 'Kitchen', 'Parking', 'Furnished'];
const NEEDS = ['Private Toilet', 'WiFi', 'Furnished', 'Near Taxi Rank'];
const ICON = { Water: '', Electricity: '⚡', WiFi: '', 'Private Toilet': '', 'Shared Toilet': '', Kitchen: '', Parking: '', Furnished: '' };
const POP = {
  Gauteng: ['Soweto', 'Mamelodi', 'Tembisa', 'Soshanguve', 'Johannesburg CBD'],
  Mpumalanga: ['Mbombela', 'KaNyamazane', 'Pienaar', 'White River', 'Witbank'],
  'KwaZulu-Natal': ['Durban', 'Umlazi', 'Pinetown', 'Pietermaritzburg'],
  'Western Cape': ['Khayelitsha', 'Mitchells Plain', 'Cape Town CBD'],
  Limpopo: ['Polokwane', 'Seshego', 'Thohoyandou'],
};
const BADGE = {
  1: { c: 'b1', i: '✔', n: 'Phone Verified', d: "The landlord's WhatsApp number has been checked and works." },
  2: { c: 'b2', i: '', n: 'ID + Video Verified', d: 'The landlord sent their ID and a video of themselves outside the room, saying: "This is my room in [Area], listed on FindMyRoom".' },
  3: { c: 'b3', i: '', n: 'Visited By FindMyRoom', d: 'Our team physically visited and checked this room. This is the highest level of trust.' },
};
const PHOTO_LABELS = ['Room', 'Toilet', 'Kitchen', 'Outside'];
const PRICE_OPTS = '<option value="">Any price</option><option value="u1000">Under R1000</option><option value="1000">R1000 - R1500</option><option value="1500">R1500 - R2000</option><option value="2000">R2000+</option>';
const BUDGETS = ['Under R1000', 'R1000 - R1500', 'R1500 - R2000', 'R2000+'];
const AV = {
  available: { cls: 'av-a', text: 'Available' },
  taken: { cls: 'av-t', text: 'Taken' },
  reserved: { cls: 'av-r', text: 'Reserved - Viewing' },
};
// Availability of a room as the page understands it
const av = (r) => (r && AV[r.availability] ? r.availability : 'available');
const ROOMS = {}; // rooms already shown on screen, so popups can reuse their photo, price and area
let waitingMine = {}; // rooms this visitor joined the waiting list for (remembered on this phone)
try { waitingMine = JSON.parse(localStorage.getItem('fmr_wait') || '{}') || {}; } catch (e) { waitingMine = {}; }
function rememberWaiting(id) {
  waitingMine[id] = 1;
  try { localStorage.setItem('fmr_wait', JSON.stringify(waitingMine)); } catch (e) { /* storage blocked */ }
}

// --- Favourites: Save rooms to localStorage, no login needed ---
const FAV_KEY = 'findmyroom_favourites';
let favourites = []; // array of room IDs (as strings)

function getFavourites() {
  try {
    const data = localStorage.getItem(FAV_KEY);
    const arr = data ? JSON.parse(data) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (e) {
    return [];
  }
}

function saveFavourites(favs) {
  favourites = favs;
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  } catch (e) { /* storage failed, just keep in-memory */ }
  updateFavCount();
}

function isFavourite(id) {
  return favourites.includes(String(id));
}

function toggleFavourite(id) {
  const sid = String(id);
  if (isFavourite(sid)) {
    saveFavourites(favourites.filter((i) => i !== sid));
  } else {
    saveFavourites([...favourites, sid]);
  }
}

// Update the header favourites count
function updateFavCount() {
  const countEl = document.querySelector('a[data-p="saved"] .fav-count');
  if (!countEl) return;
  const count = favourites.length;
  if (count > 0) {
    countEl.textContent = count;
    countEl.style.display = 'inline';
  } else {
    countEl.style.display = 'none';
  }
}

// Initialize favourites from localStorage on startup
favourites = getFavourites();

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; }
};

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'R' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const opts = (arr, first) => (first ? `<option value="">${first}</option>` : '') + arr.map((x) => `<option>${esc(x)}</option>`).join('');
const app = $('#app');
let CFG = { whatsapp: '27710000000', email: '', facebook: '#', tiktok: '#', founder: '[Founder Name]' };
let F = {}; // search filters remembered between pages

async function api(path, options) {
  let r;
  try {
    r = await fetch(path, options);
  } catch (e) {
    throw new Error('No internet connection. Please check your data and try again.');
  }
  let j = null;
  try { j = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok) {
    const err = new Error((j && j.error) || 'Something went wrong. Please try again.');
    err.status = r.status;
    err.data = j;
    throw err;
  }
  return j;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const loading = (t) => `<div class="empty">${t || 'Loading…'}</div>`;

// Resize photos in the phone before uploading: saves the landlord's data and keeps uploads fast.
async function shrinkImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.72));
    return blob && blob.size < file.size ? blob : file;
  } catch (e) {
    return file;
  }
}

/* ---------- modal ---------- */
function modal(html) { $('#mbox').innerHTML = html; $('#modal').classList.add('show'); }
function closeModal() { $('#modal').classList.remove('show'); }

function badgeInfo(l) {
  const b = BADGE[l];
  modal(`<h3>${b.i} ${esc(b.n)}</h3><p>${esc(b.d)}</p>
  <div class="meta"><b>Levels:</b> 1 Phone Verified (green tick) · 2 ID + Video Verified (blue) · 3 Visited By FindMyRoom (gold)</div>
  <div class="warn">Even on a verified listing: NEVER pay before viewing the room.</div>
  <button class="btn" data-act="close">OK</button>`);
}

function reportBox(id) {
  modal(`<h3>Report this listing</h3><p class="meta">Tell us what is wrong. Your report is private.</p>
  <select id="rr">${opts(['Asked for money before viewing', 'Photos are fake', 'Room does not exist', 'Price is different', 'Other'])}</select>
  <div class="err" id="rerr" hidden></div>
  <button class="btn red" data-act="send-report" data-id="${id}">Send Report</button>
  <button class="btn out" data-act="close">Cancel</button>`);
}

async function sendReport(id, btn) {
  btn.disabled = true;
  try {
    const r = await post(`/api/listings/${id}/report`, { reason: $('#rr').value });
    modal(`<h3>Thank you for reporting.</h3><p>We will review this listing.</p>
    ${r.hidden ? '<p class="meta">Other people also reported it, so it is now hidden until we check it.</p>' : ''}
    <button class="btn" data-act="report-done">OK</button>`);
  } catch (e) {
    btn.disabled = false;
    const box = $('#rerr');
    box.textContent = e.message;
    box.hidden = false;
  }
}

/* ---------- small components ---------- */
const badge = (v) => {
  const b = BADGE[v] || BADGE[1];
  return `<button class="badge ${b.c}" data-act="badge" data-v="${v in BADGE ? v : 1}" aria-label="${esc(b.n)}. Tap to learn more">${b.i} ${esc(b.n)}</button>`;
};

// Landlords never change a status themselves. They WhatsApp the owner, with area and price already typed in.
const lordLink = (r) => 'https://wa.me/' + CFG.whatsapp + '?text=' + encodeURIComponent(
  `Hi FindMyRoom, I am the landlord of the room in ${r.area} for R${r.price}. Please update it to: TAKEN / AVAILABLE / RESERVED`);

function waitControls(r) {
  const n = r.waitingCount || 0;
  return (waitingMine[r.id]
    ? '<button class="btn grey sm full" disabled>You Will Be Notified</button>'
    : `<button class="btn blue sm full" data-act="notify" data-id="${r.id}">🔔 Notify Me If It Becomes Available</button>`)
    + (n > 0 ? `<div class="meta">${n} ${n === 1 ? 'person is' : 'people are'} waiting for this room</div>` : '');
}

function statusBox(r) {
  const a = av(r);
  if (a === 'taken') return `<div class="stbox t">This room is TAKEN. It was rented on ${esc(fmtDate(r.availabilityUpdatedAt))}. Do not send money for this room.</div>`;
  if (a === 'reserved') return '<div class="stbox r">This room is RESERVED. Someone is viewing it. You can still join the waiting list.</div>';
  return '<div class="stbox a">This room is AVAILABLE now. WhatsApp the landlord today.</div>';
}

function card(r) {
  ROOMS[r.id] = r;
  const a = av(r);
  const fav = isFavourite(r.id);
  const photo = r.photos[0] ? `<img class="${a === 'taken' ? 'gone' : ''}" src="${esc(r.photos[0])}" alt="${esc(r.type)} in ${esc(r.area)}" loading="lazy">` : '';
  const stamp = a === 'taken' ? '<div class="stamp"><span>TAKEN</span></div>' : '';
  let actions;
  if (a === 'taken') {
    actions = `<div class="wait full" data-wait="${r.id}">${waitControls(r)}</div>
    <a class="btn out sm" href="#/room/${r.id}">View Details</a><button class="btn out sm" data-act="check" data-id="${r.id}">Check Availability</button>`;
  } else {
    actions = `<a class="btn wa sm" target="_blank" rel="noopener" href="/go/${r.id}">WhatsApp</a><a class="btn out sm" href="#/room/${r.id}">View Details</a>`
      + (a === 'reserved' ? `<div class="note">Someone is viewing this room</div><div class="wait full" data-wait="${r.id}">${waitControls(r)}</div>` : '')
      + `<button class="btn out sm full" data-act="check" data-id="${r.id}">Check Availability</button>`;
  }
  return `<div class="card"><div class="ph"><div class="tags"><span class="tag">${esc(r.type)}</span><span class="avb ${AV[a].cls}">${AV[a].text}</span></div><span>🏠</span>${photo}${stamp}<button class="fav-btn" data-id="${r.id}" aria-label="${fav ? 'Unsave room' : 'Save room'}"${fav ? ' style="color:#EF4444"' : ''}>${fav ? '♥️' : '♡'}</button></div>
  <div class="cb"><div class="badges">${badge(r.v)}${r.demo ? '<span class="ex">Example</span>' : ''}</div>
  <div class="price">${money(r.price)} <small>/ month</small></div>
  <div class="loc">${esc(r.area)}</div><div class="meta">${esc(r.prov)} · For ${esc(r.for)}</div>
  <div class="inc">${r.inc.slice(0, 3).map((i) => `<span>${ICON[i]} ${esc(i)}</span>`).join('')}</div>
  <div class="acts">${actions}</div>
  <div class="lord"><p>Landlord? Do not press buttons. Just WhatsApp us and we will update this room for you.</p><a class="btn wa sm" target="_blank" rel="noopener" href="${esc(lordLink(r))}">WhatsApp FindMyRoom To Update This Room</a></div>
  <button class="rep" data-act="report" data-id="${r.id}"> Report</button></div></div>`;
}

/* ---------- waiting list popups ---------- */
function refreshWait(id) {
  const r = ROOMS[id];
  if (!r) return;
  $$('[data-wait="' + id + '"]').forEach((el) => { el.innerHTML = waitControls(r); });
}

function notifyBox(id) {
  const r = ROOMS[id];
  if (!r) return;
  if (waitingMine[id]) {
    modal('<h3>You Will Be Notified</h3><p>You are already on the waiting list for this room.</p><button class="btn" data-act="close">OK</button>');
    return;
  }
  modal(`<h3>Get Notified For This Room</h3>
  <div class="nrow">${r.photos[0] ? `<img src="${esc(r.photos[0])}" alt="">` : ''}<div><b>${money(r.price)} / month</b><br><span class="meta">${esc(r.area)}</span></div></div>
  <input id="nn" placeholder="Your Name" maxlength="60" autocomplete="name">
  <input id="np" type="tel" inputmode="numeric" placeholder="Your WhatsApp Number, e.g. 0712345678" maxlength="14" autocomplete="tel">
  <label class="cbx"><input type="checkbox" id="nc" checked> Send me a WhatsApp when this room becomes available</label>
  <div class="err" id="nerr" hidden></div>
  <button class="btn" data-act="notify-send" data-id="${id}">Notify Me</button>
  <button class="linkbtn" data-act="close">Cancel</button>`);
}

async function sendNotify(id, btn) {
  const r = ROOMS[id];
  const fail = (m) => { const e = $('#nerr'); e.textContent = m; e.hidden = false; };
  const name = $('#nn').value.trim();
  const number = $('#np').value.replace(/[\s-]/g, '');
  if (name.length < 2) return fail('Please enter your name.');
  if (!/^0\d{9}$/.test(number)) return fail('Please enter a 10 digit WhatsApp number that starts with 0.');
  if (!$('#nc').checked) return fail('Please tick the box so we can WhatsApp you.');
  btn.disabled = true;
  try {
    const d = await post(`/api/listings/${id}/waiting-list`, { name, whatsapp: number });
    r.waitingCount = d.waitingCount;
    rememberWaiting(id);
    refreshWait(id);
    modal(`<h3> You Will Be Notified</h3><p>Done! We will WhatsApp you on ${esc(number)} if this room in ${esc(r.area)} becomes available again.</p><button class="btn" data-act="close">OK</button>`);
  } catch (e) {
    btn.disabled = false;
    if (e.status === 409) { rememberWaiting(id); refreshWait(id); }
    fail(e.message);
  }
}

async function checkRoom(id, btn) {
  let r = ROOMS[id];
  btn.disabled = true;
  try {
    const d = await api('/api/listings/' + encodeURIComponent(id)); // ask the server for the latest status
    r = Object.assign(r || {}, d.item);
    ROOMS[id] = r;
  } catch (e) {
    if (e.status === 404 || e.status === 410) {
      btn.disabled = false;
      modal(`<h3>Room not available</h3><p>${esc(e.message)}</p><button class="btn" data-act="close">OK</button>`);
      return;
    }
    // no data or a server hiccup: use what we already know about the room
  }
  btn.disabled = false;
  if (!r) return;
  const a = av(r);
  const notifyBtn = waitingMine[id]
    ? '<button class="btn grey" disabled> You Will Be Notified</button>'
    : `<button class="btn blue" data-act="notify" data-id="${id}">🔔 Notify Me</button>`;
  if (a === 'available') {
    modal(`<h3>Yes, it is available</h3><p>Yes, this room was confirmed available on ${esc(fmtDate(r.availabilityUpdatedAt))}. You can WhatsApp the landlord now.</p>
    <a class="btn wa" target="_blank" rel="noopener" href="/go/${r.id}">WhatsApp The Landlord</a>
    <div class="warn">Never pay before you view the room.</div><button class="linkbtn" data-act="close">Close</button>`);
  } else if (a === 'taken') {
    modal(`<h3>Sorry, it is taken</h3><p>Sorry, this room is taken. Do you want us to notify you if it becomes available?</p>${notifyBtn}<button class="linkbtn" data-act="close">Close</button>`);
  } else {
    modal(`<h3>This room is reserved</h3><p>This room is reserved, but you can join the waiting list.</p>${notifyBtn}<button class="linkbtn" data-act="close">Close</button>`);
  }
}

const checkboxes = (arr, name) => arr.map((i) => `<label><input type="checkbox" name="${name}" value="${esc(i)}"> ${esc(i)}</label>`).join('');
const honeypot = '<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>';

function showSuccess(form, msg, extra) {
  form.outerHTML = `<div class="ok"> ${esc(msg)}${extra ? `<p style="font-size:15px;margin-top:8px">${esc(extra)}</p>` : ''}<p style="margin-top:12px"><a class="btn" href="#/find">Browse rooms</a></p></div>`;
  window.scrollTo(0, 0);
}

// Wires up a form: shows errors, disables the button while sending.
function handleForm(form, label, send) {
  const btn = form.querySelector('button[type=submit]');
  const errBox = document.createElement('div');
  errBox.className = 'err';
  errBox.hidden = true;
  btn.before(errBox);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await send(new FormData(form));
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      errBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

/* ---------- pages ---------- */
async function home(alive) {
  app.innerHTML = `
  <div class="hero"><div class="wrap"><h1>Find A Room Anywhere In South Africa</h1>
  <p>From backrooms in Soweto to flats in Cape Town. Search by township, town or city. Chat directly to the landlord on WhatsApp. No agent fees.</p>
  <form class="sbox" id="hs"><input id="hl" placeholder="Township, town or city" aria-label="Location">
  <select id="hp" aria-label="Province">${opts(PROV, 'All provinces')}</select>
  <select id="hr" aria-label="Price">${PRICE_OPTS}</select>
  <button class="btn" type="submit">SEARCH</button></form></div></div>
  <div class="wrap" style="margin-top:16px"><div class="warn">NEVER pay a deposit before you have seen the room in person. FindMyRoom will NEVER ask you to pay us on WhatsApp. If someone asks for money before viewing, <a href="#/scams" style="text-decoration:underline">REPORT them</a>.</div></div>
  <section><div class="wrap"><h2>How It Works</h2><p class="sub">Three easy steps. No agent. No fees.</p>
  <div class="steps"><div class="step"><div class="num">1</div><b>Search Your Area</b><p class="meta">Type your township, town or city. Filter by price.</p></div>
  <div class="step"><div class="num">2</div><b>View Photos &amp; Details</b><p class="meta">See price, what's included, and real photos.</p></div>
  <div class="step"><div class="num">3</div><b>WhatsApp The Landlord</b><p class="meta">Talk directly. No middleman. No extra fees.</p></div></div></div></section>
  <section style="background:var(--bg)"><div class="wrap"><h2>Popular Areas</h2><p class="sub">Tap an area to see rooms.</p>
  ${Object.entries(POP).map(([p, a]) => `<div class="pg"><b>${esc(p)}</b><div class="chips">${a.map((x) => `<button class="chip" data-act="area" data-a="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`).join('')}</div></section>
  <section><div class="wrap"><h2>Featured Rooms</h2><p class="sub">Tap a badge to see what it means.</p>
  <div class="grid" id="feat">${loading('Loading rooms…')}</div>
  <p style="margin-top:16px;text-align:center"><a class="btn out" href="#/find">See all rooms</a></p></div></section>
  <section style="background:var(--bg)"><div class="wrap"><h2>Why Use FindMyRoom</h2><p class="sub">Built for South Africans.</p>
  <div class="why"><div class="wb"><div class="i"></div><b>No Agent Fees</b></div>
  <div class="wb"><div class="i"></div><b>Township Friendly</b><p class="meta">We list backrooms, not just fancy flats</p></div>
  <div class="wb"><div class="i"></div><b>Verified Listings</b></div>
  <div class="wb"><div class="i">⏱</div><b>Fast</b><p class="meta">List a room in 2 minutes</p></div>
  <div class="wb"><div class="i"></div><b>Works On Any Phone</b></div></div></div></section>
  <section><div class="wrap"><div class="land"><h2>Have a room to rent?</h2><p>List it for FREE and get tenants on WhatsApp today.</p><a class="btn" href="#/list">LIST YOUR ROOM FREE</a></div></div></section>`;

  $('#hs').addEventListener('submit', (e) => {
    e.preventDefault();
    F = { q: $('#hl').value, prov: $('#hp').value, price: $('#hr').value };
    location.hash = '#/find';
  });
  try {
    const d = await api('/api/listings?limit=6');
    if (!alive()) return;
    $('#feat').innerHTML = d.items.length ? d.items.map(card).join('') : '<div class="empty" style="grid-column:1/-1">No rooms yet. Be the first to <a href="#/list" style="color:var(--g);font-weight:700">list a room</a>.</div>';
  } catch (e) {
    if (alive()) $('#feat').innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(e.message)}</div>`;
  }
}

async function find(alive) {
  app.innerHTML = `<section><div class="wrap"><h2>Find a Room</h2><p class="sub" id="cnt">&nbsp;</p>
  <div class="warn" style="margin-bottom:14px"> NEVER pay before viewing.</div>
  <button class="btn out sm ft" id="tf">Show / hide filters</button>
  <div class="layout"><aside class="filters" id="fl">
  <div><label class="h">Show</label><select id="fs"><option value="available">Available Only</option><option value="all">All Rooms</option><option value="taken">Taken</option><option value="reserved">Reserved</option></select></div>
  <div><label class="h">Area / township</label><input id="fa" placeholder="e.g. Soweto"></div>
  <div><label class="h">Province</label><select id="fp">${opts(PROV, 'All provinces')}</select></div>
  <div><label class="h">Price range</label><select id="fr">${PRICE_OPTS}</select></div>
  <div><label class="h">Room type</label><select id="ft">${opts(TYPES, 'Any type')}</select></div>
  <div><label class="h">What's included</label><div class="checks">${INCL.map((i) => `<label><input type="checkbox" value="${esc(i)}" class="fi"> ${esc(i)}</label>`).join('')}</div></div>
  <div><label class="h">For</label><select id="fg"><option value="">Anyone</option><option>Male</option><option>Female</option></select></div>
  <div><label class="h">Verification level</label><select id="fv"><option value="">All</option><option value="2">Verified (Blue or Gold)</option><option value="3">Gold Verified</option></select></div>
  <button class="btn out sm" id="clr">Clear filters</button></aside>
  <div><div class="grid" id="res">${loading()}</div></div></div></div></section>`;

  $('#fa').value = F.q || '';
  $('#fp').value = F.prov || '';
  $('#fr').value = F.price || '';

  let seq = 0;
  let timer = null;
  const run = async () => {
    const my = ++seq;
    F = { q: $('#fa').value, prov: $('#fp').value, price: $('#fr').value };
    const p = new URLSearchParams();
    if (F.q.trim()) p.set('q', F.q.trim());
    if (F.prov) p.set('prov', F.prov);
    if (F.price) p.set('price', F.price);
    if ($('#ft').value) p.set('type', $('#ft').value);
    if ($('#fg').value) p.set('for', $('#fg').value);
    if ($('#fv').value) p.set('v', $('#fv').value);
    p.set('show', $('#fs').value);
    const inc = $$('.fi:checked').map((x) => x.value);
    if (inc.length) p.set('inc', inc.join(','));
    try {
      const d = await api('/api/listings?' + p);
      if (my !== seq || !alive()) return;
      $('#cnt').textContent = `${d.total} room${d.total === 1 ? '' : 's'} found`;
      $('#res').innerHTML = d.items.length ? d.items.map(card).join('') : '<div class="empty" style="grid-column:1/-1">No rooms match. Try changing your filters.</div>';
    } catch (e) {
      if (my === seq && alive()) $('#res').innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(e.message)}</div>`;
    }
  };
  $$('#fl input, #fl select').forEach((el) => el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); }));
  $('#clr').addEventListener('click', () => { F = {}; find(alive); });
  $('#tf').addEventListener('click', () => $('#fl').classList.toggle('hide'));
  if (window.innerWidth <= 850) $('#fl').classList.add('hide');
  run();
}

let reviewAnswers = {};
async function room(id, alive) {
  app.innerHTML = `<div class="wrap">${loading()}</div>`;
  let d;
  try {
    d = await api('/api/listings/' + encodeURIComponent(id));
  } catch (e) {
    if (alive()) app.innerHTML = `<div class="wrap empty">${esc(e.message)} <a href="#/find" style="color:var(--g)">Back to rooms</a></div>`;
    return;
  }
  if (!alive()) return;
  const r = d.item;
  ROOMS[r.id] = r;
  const b = BADGE[r.v] || BADGE[1];
  const rv = r.reviews;
  reviewAnswers = {};
  const photo = (i, cls) => r.photos[i]
    ? `<div class="ph ${cls || ''}"><span>🏠</span><img class="gallery-img" data-label="${PHOTO_LABELS[i]}" onclick="openLightbox(${i})" src="${esc(r.photos[i])}" alt="${PHOTO_LABELS[i]} - ${esc(r.type)} in ${esc(r.area)}" loading="lazy"><span class="cap">${PHOTO_LABELS[i]}</span></div>`
    : '';
  app.innerHTML = `<section><div class="wrap"><button class="back" data-act="back">← Back</button>
  <div class="gal">${photo(0, 'big')}<div class="side">${[1, 2, 3].map((i) => photo(i)).join('')}</div></div>
  <div class="det"><div>
  <div class="badges">${badge(r.v)}${r.demo ? '<span class="ex">Example</span>' : ''}</div><p class="meta" style="margin:4px 0 8px">${esc(b.d)}</p>
  <div class="price" style="font-size:28px">${money(r.price)} <small>/ month</small></div>
  ${statusBox(r)}
  <p class="loc" style="font-size:18px">${esc(r.area)}, ${esc(r.prov)}</p>
  <p class="meta">${esc(r.type)} · For ${esc(r.for)} · Deposit: ${money(r.dep)}</p>
  <h2 style="font-size:18px;margin-top:18px">Description</h2><p style="white-space:pre-line">${esc(r.desc)}</p>
  <h2 style="font-size:18px;margin-top:18px">What's Included</h2>
  <div class="incl">${r.inc.length ? r.inc.map((i) => `<div>${ICON[i]} ${esc(i)}</div>`).join('') : '<div>Ask the landlord what is included</div>'}</div>
  <h2 style="font-size:18px">Tenant review</h2>
  <div class="revsum">${rv.total ? `${rv.photosYes} of ${rv.total} tenants said the room was like the photos. ${rv.honestYes} of ${rv.total} said the landlord was honest.` : 'No reviews yet.'}</div>
  <p class="meta" style="margin-bottom:8px">Moved in here? Tell other tenants the truth.</p>
  <div class="rev">
  <div class="yn">Was the room like the photos? <button data-act="yn" data-q="a" data-v="Yes">Yes</button><button data-act="yn" data-q="a" data-v="No">No</button></div>
  <div class="yn">Was the landlord honest? <button data-act="yn" data-q="b" data-v="Yes">Yes</button><button data-act="yn" data-q="b" data-v="No">No</button></div>
  <button class="btn sm" data-act="send-review" data-id="${r.id}" style="width:fit-content">Send Review</button><div id="rm" class="meta"></div></div></div>
  <aside class="box"><b>Landlord</b><p>${esc(r.who)}</p>
  <p class="meta">Member since ${r.since}${r.rented ? ` · ${r.rented} rooms rented` : ' · New landlord'}<br>Status: ${b.i} ${esc(b.n)}</p><br>
  ${av(r) === 'taken' ? '' : `<a class="btn wa" style="display:block" target="_blank" rel="noopener" href="/go/${r.id}">Chat to Landlord on WhatsApp</a>`}
  ${av(r) === 'available' ? '' : `<div class="wait" style="margin-top:8px" data-wait="${r.id}">${waitControls(r)}</div>`}
  <div class="lord"><p>Are you the landlord of this room? Is it TAKEN or AVAILABLE again? Do not press buttons. Just WhatsApp us and we will update it for you.</p><a class="btn wa sm" target="_blank" rel="noopener" href="${esc(lordLink(r))}">WhatsApp FindMyRoom To Update This Room</a></div>
  <div class="safe">⚠️ <b>Stay safe:</b><br>• Always view the room before paying.<br>• Never send money to book a room.<br>• Meet at the room during daytime.</div>
  <br><button class="btn redout sm" style="width:100%" data-act="report" data-id="${r.id}"> Report This Listing</button></aside></div></div></section>
  ${d.similar.length ? `<section style="background:var(--bg)"><div class="wrap"><h2>Similar rooms</h2><br><div class="grid">${d.similar.map(card).join('')}</div></div></section>` : ''}`;
  window.scrollTo(0, 0);
}

/* ---------- admin ---------- */
const ADMIN_PASSWORD = 'admin123';
let adminOk = false;

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  app.prepend(toast);
  setTimeout(() => toast.remove(), 3000);
}

async function adminPage(alive) {
  if (!adminOk) {
    const pw = prompt('Enter admin password:');
    if (pw !== ADMIN_PASSWORD) {
      if (pw !== null) alert('Wrong password.');
      location.hash = '#/home';
      return;
    }
    adminOk = true;
  }
  if (!alive()) return;
  let rooms;
  try {
    rooms = await api('/api/admin/rooms');
  } catch (e) {
    if (alive()) app.innerHTML = `<div class="wrap"><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (!alive()) return;
  renderAdmin(rooms.items, alive);
}

function renderAdmin(items, alive) {
  app.innerHTML = `
    <section><div class="wrap">
      <h2>Admin: Room Management</h2>
      <div class="ad-bar">
        <div class="pill hot" id="pill-available">Available: ${items.filter((l) => av(l) === 'available').length}</div>
        <div class="pill">Reserved: ${items.filter((l) => av(l) === 'reserved').length}</div>
        <div class="pill">Taken: ${items.filter((l) => av(l) === 'taken').length}</div>
      </div>
      <div class="ad-table">
        <table>
          <thead>
            <tr>
              <th>Photo</th>
              <th>Area</th>
              <th>Price</th>
              <th>Landlord</th>
              <th>Landlord WhatsApp</th>
              <th>Current Status</th>
              <th>Change Status</th>
              <th>Waiting List</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((r) => {
              const a = av(r);
              const wc = r.waitingCount || 0;
              const lordWa = r.phone ? 'https://wa.me/' + String(r.phone).replace(/^27/, '') : '';
              return `
            <tr>
              <td><img src="${esc((r.photos && r.photos[0]) || '')}" width="40" height="30" style="object-fit:cover;border-radius:4px;" alt="${esc(r.type)}"></td>
              <td><span style="font-size:12px;">${esc(r.area)}</span></td>
              <td><b>R${esc(r.price)}</b></td>
              <td><span style="font-size:12px;">${esc(r.fullName)}</span></td>
              <td><a href="${esc(lordWa)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--m)">${r.phone ? esc(String(r.phone).slice(-8)) : '—'}</a></td>
              <td><span class="st ${a}">${a}</span></td>
              <td>
                <button class="btn sm ${a === 'available' ? 'av-a' : 'out'}" data-act="set-availability" data-id="${r.id}" data-value="available">Available</button>
                <button class="btn sm ${a === 'reserved' ? 'av-r' : 'out'}" data-act="set-availability" data-id="${r.id}" data-value="reserved">Reserved</button>
                <button class="btn sm ${a === 'taken' ? 'av-t' : 'out'}" data-act="set-availability" data-id="${r.id}" data-value="taken">Taken</button>
              </td>
              <td><b>${wc}</b> ${wc === 1 ? 'person' : 'people'}</td>
            </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="meta" style="margin-top:16px;font-size:12px">Changes persist after refresh. Landlords WhatsApp admin to update status.</p>
    </div></section>`;
}

async function adminSetAvailability(id, value) {
  const room = ROOMS[id];
  if (value === 'taken' && !confirm('This room will be marked TAKEN. Tenants will see the Notify Me button. Continue?')) return;
  if (value === 'available' && !confirm('This room will be marked AVAILABLE again. People on the waiting list will be notified. Continue?')) return;
  try {
    await post('/api/admin/rooms/' + encodeURIComponent(id) + '/availability', { availability: value });
    showToast('Room updated to ' + value);
    route();
  } catch (e) {
    alert(e.message);
  }
}

/* ---------- saved rooms ---------- */
async function renderSavedPage(alive) {
  const ids = favourites.slice();
  const head = `<h2 style="font-family:Georgia,serif; font-size:28px; margin-bottom:12px;">My Saved Rooms</h2>
    <p style="color:var(--m); margin-bottom:24px;">Rooms you saved. They are saved on this phone only.</p>`;

  if (ids.length === 0) {
    app.innerHTML = `
      <section style="padding:34px 0">
        <div class="wrap">
          ${head}
          <div style="text-align:center">
            <div style="width:80px; height:80px; background:var(--bg); border-radius:50%; margin:0 auto 16px; display:grid; place-items:center; font-size:48px;">🤍</div>
            <h3 style="margin-bottom:12px;">No saved rooms yet</h3>
            <p style="color:var(--m);">Tap the ❤️ on any room to save it here.</p>
            <a href="#/find" class="btn" style="background:var(--g); color:#fff; padding:12px 24px; border-radius:10px; font-weight:700;">Find a Room →</a>
          </div>
        </div>
      </section>`;
    return;
  }

  app.innerHTML = `<section style="padding:34px 0"><div class="wrap">${head}${loading('Loading your saved rooms…')}</div></section>`;

  // Ask the server for each saved room. Rooms that were removed or hidden come back as null.
  const results = await Promise.all(ids.map((id) =>
    api('/api/listings/' + encodeURIComponent(id)).then((d) => d.item).catch(() => null)));
  if (!alive()) return;
  const savedRooms = results.filter(Boolean);

  if (savedRooms.length === 0) {
    app.innerHTML = `<section style="padding:34px 0"><div class="wrap">${head}<div class="empty">Your saved rooms are no longer available.</div></div></section>`;
    return;
  }

  app.innerHTML = `
    <section style="padding:34px 0">
      <div class="wrap">
        ${head}
        <div class="ad-bar" style="margin-bottom:16px;">
          <div class="pill" style="background:var(--bg); border-radius:99px; padding:4px 12px; font-size:13px; font-weight:700;">${savedRooms.length} saved</div>
          <button class="btn sm out" id="clear-all-btn" style="background:#fff; color:var(--r); border:2px solid var(--r); padding:6px 12px; border-radius:10px; font-size:12px;">Clear All Saved</button>
        </div>
        <div class="grid" id="saved-rooms-grid">${savedRooms.map(card).join('')}</div>
        <div style="margin-top:24px; padding-top:24px; border-top:1px solid var(--b); font-size:12px; color:var(--m);">
          <p>Saved on this phone only. If you use another phone, your saved rooms will not show there. This is to keep you safe - no login needed.</p>
        </div>
      </div>
    </section>`;

  $('#clear-all-btn').addEventListener('click', () => {
    if (!confirm('Remove all saved rooms?')) return;
    saveFavourites([]);
    renderSavedPage(alive);
  });
}

/* ---------- other pages ---------- */
function list() {
  app.innerHTML = `<section><div class="wrap"><h2>List Your Room</h2><p class="sub">Free. Takes 2 minutes. Your WhatsApp number stays on your listing so tenants can always reach you.</p>
  <form class="f" id="lf">
  <div><label class="h">Full Name</label><input name="fullName" required maxlength="60" autocomplete="name"></div>
  <div><label class="h">WhatsApp Number</label><input name="phone" type="tel" required placeholder="e.g. 071 234 5678" autocomplete="tel"><div class="hint">Tenants reach you through a WhatsApp button. We never show your number on the page.</div></div>
  <div><label class="h">Province</label><select name="prov" required>${opts(PROV, 'Select province')}</select></div>
  <div><label class="h">Town / Township / Area</label><input name="area" required maxlength="60" placeholder="e.g. Soweto (Orlando East)"></div>
  <div><label class="h">Street Name (optional)</label><input name="street" maxlength="80"><div class="hint">Only our team sees this. Give the full address to tenants on WhatsApp.</div></div>
  <div><label class="h">Monthly Rent (R)</label><input name="price" type="number" min="100" max="50000" required inputmode="numeric"></div>
  <div><label class="h">Deposit (R)</label><input name="dep" type="number" min="0" max="100000" inputmode="numeric"></div>
  <div><label class="h">Room Type</label><select name="type" required>${opts(TYPES, 'Select type')}</select></div>
  <div><label class="h">What's Included</label><div class="cbx">${checkboxes(INCL, 'inc')}</div></div>
  <div><label class="h">For</label><select name="for"><option>Anyone</option><option>Male</option><option>Female</option></select></div>
  <div><label class="h">Upload 4 Photos</label><div class="photos4">${PHOTO_LABELS.map((l, i) => `<div><label class="h">${i + 1}. ${l}</label><input type="file" accept="image/*" data-photo="${i}" required></div>`).join('')}</div><div class="hint">Use real photos of your room. Photos are made smaller on your phone to save data.</div></div>
  <div><label class="h">Short Description (2 sentences)</label><textarea name="desc" rows="3" required minlength="10" maxlength="400"></textarea></div>
  ${honeypot}
  <label class="cbx"><input type="checkbox" name="agree" required> I agree I will not ask for payment before viewing</label>
  <button class="btn" type="submit">List My Room Free</button></form></div></section>`;
  const form = $('#lf');
  handleForm(form, 'List My Room Free', async (fd) => {
    fd.delete('photos');
    const inputs = $$('input[data-photo]');
    for (const input of inputs) {
      const f = input.files[0];
      if (!f) throw new Error('Please add all 4 photos.');
      if (f.size > 25 * 1024 * 1024) throw new Error('One of your photos is too big. Please choose a smaller one.');
      fd.append('photos', await shrinkImage(f), 'photo' + input.dataset.photo + '.jpg');
    }
    await api('/api/listings', { method: 'POST', body: fd });
    showSuccess(form, 'Thank you! Your room will be reviewed and posted within 24 hours.', 'To get a Blue Badge, send us a video of you at the room on WhatsApp.');
  });
}

function need() {
  app.innerHTML = `<section><div class="wrap"><h2>I Need A Room</h2><p class="sub">Tell us what you need. We will send you matching rooms.</p>
  <form class="f" id="nf">
  <div><label class="h">Name</label><input name="name" required maxlength="60" autocomplete="name"></div>
  <div><label class="h">WhatsApp Number</label><input name="phone" type="tel" required placeholder="e.g. 071 234 5678" autocomplete="tel"></div>
  <div><label class="h">Province</label><select name="prov" required>${opts(PROV, 'Select province')}</select></div>
  <div><label class="h">Area wanted</label><input name="area" required maxlength="60" placeholder="e.g. Mamelodi"></div>
  <div><label class="h">Budget</label><select name="budget" required>${opts(BUDGETS, 'Select budget')}</select></div>
  <div><label class="h">Move-in date</label><input name="moveIn" type="date" required></div>
  <div><label class="h">I am</label><select name="gender" required><option value="">Select</option><option>Male</option><option>Female</option></select></div>
  <div><label class="h">What do you need?</label><div class="cbx">${checkboxes(NEEDS, 'needs')}</div></div>
  ${honeypot}
  <button class="btn" type="submit">Find Me A Room</button></form></div></section>`;
  const form = $('#nf');
  form.moveIn.min = new Date().toISOString().slice(0, 10);
  handleForm(form, 'Find Me A Room', async (fd) => {
    await post('/api/requests', {
      name: fd.get('name'), phone: fd.get('phone'), prov: fd.get('prov'), area: fd.get('area'),
      budget: fd.get('budget'), moveIn: fd.get('moveIn'), gender: fd.get('gender'),
      needs: fd.getAll('needs'), website: fd.get('website'),
    });
    showSuccess(form, 'Got it! We will send you matching rooms on WhatsApp.');
  });
}

function safety() {
  app.innerHTML = `<section><div class="wrap"><h2>How To Avoid Room Scams In South Africa</h2><p class="sub">Read this before you pay anyone.</p>
  <ol class="sl">
  <li>Never pay before you see the room in person</li>
  <li>Always view during daytime, take someone with you</li>
  <li>Never send money via eWallet, CashSend, or voucher to "book" a room</li>
  <li>Ask for the landlord's ID and check it matches the name on the listing</li>
  <li>If the price is too cheap to be true (e.g. R500 for a flat in Sandton), it's a scam</li>
  <li>If landlord says "I'm overseas, send deposit and I'll send keys", it's a scam</li>
  <li>Always get a receipt and a simple rental agreement</li>
  <li>If you suspect a scam, report it on FindMyRoom immediately</li></ol>
  <p style="margin-top:22px"><a class="btn red big" href="#/scams"> Report A Scammer</a></p></div></section>`;
}

async function scams(alive) {
  app.innerHTML = `<section><div class="wrap"><h2>Scam Wall</h2><p class="sub">Reported scam phone numbers. <b style="color:var(--r)">Do NOT send money to these numbers.</b></p>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));margin-bottom:28px" id="sw">${loading()}</div>
  <h2 style="font-size:20px">Report A Scammer</h2><p class="sub">Give us the number and what happened. We check every report before it goes on the wall.</p>
  <form class="f" id="sf">
  <div><label class="h">Scammer's phone number</label><input name="number" required type="tel"></div>
  <div><label class="h">What happened?</label><textarea name="what" rows="4" required minlength="10" maxlength="500"></textarea></div>
  <div><label class="h">Your WhatsApp (optional)</label><input name="reporter" type="tel"><div class="hint">Only our team sees this, in case we need to ask you a question.</div></div>
  ${honeypot}
  <button class="btn red" type="submit">Send Report</button></form></div></section>`;
  const form = $('#sf');
  handleForm(form, 'Send Report', async (fd) => {
    await post('/api/scams', { number: fd.get('number'), what: fd.get('what'), reporter: fd.get('reporter'), website: fd.get('website') });
    showSuccess(form, 'Thank you for reporting. We will review this and add it to the Scam Wall if it is confirmed.');
  });
  try {
    const d = await api('/api/scams');
    if (!alive()) return;
    $('#sw').innerHTML = d.items.length
      ? d.items.map((s) => `<div class="scam"><div><b>${esc(s.number)}</b><p>${esc(s.what)}</p></div><span class="meta">Reported ${s.count} time${s.count === 1 ? '' : 's'}</span></div>`).join('')
      : '<div class="empty" style="grid-column:1/-1">No confirmed scam numbers yet.</div>';
  } catch (e) {
    if (alive()) $('#sw').innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(e.message)}</div>`;
  }
}

function about() {
  const wa = `https://wa.me/${CFG.whatsapp}`;
  const nice = '0' + CFG.whatsapp.replace(/^27/, '');
  app.innerHTML = `<section><div class="wrap" style="max-width:720px"><h2>About FindMyRoom</h2>
  <div class="founder" aria-label="Founder photo placeholder">👤</div>
  <p>Hi, I'm <b>${esc(CFG.founder)}</b> from Mbombela. I started FindMyRoom because I got scammed looking for a room. I paid a deposit for a room that didn't exist. I decided no one else should go through that. FindMyRoom is built to be simple, honest, and safe - especially for people in townships.</p>
  <h2 style="margin-top:28px;font-size:20px">Contact</h2>
  <p>WhatsApp: <a style="color:var(--g);font-weight:700" target="_blank" rel="noopener" href="${esc(wa)}">${esc(nice)}</a><br>Email: <a style="color:var(--g)" href="mailto:${esc(CFG.email)}">${esc(CFG.email)}</a><br>
  <a href="${esc(CFG.facebook)}" target="_blank" rel="noopener" style="color:var(--g)">Facebook</a> · <a href="${esc(CFG.tiktok)}" target="_blank" rel="noopener" style="color:var(--g)">TikTok</a></p>
  <p style="margin-top:14px"><a class="btn red" href="#/scams"> Report A Scam</a></p>
  <h2 style="margin-top:28px;font-size:20px">Verification levels</h2>
  ${[1, 2, 3].map((l) => `<p style="margin:8px 0"><span class="badge ${BADGE[l].c}">${BADGE[l].i} ${esc(BADGE[l].n)}</span><br><span class="meta">${esc(BADGE[l].d)}</span></p>`).join('')}
  <h2 style="margin-top:28px;font-size:20px">Terms</h2><p class="meta">FindMyRoom only connects tenants and landlords. We do not take deposits and we are not a party to any rental agreement. Tenants pay the landlord directly, only after viewing the room. Landlords must stay contactable on the WhatsApp number they list. Listings that different people report are hidden until we check them.</p>
  <h2 style="margin-top:28px;font-size:20px">Privacy</h2><p class="meta">We only use your details to match tenants and landlords. We never sell your information. A landlord's phone number is never shown on the page.</p></div></section>`;
}

/* ---------- routing ---------- */
let routeToken = 0;
function route() {
  const my = ++routeToken;
  const alive = () => my === routeToken;
  const h = location.hash.replace(/^#\/?/, '').split('/');
  const p = h[0] || 'home';
  $$('nav.links a').forEach((a) => a.classList.toggle('on', a.dataset.p === p));
  $('#nl').classList.remove('open');
  closeModal();
  const pages = {
    home: () => home(alive),
    find: () => find(alive),
    room: () => room(h[1], alive),
    list, need, safety, about,
    admin: () => adminPage(alive),
    scams: () => scams(alive),
    saved: () => renderSavedPage(alive),
  };
  (pages[p] || pages.home)();
  if (p !== 'room') window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('a[href="#/find"]')) F = {};

  // Heart button: save / unsave a room without opening it
  const heart = e.target.closest('.fav-btn');
  if (heart) {
    e.preventDefault();
    e.stopPropagation();
    const id = heart.dataset.id;
    toggleFavourite(id);
    if (location.hash === '#/saved') { route(); return; } // room disappears from the saved list
    const on = isFavourite(id);
    heart.textContent = on ? '♥️' : '♡';
    heart.style.color = on ? '#EF4444' : '';
    heart.setAttribute('aria-label', on ? 'Unsave room' : 'Save room');
    heart.style.transform = 'scale(1.2)';
    setTimeout(() => { heart.style.transform = ''; }, 200);
    return;
  }

  const t = e.target.closest('[data-act]');
  if (e.target.id === 'modal') return closeModal();
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'badge') badgeInfo(Number(t.dataset.v));
  else if (act === 'report') reportBox(t.dataset.id);
  else if (act === 'send-report') sendReport(t.dataset.id, t);
  else if (act === 'report-done') { closeModal(); route(); }
  else if (act === 'close') closeModal();
  else if (act === 'notify') notifyBox(t.dataset.id);
  else if (act === 'notify-send') sendNotify(t.dataset.id, t);
  else if (act === 'check') checkRoom(t.dataset.id, t);
  else if (act === 'set-availability') adminSetAvailability(t.dataset.id, t.dataset.value);
  else if (act === 'back') history.back();
  else if (act === 'area') { F = { q: t.dataset.a }; location.hash = '#/find'; }
  else if (act === 'yn') {
    reviewAnswers[t.dataset.q] = t.dataset.v;
    t.parentNode.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === t));
  } else if (act === 'send-review') {
    const msg = $('#rm');
    if (!reviewAnswers.a || !reviewAnswers.b) { msg.textContent = 'Please answer both questions.'; return; }
    t.disabled = true;
    post(`/api/listings/${t.dataset.id}/reviews`, { photosMatch: reviewAnswers.a === 'Yes', honest: reviewAnswers.b === 'Yes' })
      .then(() => { msg.textContent = 'Thank you for your review.'; })
      .catch((err) => { msg.textContent = err.message; t.disabled = false; });
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.remove(); }, true);
$('#burger').addEventListener('click', () => $('#nl').classList.toggle('open'));
window.addEventListener('hashchange', route);

/* ---------- start ---------- */
(async function init() {
  try {
    CFG = await api('/api/config');
  } catch (e) { /* use defaults */ }
  $('#f-wa').href = 'https://wa.me/' + CFG.whatsapp;
  $('#wafloat').href = 'https://wa.me/' + CFG.whatsapp + '?text=' + encodeURIComponent('Hi FindMyRoom');
  $('#f-fb').href = CFG.facebook;
  $('#f-tt').href = CFG.tiktok;
  updateFavCount();
  route();
})();

// Lightbox Gallery
let galleryImages = [];
let galleryIndex = 0;

function openLightbox(index) {
  galleryIndex = index;
  // Collect all gallery images on the page
  galleryImages = document.querySelectorAll('.gallery-img');
  // Filter out elements without a valid src
  const validImages = [];
  galleryImages.forEach((img) => {
    if (img.src && !img.src.includes('placeholder') && img.src.length > 0) {
      validImages.push({
        src: img.src,
        label: img.dataset.label || 'Room',
      });
    }
  });
  galleryImages = validImages;

  if (galleryImages.length === 0) return;

  galleryIndex = Math.max(0, Math.min(index, galleryImages.length - 1));

  const lightbox = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightbox-img');
  const lbLabel = document.getElementById('lightbox-label');
  const lbCount = document.getElementById('lightbox-count');

  lbImg.src = galleryImages[galleryIndex].src;
  lbLabel.textContent = galleryImages[galleryIndex].label;
  lbCount.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;

  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

// The photos use onclick="openLightbox(...)", which needs a global function
window.openLightbox = openLightbox;

function lightboxMove(dir) {
  galleryIndex = (galleryIndex + dir + galleryImages.length) % galleryImages.length;
  showLightboxImage();
}

function showLightboxImage() {
  const lbImg = document.getElementById('lightbox-img');
  const lbLabel = document.getElementById('lightbox-label');
  const lbCount = document.getElementById('lightbox-count');

  lbImg.src = galleryImages[galleryIndex].src;
  lbLabel.textContent = galleryImages[galleryIndex].label;
  lbCount.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  lightbox.classList.remove('active');
  document.body.style.overflow = '';
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox.classList.contains('active')) return;

  if (e.key === 'Escape') {
    closeLightbox();
  } else if (e.key === 'ArrowRight') {
    lightboxMove(1);
  } else if (e.key === 'ArrowLeft') {
    lightboxMove(-1);
  }
});

// Swipe navigation for mobile
let touchStartX = 0;
let touchEndX = 0;

document.addEventListener('touchstart', (e) => {
  touchStartX = e.changedTouches[0].screenX;
}, false);

document.addEventListener('touchend', (e) => {
  touchEndX = e.changedTouches[0].screenX;
  handleSwipe();
}, false);

function handleSwipe() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox.classList.contains('active')) return;

  const swipeThreshold = 50;
  const diff = touchStartX - touchEndX;

  if (Math.abs(diff) > swipeThreshold) {
    if (diff > 0) {
      // Swipe left - next image
      lightboxMove(1);
    } else {
      // Swipe right - previous image
      lightboxMove(-1);
    }
  }
}

// Close on background click
document.getElementById('lightbox').addEventListener('click', (e) => {
  const lightbox = document.getElementById('lightbox');
  if (e.target === lightbox) {
    closeLightbox();
  }
});

// Arrow button listeners
document.querySelector('.lb-prev').addEventListener('click', () => lightboxMove(-1));
document.querySelector('.lb-next').addEventListener('click', () => lightboxMove(1));
document.querySelector('.lb-close').addEventListener('click', closeLightbox);

})();