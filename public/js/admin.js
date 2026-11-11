// Runner data is always written with textContent (via el()), never as HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

class AuthError extends Error {}
async function api(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new AuthError();
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const $ = (id) => document.getElementById(id);
const TABS = ['dashboard', 'runners', 'notify', 'settings', 'data'];
const money = (n) => `$${n.toLocaleString('en-US')}`;
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fullDate = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

let runners = [];

function showLogin() {
  TABS.forEach((t) => ($(`tab-${t}`).hidden = true));
  $('admin-nav').hidden = true;
  $('login').hidden = false;
  $('login').elements.password.focus();
}

async function showTab(tab) {
  if (!TABS.includes(tab)) tab = 'dashboard';
  $('login').hidden = true;
  $('admin-nav').hidden = false;
  TABS.forEach((t) => ($(`tab-${t}`).hidden = t !== tab));
  document.querySelectorAll('#admin-nav [data-tab]').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', `#${tab}`);
  try {
    await { dashboard: loadDashboard, runners: loadRunners, notify: loadNotify, settings: loadSettings, data: loadDataTools }[tab]();
  } catch (err) {
    if (!(err instanceof AuthError)) toast(err.message);
  }
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: 'toast', role: 'status' }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 3500);
}

// ---------- Dashboard ----------
function tile(label, value, note) {
  return el('div', { class: 'tile' },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: 'tile-value' }, value),
    note ? el('div', { class: 'tile-note' }, note) : null);
}

