// Removes every registration and notify-list entry. Keeps settings and the admin password.
import { db } from '../db.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run against the live site (NODE_ENV=production).');
  process.exit(1);
}

const runners = db.prepare('DELETE FROM registrations').run().changes;
const notify = db.prepare('DELETE FROM notify_list').run().changes;
console.log(`Removed ${runners} registrations and ${notify} notify-list entries.`);
