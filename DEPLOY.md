# Putting the site on Render

Julie owns the Render account. Trent can't log in to it, so Julie does the setup clicks on a screen
share, and Trent sends updates later through a deploy link. Render's screens change from time to
time, so if a label below doesn't match, look for the closest match.

Cost: about $7/month for the Starter server plus about $0.25/month for a 1 GB disk.

## Before the screen share

**Trent**
- [x] Push this repo to the public GitHub repository
      **https://github.com/satrent/twin-cities-taco-bell-50k**. The `data/` folder (runner data and
      the local admin password) is excluded by `.gitignore`, so it never gets uploaded.
- [ ] Push any last changes to `main` before the screen share.

**Julie**
- [ ] Create the Render account, turn on two-factor authentication, and add a card under Billing.
- [ ] In a password manager, generate the site's **admin password**: at least 16 characters (20+ is
      better). It's the login for the race admin pages. Don't send it to Trent in a text. If he needs
      admin access, share it through a password manager.

## On the screen share (Julie clicks, Trent guides)

1. In the Render Dashboard, choose **New > Web Service**.
2. Choose **Public Git Repository** and paste:
   `https://github.com/satrent/twin-cities-taco-bell-50k`
3. Fill in:

   | Setting | Value |
   |---|---|
   | Name | `twin-cities-taco-bell-50k` (this becomes the temporary `…onrender.com` address) |
   | Region | Ohio (US East), the closest to Minnesota |
   | Branch | `main` |
   | Language / Runtime | Node |
   | Build command | `npm ci` |
   | Start command | `npm start` |
   | Instance type | **Starter** (the free tier can't keep a disk, so registrations would be lost) |

4. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATA_DIR` | `/var/data` |
   | `ADMIN_PASSWORD` | the password Julie generated |

5. Under **Advanced**:
   - **Health Check Path:** `/api/public`
   - **Add Disk:** name `data`, mount path `/var/data`, size `1` GB. A disk can grow later but
     can't shrink.
6. Click **Create Web Service** and watch the log. It's live when you see
   `Taco Bell 50k site listening on port …`.
7. Open the `…onrender.com` address. The brochure should load, and Register should say
   **Registration opens soon**. A new site always starts that way, so nobody can sign up early.
8. Go to `/admin`, log in with the admin password, and check **Settings**. The dates there are
   placeholders until Julie fills them in.
9. In the Render service's **Settings**, find **Deploy Hook** and copy that link to Trent through a
   password manager or another private channel. It's a secret: anyone with it can trigger a deploy.
   If it ever leaks, **Regenerate Hook** makes a new one.

## Connecting the domain (once Julie owns it)

1. In the Render service, go to **Settings > Custom Domains** and add `twincitiestacobell50k.com`
   (and `www.twincitiestacobell50k.com`).
2. Render shows the DNS records to add. In Porkbun, open the domain's **DNS** settings and enter
   exactly those records.
3. Wait for Render to verify. HTTPS is set up automatically.

## Afterward

- **Sending an update (Trent):** push to `main` on GitHub, then trigger the deploy link:

  ```bash
  curl -X POST "$RENDER_DEPLOY_HOOK"
  ```

  Each deploy takes the site offline for about a minute, because a service with a disk stops the old
  copy before starting the new one. Avoid deploying while registration is busy.
- **Letting search engines list the site:** the site tells search engines not to list it until
  you're ready. To go public, add `SEARCH_INDEXING` with the value `on` under the service's
  **Environment** settings and save. Render redeploys. To hide it again, delete the variable and save.
  It can take search engines days or weeks to notice either change.
- **Opening registration:** Admin > Settings > Registration > **Open**, once the date, capacity,
  fee, and deadlines are filled in.
- **Backups:** Render snapshots the disk once a day and keeps each snapshot for 7 days. A restore
  replaces the whole disk and loses anything since that snapshot. For a copy you keep yourself, use
  Admin > **Backups & new year** > **Download backup**. It's a complete copy of the database, so
  store it somewhere private.
- **After the race:** in Admin > **Backups & new year**, download a backup, then use
  **Start a new year**. It deletes every runner (the notify list is kept unless you choose otherwise),
  sets the new race year, switches registration to Coming soon, and resets the dates to
  "To be announced." It refuses to run unless a backup has been downloaded since the last change.
- **Changing the admin password (Julie):** edit `ADMIN_PASSWORD` under the service's Environment
  settings and save. Render redeploys, and everyone gets logged out.
- **Demo data never goes live.** `npm run seed` and `npm run reset` refuse to run when
  `NODE_ENV=production`.
