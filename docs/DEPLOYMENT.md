# Deployment and Recovery Guide

Updated November 25, 2026. Local Windows/Node.js is running; Docker Compose files now prepare a Linux deployment with persistent SQLite storage and HTTPS. See [Hosting and phone installation](HOSTING_AND_PHONE_INSTALL.md). Public hosting and respondent evaluation remain outstanding; these files are not evidence of an internet deployment.

## Local run

Use Node.js 24 with npm. From the directory containing `package.json`, run `npm ci`, then `npm start`. Open http://localhost:3000. `npm run dev` watches server changes. The application performs compatible schema migrations at startup; new installations seed demo users only when the users table is empty.

Run `npm run setup:admin -- --username admin --name "System Administrator"` once for the first administrator. Setup refuses to overwrite an existing admin and generates a password unless `ADMIN_PASSWORD` is provided. Keep the displayed password private and change it through the profile. Use administrator-created faculty accounts and student self-registration for normal operation.

## Configuration

| Variable | Purpose |
|---|---|
| PORT | HTTP port, default 3000 |
| DB_PATH | Application SQLite path, default scheduler.db beside server.js |
| SESSION_DB_PATH | Persistent session database path |
| SESSION_SECRET | Strong stable session-signing secret; local fallback is .session-secret |
| NODE_ENV=production | Enables secure cookies; requires HTTPS |
| TRUST_PROXY=loopback | Trust a reverse proxy on the same machine only; use solely for that topology |
| TRUST_PROXY=1 | One trusted reverse proxy, with application port inaccessible directly; used by Docker Compose |
| PUBLIC_URL | Public HTTPS origin used by robots.txt and sitemap.xml |
| SEED_DEMO=false | Disable automatic demo seeding; production defaults to no demo data |
| DATABASE_URL | Enables persistent PostgreSQL for Render; keep this credential private and off the frontend |

The application sets school date/time behavior to Asia/Manila. It needs write access to its database directory and a stable secret across restarts. Production requires SESSION_SECRET of at least 32 characters. Do not put databases, backups, secrets or credentials under `public/`. Docker Compose reads .env; plain Node/npm execution requires environment variables to be set explicitly.

With DATABASE_URL, application records and login sessions use PostgreSQL rather than local files. The selected Netlify/Render deployment, snapshot import, hosted backups and PostgreSQL recovery are documented in [Render and Netlify deployment](RENDER_NETLIFY_DEPLOYMENT.md). The SQLite restore instructions below apply only to local SQLite mode.

## Before public hosting

1. Choose a Node-capable host with persistent writable storage. SQLite files must survive application restarts/redeployments.
2. Put HTTPS in front of the application. Enable production mode only when the connection and proxy/cookie configuration are correct. A local reverse proxy can use `TRUST_PROXY=loopback`; different topologies require a reviewed trust policy.
3. Create institution-owned accounts, replace demo credentials/data as appropriate after a verified backup, and preserve the private session secret.
4. Run the application as a managed process with automatic restart. The in-process reminder worker runs every 30 seconds while the application is up; notification counts refresh on active clients.
5. Configure backups, storage monitoring, log retention, and recovery ownership. This application is intended for a single application instance; a multi-instance deployment needs a coordinated database/job design.
6. Run automated tests and the user-acceptance tasks in `evaluation/EVALUATION_KIT.md`. Test actual mobile devices, keyboard use, camera permissions, HTTPS cookies, logout, password resets, timezone behavior, and notification timing.
7. Record the deployed URL, version, environment, test evidence, and stakeholder acceptance. Public deployment evidence is not supplied by localhost checks.

## Backups

Use SQLite's backup API for a running database. Before this workflow release, a complete backup was saved under `backups/before-scheduling-workflows.db`; later release backups may also be present. Original source snapshots are in `backups/`. Keep backups private and copy them to institution-approved storage under its retention policy.

Alternatively, stop the application cleanly before copying files. Never delete live WAL/SHM files or copy only a live main database while ignoring uncheckpointed WAL changes. The session store is separate; preserving it and the session secret preserves sessions. Treat restored sessions according to the institution's recovery policy.

## Recovery

1. Stop the application.
2. Back up the current files again before restoring anything.
3. Restore a verified application database snapshot to the configured path. Restore matching source/configuration when rolling back a release. Handle existing WAL/SHM files only while the database is closed and under the recovery procedure.
4. Start a single application instance. Check SQLite integrity/foreign keys, login, active account counts, appointments, availability and records.
5. Validate migrations, reminder deduplication and queue behavior before returning access to users. Record the restore date and any records lost since the snapshot.

## Evidence to collect

Keep screenshots of the HTTPS deployment and role-specific acceptance tasks; a dated test report; backup/restore exercise results; real evaluation responses and analysis; and adviser/client sign-off. Do not substitute generated screenshots or fictional respondents for these activities.

## Verified administrator backups and offline restore

Administrators can create and download verified application snapshots from Overview. BACKUP_DIR can specify a private backup location; the default is the backups directory beside the application database. Only completed portal-created backups are listed. Copies are verified for SQLite integrity and foreign-key consistency before publication in the admin controls. Session databases and the session secret require separate operational backup handling.

To restore, stop every scheduler instance, preserve a copy of the current application and session databases, and run:

```powershell
npm run restore:backup -- --file "C:\path\to\portal-backup.db" --confirm-replace
```

Set DB_PATH, SESSION_DB_PATH and PORT to the same values as the deployed service when customized. The tool refuses an occupied application port, validates the source and retains the previous database beside the target. Existing login sessions are cleared so restored account IDs cannot inherit old sessions. Restart the application afterward for compatible migrations. Test recovery using disposable copies before using it on live records. Do not perform a live database replacement.
