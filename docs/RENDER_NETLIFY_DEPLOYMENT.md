# Render + Netlify deployment status

Verified live on November 26, 2026 (Philippine time).

- Public portal: https://earnl-it-consultation.netlify.app
- Backend: https://earnl-it-consultation-api.onrender.com
- Source: https://github.com/EarnL/faculty-consultation-scheduler (main)
- Netlify project: earnl-it-consultation; production deploy 6b083796952c2b68e5983de4.
- Render: Free Node service earnl-it-consultation-api in the user-confirmed My Workspace, Singapore. Initial deploy dep-dc3e2inlot8c739tgqp0 is live.
- Neon: project rough-cloud-64438423, database consultation, PostgreSQL 18, Singapore. Verified imported totals: 14 users and 28 appointments.

Known default sample passwords were replaced in the hosted copy. New sample credentials are saved privately in ignored backups/hosted-demo-credentials.json on the owner's PC. Local passwords were unchanged. No database credentials or session secrets are published in source or frontend assets.

## Completed preparation

- `netlify.toml` publishes only generated `netlify-dist/`.
- `npm run build:netlify` requires actual `RENDER_API_URL` and `PUBLIC_URL` (or Netlify's `URL` variable). Both must be HTTPS origins. It copies only public frontend assets, writes an API proxy before the SPA fallback, and generates the public sitemap, robots file and canonical URL.
- Browsers keep using relative `/api/` URLs. Netlify proxies these to Render; host-only HttpOnly session cookies remain attached to the frontend origin. The backend accepts the exact configured `PUBLIC_URL` as an allowed request Origin. This avoids relying on third-party cookies. No wildcard credentialed CORS was introduced.
- Installation assets, manifest and service worker are included. Private API responses are not cached by the worker.
- The runtime now uses asynchronous database access: `DATABASE_URL` selects PostgreSQL for hosting, while local runs retain SQLite. Accounts and sessions share persistent PostgreSQL storage. A transaction lock prevents competing bookings and queue updates; success responses wait for commit. `render.yaml` selects the free plan and requires private database credentials and the frontend URL.
- PostgreSQL integration checks cover accounts, duplicate IDs, simultaneous booking, approval, private QR passes, rescheduling, compressed administrator backups, transaction rollback during restore, and session persistence/revocation. These checks were run with embedded PostgreSQL and an isolated real PostgreSQL 18 server; the user's existing PostgreSQL service was not used or altered.
- Tests verify generated routing, absence of private source/database files in output, HTTPS session cookie settings, allowed frontend origin and unrelated-origin rejection. End-to-end Netlify proxy behavior must still be verified after both services are live.

## Live verification and remaining device checks

The backend HTTPS health endpoint returned 200. The frontend, web manifest, and API reverse proxy were verified over HTTPS. Student and faculty logins succeeded through the frontend origin with Secure, HttpOnly cookies. Authenticated profile, appointment, notification and faculty APIs returned 200 and no-store headers. Logout invalidated each session; anonymous profile access returned 401. Requests from an unrelated Origin were rejected with 403. This smoke test did not create appointments or change user records.

The complete local suite previously passed 55 tests; a separate real PostgreSQL 18 network suite passed 7 tests. Actual Android/iPhone installation, camera scanning, and post-restart session persistence on the hosted service still need device/runtime verification. Installation support is included, but these physical checks have not been claimed as completed.

Free Render sleeps while idle, so the first request can take longer and its in-process reminder worker cannot promise timely delivery during sleep. Hosting quotas still apply. Search engine indexing is not immediate or guaranteed.

Frontend releases currently use the authorized Netlify CLI: set the public RENDER_API_URL and PUBLIC_URL build variables, run npm run build:netlify, then netlify deploy --prod --dir netlify-dist --no-build. Never deploy the project root. Backend releases use the GitHub-linked Render service; verify the resulting deploy reaches live and /healthz returns 200.

## PostgreSQL backups and recovery

Admin Overview creates compressed `.json.gz` PostgreSQL snapshots. The three latest snapshots are stored in PostgreSQL, so Render's temporary disk is not used. Download a copy off-host for independent recovery. The file includes private user records and password hashes; keep it private. Sessions and session-signing secrets are excluded.

Stop the hosted backend, preserve a current backup off-host, and set DATABASE_URL privately. Run `npm run restore:postgres -- --file "path/to/portal-backup.json.gz" --confirm-offline --confirm-replace`. This deliberately replaces the target tables inside a transaction, resets ID sequences and clears login sessions. Start the backend again and check account counts, bookings and login. The existing `restore:backup` command is for local SQLite snapshots only.

## Local verification

`npm test` includes portable embedded-PostgreSQL API checks. Where PostgreSQL 18 is installed, `node scripts/test-postgres-network.js` creates a brand-new temporary cluster bound to 127.0.0.1, runs the PostgreSQL integration suite, then shuts down and removes only that temporary cluster. Set POSTGRES_BIN for another installed binary directory. No existing database service is used.
