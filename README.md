# DLL Faculty Consultation Hour Scheduler

A local web application for student appointment requests, faculty office hours, QR check-in, consultation queues, notifications, and private reports.

## Run on Windows

Install Node.js with npm. This project was verified using Node.js 24.14.0.

Open PowerShell in the directory containing `package.json`:

```powershell
npm install
npm start
```

Visit http://localhost:3000. Stop the server with Ctrl+C.

```powershell
npm run dev   # Restart automatically when server code changes
npm test      # Integration checks against disposable databases
```

Use separate browser profiles or a private window to test student and faculty simultaneously.

## Demo accounts

Fresh installations seed `student@dll.edu.ph` and `faculty@dll.edu.ph`, both with password `123456`. Choose the matching login role. Existing installations retain their actual account passwords; demo passwords no longer bypass password checks. New passwords require at least 8 characters and at most 72 UTF-8 bytes.

## Student registration

Select **Student → Create an account** on the sign-in page. Enter a student number, full name, course/section, and password; department is optional. Successful signup signs the student in immediately. No email, activation code, or administrator approval is required. Student numbers accept 3–30 letters, digits, or hyphens and cannot be registered twice, including for deactivated accounts. Numbers are self-declared; the system checks format and uniqueness, not official enrollment.

## Administration

The **Admin** sign-in tab uses a separate administrator username. The first administrator is created locally with:

```powershell
npm run setup:admin -- --username admin --name "System Administrator"
```

Setup prints a randomly generated password once. Alternatively, supply `ADMIN_PASSWORD` through the environment. Setup refuses to overwrite an existing administrator. Change the generated password in **My Profile** after signing in. There is no public administrator or faculty registration.

The administration area includes:

- Overview with account counts, consultation totals, quick links, and recent audit activity.
- Searchable accounts, filtered by role and status.
- Faculty account creation with faculty ID, name, department, specialization, and initial password; optional student account creation for assistance, without changing open self-registration.
- Editing student and faculty details, deactivation/reactivation, and password resets.
- IT department administration with user accounts, appointment records, and reports; no separate Departments page.
- Searchable, paginated appointment records and history, including cancelled and missed records.
- IT department analytics and CSV exports with date, status, faculty and record-search filters; exports include matching records across all pages.

Deactivation signs the account out while preserving consultation history. Password resets revoke its sessions. Admin accounts cannot be deactivated or reset through the account table; administrators change their own password through their profile. Faculty and students cannot access admin endpoints. Administration changes are recorded in an audit log.

Demo data is inserted transactionally only when the users table is empty. Schema upgrades run automatically and preserve existing accounts and appointments.

## Interactive faculty directory

Faculty Members now offers searchable cards, upcoming availability, and a responsive full-page profile with published hours and live slots. Students can select a slot and continue directly to the consultation details form. Slots are rechecked before the handoff and again on booking submission. Faculty and administrators can browse without booking. The original IT department logo is included in the directory header.

## Workflow

1. Faculty configure recurring or date-specific consultation hours and choose 15, 30, 45, or 60-minute appointments. Availability blocks can cover a whole day or specific hours.
2. Students choose faculty, date, and an available slot of the configured duration, then submit a request.
3. Faculty approve or reject requests.
4. On the scheduled Manila date, the assigned faculty reviews the QR/code or student-number lookup and confirms arrival.
5. Faculty start, skip, recall, and complete consultations in the queue. Complete or skip the current consultation before serving another student.

The API supports appointments lasting 15–60 minutes in 15-minute intervals; the current booking screen selects 15-minute appointments. Faculty and student time conflicts are rejected. Terminal appointments cannot be reopened.

Reports and CSV exports remain scoped to the signed-in student or faculty member, including when selecting “all.” Administrators can view school-wide reports. Notifications are in-app; no email or SMS service is configured. Approved appointments generate deduplicated reminders within 24 hours and 30 minutes of their start for both parties. Reminders run every 30 seconds while the server is running; the notification badge also refreshes every 30 seconds. Queue screens poll every eight seconds. Slot recommendations use availability rules over the next two weeks.

Camera scanning requires browser permission and a secure browser context (localhost or HTTPS). Manual verification-code entry and faculty lookup by student number are available. Arrival requires assigned-faculty review and confirmation, opens 15 minutes before the scheduled time on the appointment date, and requires a recorded reason after the scheduled end. Students cannot self-check in. Duplicate scans preserve the original arrival; queue ordering follows scheduled times.

## Files and configuration

