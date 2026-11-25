# Hosting and phone installation

The local app includes a web app manifest, IT logo app icons, an install/help button, a service worker with a public offline screen, and phone layouts. This does not constitute a live internet deployment. Booking, authentication, notifications, queues and QR passes require an internet connection; private responses are never stored by the service worker.

## Free hosting choice

For this existing Node/SQLite implementation, an Oracle Cloud **Always Free eligible VM** with persistent block storage can run the application without changing the database engine. An account must be created by the owner; Oracle requires card verification and capacity is not guaranteed. Stay within resources explicitly marked Always Free; promotional trial credits are a different allowance. See https://www.oracle.com/cloud/free/ and https://www.oracle.com/cloud/free/faq/ . A school-provided server with persistent storage and an HTTPS hostname is another suitable option.

Render's free web services cannot attach a persistent disk and discard local filesystem changes on restart, spin-down and deployment. For the user's selected **Netlify + Render** setup, PostgreSQL support is now implemented: set DATABASE_URL to an external persistent database and follow [Render and Netlify deployment](RENDER_NETLIFY_DEPLOYMENT.md). Do not use a local SQLite file on Render Free for retained records. See https://render.com/docs/free . GitHub Pages alone cannot run the Express backend. The Sites Worker runtime still requires a separate runtime adaptation.

No hosting account, VM, DNS hostname or deployment credentials are configured in this checkout. No public URL has been created. Do not send account passwords in chat; use the provider login and a supported connection or a scoped deployment key when a server is available.

## Deploy to a Linux VM or school server

1. Provision a VM with persistent storage, install Docker Engine and the Compose plugin using Docker's official instructions, and permit inbound TCP 80/443 (UDP 443 is optional). Keep the application port 3000 private. Use a single application instance.
2. Obtain a stable hostname and point its DNS A/AAAA records at the VM. An existing school subdomain avoids buying a domain. Do not publish an AAAA record unless IPv6 reaches this server. Free compute does not include a purchased domain name.
3. Copy the project source to a private directory on the server. Exclude local databases, sessions, secrets, backups and node_modules. The Docker build also excludes these. The deployment starts with an empty database and **does not seed demo accounts**.
4. Copy `.env.example` to `.env`. Set `PORTAL_DOMAIN` to the bare hostname and replace `SESSION_SECRET` with the output of `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Keep this secret stable. Compose uses it; ordinary `npm start` does not read `.env` automatically.
5. Run `docker compose up -d --build`. Caddy obtains and renews HTTPS certificates once DNS and ports are correct. Named volume `portal_data` retains the application DB, sessions and backups. Do not use `docker compose down -v`; that removes volumes.
6. Run `docker compose exec app npm run setup:admin -- --username admin --name "System Administrator"`. Save the generated password privately, sign in through the Admin tab, change the password, and create faculty accounts. Students can register with their student number.
7. Test login, logout, bookings, faculty approval, QR display and camera scanning at the HTTPS URL. Check `docker compose ps` and `docker compose logs --tail=100`. The image has an HTTP health check. Container builds and public HTTPS need verification on the actual server; they have not been executed locally without Docker.
8. Create/download an admin database backup and store it away from the server. Back up the session secret separately. For an existing database migration, use the verified backup/restore procedure in `DEPLOYMENT.md` with the service stopped; never copy an active SQLite main file alone or overwrite a running database. Review sample accounts and default passwords before deciding to import local data.

## Install on a phone

Use the public **HTTPS** URL. A phone's `localhost` refers to that phone, not this PC. Plain HTTP on a LAN address does not enable normal PWA installation or camera access.

- Android/Chrome: tap **Install app** in the portal. If the browser offers its native installation dialog, confirm it. Otherwise follow the browser menu → Install app / Add to Home screen instructions.
- iPhone/Safari: tap Share → Add to Home Screen → Add. Enable Open as Web App if offered.
- Launch the IT Consult home-screen icon and sign in. The install button hides in standalone mode. Installation is browser-based; there is no APK, Play Store or App Store submission.

The public offline screen appears if a navigation cannot reach the server. It does not show cached student records or allow offline booking. Device-specific installation, camera, keyboard, notch and landscape behavior still require checks on actual Android and iPhone devices.

## Make the landing page discoverable

Opening a link works as soon as HTTPS hosting is live. Google search listing is separate and not guaranteed immediately. The server supplies `/robots.txt` and, when `PUBLIC_URL` is configured, `/sitemap.xml` containing only the public landing page. Compose configures PUBLIC_URL from PORTAL_DOMAIN. API responses have noindex headers and require their normal authentication; no student records are included in the sitemap.

After deployment, verify ownership in Google Search Console, submit `https://YOUR-HOSTNAME/sitemap.xml`, and request indexing of the landing page. Use the real stable URL, not a temporary tunnel URL. See https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap .
