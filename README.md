# Twin Cities Taco Bell 50k

Brochure, registration, and admin site. Node + Express + SQLite (Node's built-in `node:sqlite`).

## Run it

```bash
npm install
npm run seed   # optional: fake runners so the admin screens have data
npm start
```

- Site: http://localhost:3050
- Register: http://localhost:3050/register
- Admin: http://localhost:3050/admin

The first start generates an admin password in `data/admin-password.txt`. In production, set the
`ADMIN_PASSWORD` environment variable and `NODE_ENV=production` instead.

`npm run reset` removes all runners and notify-list entries, real and demo alike. Settings stay.

## Where things live

- `server.js`: pages, public API, and admin API
- `db.js`: database schema and default settings
- `public/`: the pages, styles, scripts, and images
- `data/`: the database and generated password. It holds personal data, so never commit it.

The date, fee, capacity, and registration open/closed state are all edited in Admin > Settings.

Registration has three modes: **Coming soon** and **Closed** both collect a notify list, and
**Open** takes sign-ups. A new database starts at Coming soon.

## Hosting

See [DEPLOY.md](DEPLOY.md) for setting up Render, connecting the domain, and sending updates.

## Not built yet

- Taking payment. Organizers mark runners paid by hand in the admin.
- Confirmation emails. Runners see their confirmation code on screen.
