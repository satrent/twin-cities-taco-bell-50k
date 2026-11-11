import express from 'express';
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dataDir, getSettings, saveSettings, registeredCount, DEFAULT_SETTINGS } from './db.js';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3050;
const isProd = process.env.NODE_ENV === 'production';

export const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
export const CATEGORIES = ["Men's", "Women's", 'Nonbinary', 'Just here for the burritos'];
export const DIETS = ['No restrictions', 'Vegetarian', 'Vegan', 'Gluten-free', 'Other'];

// ---------- Admin password ----------
// Use ADMIN_PASSWORD in production. Locally, generate one on first run and keep it in data/.
function loadAdminPassword() {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (isProd && (!fromEnv || fromEnv.length < 16)) {
    throw new Error('In production, set ADMIN_PASSWORD to at least 16 characters.');
  }
  if (fromEnv) return fromEnv;
  const file = join(dataDir, 'admin-password.txt');
  if (!existsSync(file)) {
    writeFileSync(file, crypto.randomBytes(9).toString('base64url') + '\n');
    console.log(`Generated an admin password in ${file}`);
  }
  return readFileSync(file, 'utf8').trim();
}
const adminHash = crypto.createHash('sha256').update(loadAdminPassword()).digest();

// ---------- Sessions and rate limits (in memory: fine for one small server) ----------
const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();
const hits = new Map();

function tooMany(key, limit, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > limit;
}

// Forget old rate-limit entries and expired logins so memory doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of hits) if (now - times[times.length - 1] > 60 * 60 * 1000) hits.delete(key);
  for (const [token, expires] of sessions) if (expires < now) sessions.delete(token);
}, 10 * 60 * 1000).unref();

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function requireAdmin(req, res, next) {
  const token = readCookie(req, 'admin');
  const expires = token && sessions.get(token);
  if (!expires || expires < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Please log in.' });
  }
  next();
}

// ---------- Validation helpers ----------
const clean = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isPhone = (value) => (value.match(/\d/g) || []).length >= 10;

function newCode() {
  // No easily-confused characters; printed on the runner's confirmation.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (const byte of crypto.randomBytes(6)) code += alphabet[byte % alphabet.length];
  return `TB-${code}`;
}

