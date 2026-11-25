# Render + Netlify deployment status

The user selected Netlify for the frontend, Render for the Express backend, and Neon for persistent PostgreSQL storage. Source is pushed to https://github.com/EarnL/faculty-consultation-scheduler on main. A Free Netlify project named `earnl-it-consultation` has been created and linked locally; its intended frontend origin is https://earnl-it-consultation.netlify.app . No frontend version has been published, and no Render backend or Neon database has been provisioned. Netlify authorization was verified. Render and Neon tools are not exposed in the current session, despite earlier UI connections; their deployment access still needs to be restored or provided through supported CLI authentication. Credentials remain outside the repository.

## Completed preparation

- `netlify.toml` publishes only generated `netlify-dist/`.
- `npm run build:netlify` requires actual `RENDER_API_URL` and `PUBLIC_URL` (or Netlify's `URL` variable). Both must be HTTPS origins. It copies only public frontend assets, writes an API proxy before the SPA fallback, and generates the public sitemap, robots file and canonical URL.
- Browsers keep using relative `/api/` URLs. Netlify proxies these to Render; host-only HttpOnly session cookies remain attached to the frontend origin. The backend accepts the exact configured `PUBLIC_URL` as an allowed request Origin. This avoids relying on third-party cookies. No wildcard credentialed CORS was introduced.
- Installation assets, manifest and service worker are included. Private API responses are not cached by the worker.
- The runtime now uses asynchronous database access: `DATABASE_URL` selects PostgreSQL for hosting, while local runs retain SQLite. Accounts and sessions share persistent PostgreSQL storage. A transaction lock prevents competing bookings and queue updates; success responses wait for commit. `render.yaml` selects the free plan and requires private database credentials and the frontend URL.
- PostgreSQL integration checks cover accounts, duplicate IDs, simultaneous booking, approval, private QR passes, rescheduling, compressed administrator backups, transaction rollback during restore, and session persistence/revocation. These checks were run with embedded PostgreSQL and an isolated real PostgreSQL 18 server; the user's existing PostgreSQL service was not used or altered.
- Tests verify generated routing, absence of private source/database files in output, HTTPS session cookie settings, allowed frontend origin and unrelated-origin rejection. End-to-end Netlify proxy behavior must still be verified after both services are live.

## Remaining before deployment

1. Connect Render and Neon accounts. Authorize Netlify CLI in the owner's Netlify account. Signing into a website alone does not necessarily authorize the local CLI. Do not paste account passwords or database secrets into chat.
2. Provision an empty Neon PostgreSQL database. Set DATABASE_URL privately in the deployment environment. For preserving the local accounts and appointments, run `npm run migrate:postgres -- --file "C:\path\to\scheduler.db"` from a trusted terminal with DATABASE_URL set. This imports a verified, consistent snapshot into an empty target only. It does not change the local database or copy login sessions. Password hashes are preserved, so replace default/sample credentials before exposing the hosted service. Never commit DATABASE_URL or place it in Netlify's frontend assets.
3. Create/select the Netlify site first to obtain its stable hostname; do not publish an incomplete frontend. Create the Render Free service with the real persistent database connection, stable SESSION_SECRET, production mode, the Netlify origin as PUBLIC_URL and the correct HTTPS proxy policy. Keep the existing local database private until the verified import is ready. No paid Render disk or paid service has been authorized or created.
4. Set Netlify's `RENDER_API_URL` to the verified Render service origin and `PUBLIC_URL` to the stable Netlify origin. The backend PUBLIC_URL must match exactly. Build and publish the frontend after the backend's health and authentication checks pass.
5. Check login/logout/password revocation, faculty approval, student QR pass, file downloads, notification updates, actual phone installation and camera scanning through the public frontend origin. Confirm records and sessions survive backend restarts. Publish the confirmed public URL only after these checks pass.

Source repository configuration and host resource creation remain dependent on connected accounts. Free Render sleeps while idle, so its in-process reminder worker cannot promise timely delivery during sleep. Free tier allowances and limits still apply.

## PostgreSQL backups and recovery

Admin Overview creates compressed `.json.gz` PostgreSQL snapshots. The three latest snapshots are stored in PostgreSQL, so Render's temporary disk is not used. Download a copy off-host for independent recovery. The file includes private user records and password hashes; keep it private. Sessions and session-signing secrets are excluded.

Stop the hosted backend, preserve a current backup off-host, and set DATABASE_URL privately. Run `npm run restore:postgres -- --file "path/to/portal-backup.json.gz" --confirm-offline --confirm-replace`. This deliberately replaces the target tables inside a transaction, resets ID sequences and clears login sessions. Start the backend again and check account counts, bookings and login. The existing `restore:backup` command is for local SQLite snapshots only.

## Local verification

`npm test` includes portable embedded-PostgreSQL API checks. Where PostgreSQL 18 is installed, `node scripts/test-postgres-network.js` creates a brand-new temporary cluster bound to 127.0.0.1, runs the PostgreSQL integration suite, then shuts down and removes only that temporary cluster. Set POSTGRES_BIN for another installed binary directory. No existing database service is used.
