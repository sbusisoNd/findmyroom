(function () {
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#root');
const BADGE = { 1: '✔ Phone Verified', 2: '🛡️ ID + Video Verified', 3: '⭐ Visited By FindMyRoom' };
const AVC = { available: 'av-a', taken: 'av-t', reserved: 'av-r' };
const AVT = { available: 'Available', taken: 'Taken', reserved: 'Reserved - Viewing' };

let token = '';
try { token = sessionStorage.getItem('fmr_admin') || ''; } catch (e) { /* storage blocked */ }
let DATA = null;
let tab = 'listings';
let lf = 'pending';

async function api(path, method, body) {
  const r = await fetch(path, {
    method: method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* ignore */ }
  if (r.status === 401 && path !== '/api/admin/login') { logout(); throw new Error('Please log in again.'); }
  if (!r.ok) throw new Error((j && j.error) || 'Something went wrong.');
  return j;
}

function logout() {
  token = '';
  try { sessionStorage.removeItem('fmr_admin'); } catch (e) { /* ignore */ }
  showLogin();
}

function showLogin(msg) {
  root.innerHTML = `<form class="login" id="lg"><h1>FindMyRoom Admin</h1>
  <input type="password" id="pw" placeholder="Admin password" autocomplete="current-password" required autofocus>
  ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
  <button class="btn" type="submit">Log in</button></form>`;
  $('#lg').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/admin/login', 'POST', { password: $('#pw').value });
      token = r.token;
      try { sessionStorage.setItem('fmr_admin', token); } catch (err) { /* ignore */ }
      load();
    } catch (err) {
      showLogin(err.message);
    }
  });
}