function publicStatus(settings) {
  const year = Number(settings.year);
  const taken = registeredCount(year);
  const capacity = Number(settings.capacity);
  const spotsLeft = Math.max(capacity - taken, 0);
  let status = 'open';
  if (settings.registration_mode === 'soon') status = 'soon';
  else if (settings.registration_mode !== 'open') status = 'closed';
  else if (spotsLeft === 0) status = 'waitlist';
  return { status, spotsLeft };
}

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', isProd ? 1 : false);
app.use(express.json({ limit: '20kb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  });
  if (isProd) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// ---------- Public API ----------
app.get('/api/public', (req, res) => {
  const s = getSettings();
  res.json({
    year: s.year,
    raceDate: s.race_date,
    startTime: s.start_time,
    fee: Number(s.fee),
    deadline: s.deadline,
    refundCutoff: s.refund_cutoff,
    packetPickup: s.packet_pickup,
    options: { shirtSizes: SHIRT_SIZES, categories: CATEGORIES, diets: DIETS },
    ...publicStatus(s)
  });
});

app.post('/api/register', (req, res) => {
  if (tooMany(`register:${req.ip}`, 30, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
  const b = req.body || {};
  // Hidden field that only bots fill in. Pretend it worked.
  if (clean(b.website)) return res.json({ code: 'TB-THANKS', status: 'registered' });

  const settings = getSettings();
  const { status: state } = publicStatus(settings);
  if (state === 'soon') return res.status(409).json({ error: "Registration hasn't opened yet." });
  if (state === 'closed') return res.status(409).json({ error: 'Registration is closed right now.' });

  const reg = {
    first_name: clean(b.first_name, 80),
    last_name: clean(b.last_name, 80),
    email: clean(b.email, 200).toLowerCase(),
    phone: clean(b.phone, 40),
    hometown: clean(b.hometown, 120),
    category: clean(b.category, 60),
    shirt_size: clean(b.shirt_size, 10),
    diet: clean(b.diet, 40),
    runner_notes: clean(b.runner_notes, 1000),
    emergency_name: clean(b.emergency_name, 120),
    emergency_phone: clean(b.emergency_phone, 40),
    waiver_signature: clean(b.waiver_signature, 160)
  };

  const errors = {};
  if (!reg.first_name) errors.first_name = 'Please enter your first name.';
  if (!reg.last_name) errors.last_name = 'Please enter your last name.';
  if (!isEmail(reg.email)) errors.email = 'Please enter a valid email address.';
  if (!isPhone(reg.phone)) errors.phone = 'Please enter a phone number with area code.';
  if (!CATEGORIES.includes(reg.category)) errors.category = 'Please choose a category.';
  if (!SHIRT_SIZES.includes(reg.shirt_size)) errors.shirt_size = 'Please choose a shirt size.';
  if (!DIETS.includes(reg.diet)) errors.diet = 'Please choose an option.';
  if (!reg.emergency_name) errors.emergency_name = 'Please name an emergency contact.';
  if (!isPhone(reg.emergency_phone)) errors.emergency_phone = 'Please enter a phone number with area code.';
  if (b.is_adult !== true) errors.is_adult = 'All runners must be 18 or older.';
  if (b.waiver_accepted !== true) errors.waiver_accepted = 'Please accept the waiver to register.';
  if (!reg.waiver_signature) errors.waiver_signature = 'Please type your full name to sign.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', errors });

  const now = new Date().toISOString();
  const year = Number(settings.year);
  const status = state === 'waitlist' ? 'waitlist' : 'registered';
  const code = newCode();
  try {
    db.prepare(`
      INSERT INTO registrations
        (code, year, first_name, last_name, email, phone, hometown, category, shirt_size, diet, runner_notes,
         emergency_name, emergency_phone, waiver_signature, waiver_signed_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code, year, reg.first_name, reg.last_name, reg.email, reg.phone, reg.hometown, reg.category, reg.shirt_size,
      reg.diet, reg.runner_notes, reg.emergency_name, reg.emergency_phone, reg.waiver_signature, now, status, now
    );
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({
        error: 'That email is already registered for this year.',
        errors: { email: 'That email is already registered for this year.' }
      });
    }
    throw err;
  }
  res.status(201).json({
    code,
    status,
    firstName: reg.first_name,
    fee: Number(settings.fee),
    paymentInstructions: settings.payment_instructions
  });
});

app.post('/api/notify', (req, res) => {
  if (tooMany(`notify:${req.ip}`, 30, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
  const email = clean(req.body?.email, 200).toLowerCase();
  if (clean(req.body?.website)) return res.json({ ok: true });
  if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  db.prepare('INSERT OR IGNORE INTO notify_list (name, email, created_at) VALUES (?, ?, ?)')
    .run(clean(req.body?.name, 120), email, new Date().toISOString());
  res.json({ ok: true });
});

// ---------- Admin API ----------
app.post('/api/admin/login', (req, res) => {
  if (tooMany(`login:${req.ip}`, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const attempt = crypto.createHash('sha256').update(String(req.body?.password ?? '')).digest();
  if (!crypto.timingSafeEqual(attempt, adminHash)) {
    return res.status(401).json({ error: "That password didn't work." });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  const secure = isProd ? '; Secure' : '';
  res.set('Set-Cookie', `admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  sessions.delete(readCookie(req, 'admin'));
  res.set('Set-Cookie', 'admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

const admin = express.Router();
admin.use(requireAdmin);
admin.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const groupCount = (year, column, order) =>
  db.prepare(
    `SELECT ${column} AS label, COUNT(*) AS n FROM registrations
     WHERE year = ? AND status = 'registered' GROUP BY ${column}`
  ).all(year).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));

admin.get('/summary', (req, res) => {
  const settings = getSettings();
  const year = Number(settings.year);
  const count = (where) =>
    db.prepare(`SELECT COUNT(*) AS n FROM registrations WHERE year = ? AND ${where}`).get(year).n;
  const registered = count("status = 'registered'");
  const paid = count("status = 'registered' AND paid = 1");
  res.json({
    year,
    capacity: Number(settings.capacity),
    fee: Number(settings.fee),
    registered,
    waitlist: count("status = 'waitlist'"),
    cancelled: count("status = 'cancelled'"),
    paid,
    unpaid: registered - paid,
    revenue: paid * Number(settings.fee),
    outstanding: (registered - paid) * Number(settings.fee),
    packets: count("status = 'registered' AND packet_picked_up = 1"),
    finishers: count("status = 'registered' AND finished = 1"),
    notifyCount: db.prepare('SELECT COUNT(*) AS n FROM notify_list').get().n,
    shirts: SHIRT_SIZES.map((label) => ({
      label,
      n: groupCount(year, 'shirt_size', SHIRT_SIZES).find((r) => r.label === label)?.n || 0
    })),
    categories: groupCount(year, 'category', CATEGORIES),
    diets: groupCount(year, 'diet', DIETS)
  });
});

admin.get('/registrations', (req, res) => {
  const year = Number(getSettings().year);
  res.json(db.prepare('SELECT * FROM registrations WHERE year = ? ORDER BY created_at DESC').all(year));
});

const EDITABLE = {
  status: (v) => (['registered', 'waitlist', 'cancelled'].includes(v) ? v : undefined),
  paid: (v) => (typeof v === 'boolean' ? Number(v) : undefined),
  packet_picked_up: (v) => (typeof v === 'boolean' ? Number(v) : undefined),
  finished: (v) => (typeof v === 'boolean' ? Number(v) : undefined),
  bib: (v) => (typeof v === 'string' ? v.trim().slice(0, 12) : undefined),
  admin_notes: (v) => (typeof v === 'string' ? v.slice(0, 2000) : undefined)
};

admin.patch('/registrations/:id', (req, res) => {
  const id = Number(req.params.id);
  const updates = [];
  const values = [];
  for (const [field, parse] of Object.entries(EDITABLE)) {
    if (!(field in (req.body || {}))) continue;
    const value = parse(req.body[field]);
    if (value === undefined) return res.status(400).json({ error: `Invalid value for ${field}.` });
    updates.push(`${field} = ?`); // field names come only from EDITABLE
    values.push(value);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  const result = db.prepare(`UPDATE registrations SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  if (!result.changes) return res.status(404).json({ error: 'Runner not found.' });
  res.json(db.prepare('SELECT * FROM registrations WHERE id = ?').get(id));
});

admin.get('/notify', (req, res) => {
  res.json(db.prepare('SELECT * FROM notify_list ORDER BY created_at DESC').all());
});

admin.get('/settings', (req, res) => res.json(getSettings()));

admin.put('/settings', (req, res) => {
  const b = req.body || {};
  const next = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in b) next[key] = clean(String(b[key]), 500);
  }
  if ('year' in next && !/^20\d\d$/.test(next.year)) return res.status(400).json({ error: 'Year must look like 2027.' });
  if ('capacity' in next && !/^\d{1,5}$/.test(next.capacity)) return res.status(400).json({ error: 'Capacity must be a whole number.' });
  if ('fee' in next && !/^\d{1,5}$/.test(next.fee)) return res.status(400).json({ error: 'Fee must be a whole dollar amount.' });
  if ('registration_mode' in next && !['soon', 'open', 'closed'].includes(next.registration_mode)) {
    return res.status(400).json({ error: 'Registration must be coming soon, open, or closed.' });
  }
  saveSettings(next);
  res.json(getSettings());
});

// CSV exports. A leading ' stops spreadsheets from running a cell as a formula.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function sendCsv(res, filename, columns, rows) {
  const lines = [columns.map(([label]) => csvCell(label)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => csvCell(get(row))).join(','));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}
const yesNo = (v) => (v ? 'Yes' : 'No');

admin.get('/export/registrations.csv', (req, res) => {
  const year = Number(getSettings().year);
  const rows = db.prepare('SELECT * FROM registrations WHERE year = ? ORDER BY last_name, first_name').all(year);
  sendCsv(res, `taco-bell-50k-${year}-runners.csv`, [
    ['Code', (r) => r.code], ['Status', (r) => r.status], ['Bib', (r) => r.bib],
    ['First name', (r) => r.first_name], ['Last name', (r) => r.last_name],
    ['Email', (r) => r.email], ['Phone', (r) => r.phone], ['Hometown', (r) => r.hometown],
    ['Category', (r) => r.category], ['Shirt', (r) => r.shirt_size], ['Diet', (r) => r.diet],
    ['Runner notes', (r) => r.runner_notes],
    ['Emergency contact', (r) => r.emergency_name], ['Emergency phone', (r) => r.emergency_phone],
    ['Paid', (r) => yesNo(r.paid)], ['Packet picked up', (r) => yesNo(r.packet_picked_up)], ['Finished', (r) => yesNo(r.finished)],
    ['Waiver signature', (r) => r.waiver_signature], ['Waiver signed at', (r) => r.waiver_signed_at],
    ['Admin notes', (r) => r.admin_notes], ['Registered at', (r) => r.created_at]
  ], rows);
});

admin.get('/export/notify.csv', (req, res) => {
  const rows = db.prepare('SELECT * FROM notify_list ORDER BY created_at').all();
  sendCsv(res, 'taco-bell-50k-notify-list.csv', [
    ['Name', (r) => r.name], ['Email', (r) => r.email], ['Signed up', (r) => r.created_at]
  ], rows);
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- Pages ----------
app.use(express.static(join(root, 'public'), { extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile(join(root, 'public', '404.html')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Could not read that request.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () =>
  console.log(isProd ? `Taco Bell 50k site listening on port ${PORT}` : `Taco Bell 50k site running at http://localhost:${PORT}`)
);