function bars(title, rows) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const chart = el('div', { class: 'bars' });
  rows.forEach((r) => {
    chart.append(
      el('div', { class: 'bar-label' }, r.label),
      el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${(r.n / max) * 100}%`, title: `${r.label}: ${r.n}` })),
      el('div', { class: 'bar-value' }, String(r.n))
    );
  });
  return el('div', { class: 'panel' }, el('h2', {}, title), chart);
}

function runnersLink(filter, text) {
  return el('button', {
    type: 'button',
    class: 'link',
    onclick: () => {
      $('filter').value = filter;
      showTab('runners');
    }
  }, text);
}

async function loadDashboard() {
  const s = await api('/summary');
  const pct = s.capacity ? Math.min(100, Math.round((s.registered / s.capacity) * 100)) : 0;
  const root = $('tab-dashboard');
  root.replaceChildren(
    el('div', { class: 'toolbar' }, el('h1', {}, `${s.year} Race HQ`)),
    el('div', { class: 'capacity panel' },
      el('div', { class: 'capacity-head' },
        el('span', { class: 'hero-number' }, String(s.registered)),
        el('span', {}, ` of ${s.capacity} spots filled`),
        el('span', { class: 'capacity-left' }, `${Math.max(s.capacity - s.registered, 0)} left`)),
      el('div', { class: 'meter', role: 'img', 'aria-label': `${pct}% of capacity filled` },
        el('div', { class: 'meter-fill', style: `width:${pct}%` }))),
    el('div', { class: 'tiles' },
      tile('Collected', money(s.revenue), `${s.paid} paid`),
      tile('Outstanding', money(s.outstanding), s.unpaid ? runnersLink('unpaid', `See ${s.unpaid} unpaid`) : 'Everyone has paid'),
      tile('Waitlist', String(s.waitlist), s.waitlist ? runnersLink('waitlist', 'See waitlist') : null),
      tile('Packets picked up', `${s.packets} / ${s.registered}`, s.registered > s.packets ? runnersLink('nopacket', 'See who is left') : null),
      tile('Finishers', String(s.finishers)),
      tile('Notify list', String(s.notifyCount))),
    el('div', { class: 'panels' },
      bars('T-shirts to order', s.shirts),
      bars('Prize categories', s.categories),
      bars('Dietary needs', s.diets))
  );
}

// ---------- Runners ----------
async function loadRunners() {
  runners = await api('/registrations');
  renderRunners();
}

function visibleRunners() {
  const filter = $('filter').value;
  const q = $('search').value.trim().toLowerCase();
  return runners.filter((r) => {
    const match = {
      active: r.status !== 'cancelled',
      registered: r.status === 'registered',
      unpaid: r.status === 'registered' && !r.paid,
      nopacket: r.status === 'registered' && !r.packet_picked_up,
      waitlist: r.status === 'waitlist',
      cancelled: r.status === 'cancelled',
      all: true
    }[filter];
    if (!match) return false;
    if (!q) return true;
    return `${r.first_name} ${r.last_name} ${r.email} ${r.bib} ${r.code}`.toLowerCase().includes(q);
  });
}

async function saveRunner(id, changes) {
  try {
    const updated = await api(`/registrations/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    runners = runners.map((r) => (r.id === id ? updated : r));
    return updated;
  } catch (err) {
    if (!(err instanceof AuthError)) toast(err.message);
    renderRunners();
    return null;
  }
}

function statusSelect(r, onChange) {
  const select = el('select', {
    'aria-label': `Status for ${r.first_name} ${r.last_name}`,
    class: `status status-${r.status}`,
    onchange: async (e) => {
      await saveRunner(r.id, { status: e.target.value });
      onChange?.();
      renderRunners();
    }
  });
  [['registered', 'Registered'], ['waitlist', 'Waitlist'], ['cancelled', 'Cancelled']].forEach(([value, label]) =>
    select.append(new Option(label, value, false, value === r.status)));
  return select;
}

function checkbox(r, field, label) {
  return el('input', {
    type: 'checkbox',
    checked: Boolean(r[field]),
    'aria-label': `${label}: ${r.first_name} ${r.last_name}`,
    onchange: (e) => saveRunner(r.id, { [field]: e.target.checked })
  });
}

function renderRunners() {
  const rows = visibleRunners();
  $('runner-count').textContent = `${rows.length} ${rows.length === 1 ? 'runner' : 'runners'}`;
  const body = document.querySelector('#runners tbody');
  body.replaceChildren(...rows.map((r) =>
    el('tr', {},
      el('td', {}, el('strong', {}, `${r.first_name} ${r.last_name}`), el('div', { class: 'sub' }, r.email)),
      el('td', {}, statusSelect(r)),
      el('td', {}, el('input', {
        class: 'bib',
        value: r.bib,
        'aria-label': `Bib for ${r.first_name} ${r.last_name}`,
        onchange: (e) => saveRunner(r.id, { bib: e.target.value })
      })),
      el('td', {}, r.shirt_size),
      el('td', {}, r.diet),
      el('td', { class: 'c' }, checkbox(r, 'paid', 'Paid')),
      el('td', { class: 'c' }, checkbox(r, 'packet_picked_up', 'Packet picked up')),
      el('td', { class: 'c' }, checkbox(r, 'finished', 'Finished')),
      el('td', { class: 'nowrap' }, shortDate(r.created_at)),
      el('td', {}, el('button', { type: 'button', class: 'link', onclick: () => openDetail(r.id) }, 'Details'))
    )));
  if (!rows.length) {
    body.append(el('tr', {}, el('td', { colSpan: 10, class: 'empty' }, 'No runners match.')));
  }
}

function openDetail(id) {
  const r = runners.find((x) => x.id === id);
  const dialog = $('detail');
  const row = (label, value) => [el('dt', {}, label), el('dd', {}, value || '—')];
  const notes = el('textarea', { rows: 3, value: r.admin_notes, 'aria-label': 'Organizer notes' });
  const phoneLink = (n) => el('a', { href: `tel:${n}` }, n);
  dialog.replaceChildren(
    el('div', { class: 'detail-head' },
      el('h2', { id: 'detail-name' }, `${r.first_name} ${r.last_name}`),
      el('button', { type: 'button', class: 'link', onclick: () => dialog.close() }, 'Close')),
    el('dl', {},
      ...row('Code', r.code),
      ...row('Email', el('a', { href: `mailto:${r.email}` }, r.email)),
      ...row('Phone', phoneLink(r.phone)),
      ...row('Hometown', r.hometown),
      ...row('Category', r.category),
      ...row('Shirt', r.shirt_size),
      ...row('Diet', r.diet),
      ...row('Their notes', r.runner_notes),
      ...row('Emergency contact', el('span', {}, `${r.emergency_name} · `, phoneLink(r.emergency_phone))),
      ...row('Waiver', `Signed "${r.waiver_signature}" on ${fullDate(r.waiver_signed_at)}`),
      ...row('Signed up', fullDate(r.created_at))),
    el('label', { class: 'detail-notes' }, 'Organizer notes', notes),
    el('button', {
      type: 'button',
      class: 'btn btn-primary btn-small',
      onclick: async () => {
        if (await saveRunner(r.id, { admin_notes: notes.value })) {
          dialog.close();
          toast('Notes saved.');
        }
      }
    }, 'Save notes')
  );
  dialog.showModal();
}

async function copyEmails(emails) {
  try {
    await navigator.clipboard.writeText(emails.join(', '));
    toast(`Copied ${emails.length} email ${emails.length === 1 ? 'address' : 'addresses'}.`);
  } catch {
    toast("Couldn't copy. Use Export CSV instead.");
  }
}

// ---------- Notify list ----------
let notifyRows = [];
async function loadNotify() {
  notifyRows = await api('/notify');
  $('notify-count').textContent = `${notifyRows.length} ${notifyRows.length === 1 ? 'person' : 'people'} waiting to hear from you`;
  const body = document.querySelector('#notify-table tbody');
  body.replaceChildren(...notifyRows.map((n) =>
    el('tr', {}, el('td', {}, n.name || '—'), el('td', {}, n.email), el('td', { class: 'nowrap' }, shortDate(n.created_at)))));
}

// ---------- Settings ----------
async function loadSettings() {
  const values = await api('/settings');
  const form = $('settings');
  Object.entries(values).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
}

// ---------- Backups & new year ----------
let dataStatus = null;

function updateNewYearButton() {
  const form = $('new-year');
  const ready = dataStatus?.backupCurrent && form.elements.confirm.value.trim() === 'DELETE' && /^20\d\d$/.test(form.elements.year.value.trim());
  $('new-year-submit').disabled = !ready;
}

async function loadDataTools() {
  dataStatus = await api('/data-status');
  const s = dataStatus;
  const runners = `${s.runners} ${s.runners === 1 ? 'runner' : 'runners'}`;
  $('backup-status').textContent = s.lastBackupAt
    ? `Last backup: ${fullDate(s.lastBackupAt)}. ${s.backupCurrent ? 'Nothing has changed since then.' : 'Runner or notify-list data has changed since then.'}`
    : 'No backup has been downloaded yet.';
  $('notify-total').textContent = String(s.notify);
  const status = $('new-year-status');
  status.className = `data-status ${s.backupCurrent ? 'ok' : 'warn'}`;
  status.textContent = s.backupCurrent
    ? `Your backup is up to date. ${runners} will be deleted.`
    : `Download a backup first (step 1). It has to be newer than the latest change. ${runners} on file.`;
  const year = $('new-year').elements.year;
  if (!year.value) year.value = String(s.year + 1);
  updateNewYearButton();
}

$('backup-link').addEventListener('click', () => {
  // The browser handles the download itself. Refresh the status once it has had time to finish.
  $('backup-status').textContent = 'Preparing your backup...';
  setTimeout(() => loadDataTools().catch(() => {}), 2500);
});

['input', 'change'].forEach((type) => $('new-year').addEventListener(type, updateNewYearButton));

$('new-year').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const error = $('new-year-error');
  error.hidden = true;
  $('new-year-submit').disabled = true;
  try {
    const result = await api('/new-year', {
      method: 'POST',
      body: JSON.stringify({
        year: form.elements.year.value.trim(),
        confirm: form.elements.confirm.value.trim(),
        clear_notify: form.elements.clear_notify.checked
      })
    });
    form.reset();
    toast(`Deleted ${result.removedRunners} runners${result.removedNotify ? ` and ${result.removedNotify} notify-list entries` : ''}. The site is set up for ${result.year}.`);
    await loadDataTools();
  } catch (err) {
    if (err instanceof AuthError) return;
    error.textContent = err.message;
    error.hidden = false;
    await loadDataTools().catch(() => {});
  }
});

// ---------- Wiring ----------
document.querySelectorAll('#admin-nav [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('search').addEventListener('input', renderRunners);
$('filter').addEventListener('change', renderRunners);
$('copy-emails').addEventListener('click', () => copyEmails(visibleRunners().map((r) => r.email)));
$('copy-notify').addEventListener('click', () => copyEmails(notifyRows.map((n) => n.email)));

$('login').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('login-error');
  error.hidden = true;
  try {
    await api('/login', { method: 'POST', body: JSON.stringify({ password: event.target.elements.password.value }) });
    event.target.reset();
    showTab(location.hash.slice(1));
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  showLogin();
});

$('settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('settings-error');
  const saved = $('settings-saved');
  error.hidden = true;
  saved.textContent = '';
  try {
    await api('/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    saved.textContent = 'Saved.';
  } catch (err) {
    if (err instanceof AuthError) return;
    error.textContent = err.message;
    error.hidden = false;
  }
});

showTab(location.hash.slice(1));