async function load() {
  try {
    DATA = await api('/api/admin/data');
    render();
  } catch (e) {
    if (token) root.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

const when = (iso) => new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
const waLink = (n, text) => `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;

function render() {
  const s = DATA.stats;
  root.innerHTML = `<h1>FindMyRoom Admin</h1>
  <div class="ad-bar">
    <span class="pill ${s.pending ? 'hot' : ''}">${s.pending} waiting for review</span>
    <span class="pill">${s.live} live</span>
    <span class="pill ${s.flagged ? 'hot' : ''}">${s.flagged} hidden by reports</span>
    <span class="pill ${s.scamsPending ? 'hot' : ''}">${s.scamsPending} scam reports to check</span>
    <span class="pill">${s.requests} tenant requests</span>
    <button class="btn out sm" data-a="refresh">Refresh</button>
    <button class="btn out sm" data-a="logout">Log out</button>
  </div>
  <div class="tabs">
    <button data-a="tab" data-t="listings" class="${tab === 'listings' ? 'on' : ''}">Listings</button>
    <button data-a="tab" data-t="scams" class="${tab === 'scams' ? 'on' : ''}">Scam reports</button>
    <button data-a="tab" data-t="requests" class="${tab === 'requests' ? 'on' : ''}">Tenant requests</button>
  </div>
  <div id="pane"></div>`;
  ({ listings: renderListings, scams: renderScams, requests: renderRequests }[tab])();
}

function renderListings() {
  const filters = [['pending', 'Needs review'], ['flagged', 'Hidden by reports'], ['live', 'Live'], ['rejected', 'Rejected'], ['all', 'All']];
  const match = {
    pending: (l) => l.status === 'pending',
    flagged: (l) => l.hidden,
    live: (l) => l.status === 'approved' && !l.hidden,
    rejected: (l) => l.status === 'rejected',
    all: () => true,
  }[lf];
  const items = DATA.listings.filter(match);
  $('#pane').innerHTML = `<div class="ad-row" style="margin-bottom:10px">Show:
  <select id="lfsel">${filters.map(([k, n]) => `<option value="${k}" ${k === lf ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
  ${items.length ? items.map(listingCard).join('') : '<div class="empty">Nothing here.</div>'}`;
  $('#lfsel').addEventListener('change', (e) => { lf = e.target.value; renderListings(); });
}

function listingCard(l) {
  const open = l.reports.filter((r) => !r.dismissed);
  const hello = `Hi ${String(l.fullName).split(/\s+/)[0]}, this is FindMyRoom about your room in ${l.area}.`;
  return `<div class="ad-card ${l.hidden ? 'flag' : ''}">
  <div class="ad-row"><b>#${l.id} · ${esc(l.fullName)}</b>
    <span class="st ${l.status}">${l.status}</span>${l.hidden ? '<span class="st rejected">HIDDEN</span>' : ''}${l.demo ? '<span class="ex">Example</span>' : ''}
    <span class="meta">${when(l.createdAt)}</span></div>
  <div class="ad-photos">${l.photos.map((p) => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(p)}" alt="" loading="lazy"></a>`).join('')}</div>
  <div>R${l.price} / month · deposit R${l.dep} · ${esc(l.type)} · for ${esc(l.for)}<br>
  ${esc(l.area)}, ${esc(l.prov)}${l.street ? ' · Street: ' + esc(l.street) : ''}<br>
  Included: ${l.inc.length ? esc(l.inc.join(', ')) : 'nothing listed'}<br>
  <span class="meta" style="white-space:pre-line">${esc(l.desc)}</span></div>
  <div class="ad-row"><span>📱 ${l.demo ? '(example number)' : '0' + esc(String(l.phone).slice(2))}</span>
    ${l.demo ? '' : `<a class="btn wa sm" target="_blank" rel="noopener" href="${esc(waLink(l.phone, hello))}">Message on WhatsApp</a>`}</div>
  ${open.length ? `<div class="err">🚩 ${open.length} report${open.length === 1 ? '' : 's'}: ${esc(open.map((r) => r.reason).join('; '))}</div>` : ''}
  ${l.reviews.total ? `<div class="meta">Tenant reviews: ${l.reviews.photosYes}/${l.reviews.total} said room matched photos · ${l.reviews.honestYes}/${l.reviews.total} said landlord honest</div>` : ''}
  ${l.status === 'approved' ? `<div class="ad-row"><b>Availability:</b> <span class="avb ${AVC[l.availability] || 'av-a'}">${AVT[l.availability] || 'Available'}</span>
    <button class="btn sm" data-a="avail" data-v="available" data-id="${l.id}">Mark Available</button>
    <button class="btn yel sm" data-a="avail" data-v="reserved" data-id="${l.id}">Mark Reserved</button>
    <button class="btn red sm" data-a="avail" data-v="taken" data-id="${l.id}">Mark Taken</button>
    <span class="meta">Updated ${when(l.availabilityUpdatedAt || l.createdAt)} · ${l.waitingCount || 0} waiting</span></div>
  ${(l.waiting || []).length ? `<div class="meta">Waiting list: ${l.waiting.map((w) => `<a style="color:var(--g);font-weight:700" target="_blank" rel="noopener" href="${esc(waLink(w.phone))}">${esc(w.name)} (0${esc(String(w.phone).slice(2))})</a>`).join(' · ')}</div>` : ''}` : ''}
  <div class="ad-row">
    <label>Badge <select data-a="v" data-id="${l.id}">${[1, 2, 3].map((n) => `<option value="${n}" ${l.v === n ? 'selected' : ''}>${BADGE[n]}</option>`).join('')}</select></label>
    <span class="meta">Rooms rented: ${l.roomsRented || 0}</span>
    <button class="btn out sm" data-a="rented" data-id="${l.id}" data-n="${l.roomsRented || 0}">Edit</button>
  </div>
  <div class="ad-row">
    ${l.status !== 'approved' ? `<button class="btn sm" data-a="approve" data-id="${l.id}">✅ Approve (marks phone verified)</button>` : ''}
    ${l.status !== 'rejected' ? `<button class="btn redout sm" data-a="reject" data-id="${l.id}">Reject</button>` : ''}
    ${l.hidden ? `<button class="btn out sm" data-a="restore" data-id="${l.id}">Restore (clears reports)</button>` : l.status === 'approved' ? `<button class="btn out sm" data-a="hide" data-id="${l.id}">Hide</button>` : ''}
    <button class="btn red sm" data-a="delete" data-id="${l.id}">Delete</button>
  </div></div>`;
}

function renderScams() {
  const items = DATA.scams;
  $('#pane').innerHTML = items.length ? items.map((s) => `<div class="ad-card">
  <div class="ad-row"><b style="font-size:18px">${esc(s.number)}</b><span class="st ${s.status}">${s.status}</span>
  <span class="meta">Reported ${s.count} time${s.count === 1 ? '' : 's'} · first ${when(s.createdAt)}</span></div>
  <div class="meta" style="white-space:pre-line">${esc(s.details.join('\n— \n'))}</div>
  ${s.reporters.length ? `<div class="meta">Reporter WhatsApp (private): ${esc(s.reporters.join(', '))}</div>` : ''}
  <div class="ad-row">
  ${s.status !== 'approved' ? `<button class="btn sm" data-a="sapprove" data-id="${s.id}">Put on Scam Wall</button>` : ''}
  ${s.status !== 'rejected' ? `<button class="btn redout sm" data-a="sreject" data-id="${s.id}">Reject</button>` : ''}
  <button class="btn red sm" data-a="sdelete" data-id="${s.id}">Delete</button></div></div>`).join('')
    : '<div class="empty">No scam reports yet.</div>';
}

function renderRequests() {
  const items = DATA.requests;
  $('#pane').innerHTML = items.length ? items.map((r) => {
    const links = r.matches.slice(0, 5).map((m) => `${m.area} R${m.price}: ${location.origin}/#/room/${m.id}`).join('\n');
    const text = `Hi ${r.name}, this is FindMyRoom. Here are rooms that match what you asked for:\n${links}\nRemember: never pay before you view the room.`;
    return `<div class="ad-card">
    <div class="ad-row"><b>${esc(r.name)}</b><span class="meta">${when(r.createdAt)}</span></div>
    <div>${esc(r.area)}, ${esc(r.prov)} · budget ${esc(r.budget)} · move in ${esc(r.moveIn)} · ${esc(r.gender)}<br>
    Needs: ${r.needs.length ? esc(r.needs.join(', ')) : 'nothing special'}<br>📱 0${esc(String(r.phone).slice(2))}</div>
    <div class="ad-row">
    ${r.matches.length ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${esc(waLink(r.phone, text))}">Send ${Math.min(r.matches.length, 5)} matching room${r.matches.length === 1 ? '' : 's'} on WhatsApp</a>` : '<span class="meta">No matching rooms yet</span>'}
    <a class="btn out sm" target="_blank" rel="noopener" href="${esc(waLink(r.phone))}">Open chat</a>
    <button class="btn red sm" data-a="rdelete" data-id="${r.id}">Delete</button></div></div>`;
  }).join('') : '<div class="empty">No tenant requests yet.</div>';
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

function adminModal(html) {
  let m = $('#modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal';
    m.className = 'modal';
    m.innerHTML = '<div class="mbox" id="mbox"></div>';
    document.body.appendChild(m);
    m.addEventListener('click', (e) => {
      if (e.target === m) return m.classList.remove('show');
      const t = e.target.closest('[data-m]');
      if (!t) return;
      if (t.dataset.m === 'close') m.classList.remove('show');
      else if (t.dataset.m === 'notify') notifyAll(t.dataset.id);
    });
  }
  $('#mbox').innerHTML = html;
  m.classList.add('show');
}

async function setAvail(id, value) {
  const l = DATA.listings.find((x) => x.id === Number(id));
  try {
    const r = await api('/api/admin/listings/' + id + '/availability', 'POST', { availability: value });
    await load();
    toast(`Room in ${l ? l.area : 'this area'} updated to ${AVT[value]}`);
    if (value === 'taken') {
      adminModal('<h3>Marked TAKEN</h3><p>This room is now marked TAKEN. Tenants will see Notify Me button.</p><button class="btn" data-m="close">OK</button>');
    } else if (value === 'available' && r.before !== 'available' && r.waitingCount > 0) {
      adminModal(`<h3>Available again</h3><p>This room is now AVAILABLE again. ${r.waitingCount} ${r.waitingCount === 1 ? 'person is' : 'people are'} waiting for this room. Notify them now?</p>
      <button class="btn" data-m="notify" data-id="${id}">Yes, Notify All Waiting Tenants</button><button class="linkbtn" data-m="close">Not now</button>`);
    }
  } catch (e) {
    alert(e.message);
  }
}

async function notifyAll(id) {
  try {
    const r = await api('/api/admin/listings/' + id + '/notify', 'POST', {});
    const m = $('#modal');
    if (m) m.classList.remove('show');
    await load();
    toast(`Notifications sent to ${r.count} tenant${r.count === 1 ? '' : 's'} on WhatsApp. (Test mode: saved and logged, not really sent yet)`);
  } catch (e) {
    alert(e.message);
  }
}

async function act(name, id, extra) {
  try {
    if (name === 'approve') await api('/api/admin/listings/' + id, 'PATCH', { status: 'approved' });
    else if (name === 'reject') await api('/api/admin/listings/' + id, 'PATCH', { status: 'rejected' });
    else if (name === 'hide') await api('/api/admin/listings/' + id, 'PATCH', { hidden: true });
    else if (name === 'restore') await api('/api/admin/listings/' + id, 'PATCH', { hidden: false });
    else if (name === 'v') await api('/api/admin/listings/' + id, 'PATCH', { v: Number(extra) });
    else if (name === 'rented') await api('/api/admin/listings/' + id, 'PATCH', { roomsRented: extra });
    else if (name === 'delete') await api('/api/admin/listings/' + id, 'DELETE');
    else if (name === 'sapprove') await api('/api/admin/scams/' + id, 'PATCH', { status: 'approved' });
    else if (name === 'sreject') await api('/api/admin/scams/' + id, 'PATCH', { status: 'rejected' });
    else if (name === 'sdelete') await api('/api/admin/scams/' + id, 'DELETE');
    else if (name === 'rdelete') await api('/api/admin/requests/' + id, 'DELETE');
    await load();
  } catch (e) {
    alert(e.message);
  }
}

root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-a]');
  if (!t || t.tagName === 'SELECT') return;
  const a = t.dataset.a;
  if (a === 'logout') logout();
  else if (a === 'refresh') load();
  else if (a === 'tab') { tab = t.dataset.t; render(); }
  else if (a === 'avail') setAvail(t.dataset.id, t.dataset.v);
  else if (a === 'delete') { if (confirm('Delete this listing and its photos for good?')) act(a, t.dataset.id); }
  else if (a === 'sdelete' || a === 'rdelete') { if (confirm('Delete this for good?')) act(a, t.dataset.id); }
  else if (a === 'rented') {
    const n = prompt('How many rooms has this landlord rented out through FindMyRoom?', t.dataset.n);
    if (n !== null) act('rented', t.dataset.id, n.trim());
  } else act(a, t.dataset.id);
});
root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.a === 'v') act('v', t.dataset.id, t.value);
});

if (token) load(); else showLogin();
})();
