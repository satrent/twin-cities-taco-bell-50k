// Fills the database with made-up runners so the admin screens have something to show.
// Every name is invented and every email is at example.com. Clear with: npm run reset
import { db, getSettings } from '../db.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run against the live site (NODE_ENV=production).');
  process.exit(1);
}

const first = ['Avery', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Quinn', 'Sam', 'Taylor', 'Drew', 'Jamie', 'Reese', 'Skyler', 'Parker', 'Emerson', 'Rowan', 'Dakota', 'Hayden', 'Sage', 'Blake', 'Cameron'];
const last = ['Nacho', 'Chalupa', 'Gordita', 'Baja', 'Fiesta', 'Volcano', 'Quesada', 'Mexi', 'Melt', 'Salsa', 'Verde', 'Crunch', 'Rollup', 'Tostada', 'Picante'];
const towns = ['Minneapolis, MN', 'St. Paul, MN', 'Bloomington, MN', 'Duluth, MN', 'Madison, WI', 'Fargo, ND', 'Anchorage, AK', 'Oakdale, MN', 'Richfield, MN', 'Edina, MN'];
const weighted = (pairs) => {
  let roll = Math.random() * pairs.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of pairs) if ((roll -= w) <= 0) return value;
  return pairs[0][0];
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const phone = () => `651-555-01${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;

const year = Number(getSettings().year);
const insert = db.prepare(`
  INSERT OR IGNORE INTO registrations
    (code, year, first_name, last_name, email, phone, hometown, category, shirt_size, diet, runner_notes,
     emergency_name, emergency_phone, waiver_signature, waiver_signed_at, status, paid, packet_picked_up, bib, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const COUNT = 68;
for (let i = 0; i < COUNT; i++) {
  const f = first[i % first.length];
  const l = last[i % last.length];
  const created = new Date(Date.now() - Math.random() * 21 * 86400000).toISOString();
  const status = i < 62 ? 'registered' : i < 66 ? 'waitlist' : 'cancelled';
  const paid = status === 'registered' && Math.random() < 0.8 ? 1 : 0;
  insert.run(
    `TB-DEMO${String(i).padStart(2, '0')}`, year, f, l, `${f}.${l}.${i}@example.com`.toLowerCase(), phone(), pick(towns),
    weighted([["Women's", 45], ["Men's", 40], ['Nonbinary', 6], ['Just here for the burritos', 9]]),
    weighted([['XS', 4], ['S', 14], ['M', 26], ['L', 24], ['XL', 12], ['XXL', 5], ['XXXL', 1]]),
    weighted([['No restrictions', 60], ['Vegetarian', 18], ['Vegan', 15], ['Gluten-free', 5], ['Other', 2]]),
    i % 17 === 0 ? 'Handcycling the course!' : '',
    `${pick(first)} ${l}`, phone(), `${f} ${l}`, created, status, paid,
    paid && Math.random() < 0.15 ? 1 : 0, status === 'registered' ? String(i + 1) : '', created
  );
}

const notify = db.prepare('INSERT OR IGNORE INTO notify_list (name, email, created_at) VALUES (?, ?, ?)');
for (let i = 0; i < 23; i++) {
  notify.run(`${pick(first)} ${pick(last)}`, `hopeful.${i}@example.com`, new Date(Date.now() - Math.random() * 90 * 86400000).toISOString());
}
const n = db.prepare('SELECT COUNT(*) AS n FROM registrations').get().n;
console.log(`Demo data ready: ${n} registrations. Clear with: npm run reset`);