- `server.js`: Express API, sessions, analytics, check-in, queue, and demo seed.
- `checkin.js`: faculty-only arrival review, confirmation, appointment passes and manual student-number lookup.
- `public/js/consultation-pass.js`: consultation passes and optional camera/manual arrival workflow.
- `public/js/portal-header.js`, `public/css/portal-header.css`: logged-in header, notification dropdown and collapsible sidebar.
- `scheduling.js`: shared availability validation, transactional booking/rescheduling, partial-day blocks, reminder worker, appointment history, and administrator record search.
- `public/js/workflow-screens.js`, `public/css/workflows.css`: appointment, rescheduling, availability, calendar and record screens.
- `accounts.js`: account migration, registration, administrator APIs, and audit logging.
- `public/js/account-screens.js`: student registration and administrator screens.
- `scripts/setup-admin.js`: first-administrator setup command.
- `public/index.html`, `public/js/app.js`, `public/css/style.css`: active frontend.
- `scheduler.db`: SQLite application data. The adjacent WAL/SHM files are managed by SQLite.
- `sessions.db`: persistent login sessions; created automatically.
- `.session-secret`: random local session secret; created automatically. Keep this private.
- `tests/integration.test.js`, `tests/workflows.test.js`: isolated API and DOM regression tests.
- `docs/`: user guide, diagrams/data dictionary, deployment guide, evaluation kit and test evidence.
- `backups/before-admin-registration.db`: database snapshot before adding registration and administration.
- `backups/before-improvements.db`: complete database snapshot from before these changes. Original source files are also in `backups`.

Environment variables (PowerShell example):

```powershell
$env:PORT = '3001'
npm start
```

`DB_PATH` and `SESSION_DB_PATH` override database paths. `SESSION_SECRET` overrides the generated local secret. The application consistently uses Asia/Manila for school dates. Production mode (`NODE_ENV=production`) requires HTTPS for secure session cookies; a same-machine HTTPS reverse proxy can set `TRUST_PROXY=loopback`. Other topologies require a reviewed proxy configuration.

The root `index.html`, root `style.css`, and empty `database.sqlite` are legacy files and are not served by the app.

## Backups and deployment

Back up SQLite using its backup API, or stop the app cleanly before copying database files. Do not delete WAL files from an active database. Keep backups outside the public directory and preserve the session secret across restarts.

The application includes exact password verification, login throttling, regenerated session IDs on login, persistent expiring sessions, ownership checks, same-origin write checks, HTML escaping, and CSV formula escaping. Password changes revoke the account's other login sessions. There is no external identity provider, password-reset email workflow, or multi-instance deployment configuration yet.

Integration tests use disposable databases and cover registration, account administration, authorization, scheduling, and persistent sessions. DOM tests exercise student signup and the admin sign-in, faculty creation, editing, and search flows. Automated tests do not cover camera hardware or visual browser layout.


## Project documentation

- [User guide](docs/USER_GUIDE.md)
- [System architecture, diagrams, ERD and data dictionary](docs/SYSTEM_DESIGN.md)
- [Deployment and recovery](docs/DEPLOYMENT.md)
- [Requirements and validation](docs/REQUIREMENTS_AND_TESTS.md)
- [User acceptance and evaluation kit](docs/evaluation/EVALUATION_KIT.md)

User evaluation scores and public-hosting evidence require actual stakeholder sessions and deployment. The evaluation kit leaves those results blank.

## Daily consultation tools

Dashboards highlight the next consultation and faculty attendance review. Faculty manage room/office, optional HTTPS meeting links and consultation instructions through My Profile; students see current details throughout the appointment flow. Rejections require an explanatory reason, and booking submission shows a pending-approval receipt. Admin Overview supports verified application backups and download; the guarded offline restore command is documented in docs/DEPLOYMENT.md. School-roster verification remains optional and is not enabled without an institution-provided roster and code distribution process.
## Phone installation and hosting

The portal now includes phone layouts and a browser-installed app experience. Use the **Install app** button on HTTPS or follow the iPhone/Android instructions in [Hosting and phone installation](docs/HOSTING_AND_PHONE_INSTALL.md). Docker Compose deployment files include persistent SQLite storage and an HTTPS reverse proxy. A hosting account, server and hostname are still needed; no public deployment has been created by these files. Production starts without demo accounts.

For the selected free Netlify + Render setup, see [Render and Netlify deployment](docs/RENDER_NETLIFY_DEPLOYMENT.md). DATABASE_URL enables persistent PostgreSQL accounts, appointments and sessions. The frontend build proxies API requests to Render. Local SQLite remains supported; migration and PostgreSQL restore commands are separate from local SQLite recovery. Actual publishing still requires connected hosting accounts.

