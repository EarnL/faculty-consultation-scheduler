# Test report

Release checked: November 25, 2026 (Asia/Manila). Runtime: Node.js v24.14.0.

## Automated results

Command: `node --test --test-reporter=tap tests/*.test.js`

**42 tests passed, 0 failed, 0 skipped.** Total runtime: 36.32 seconds. See the actual [TAP output](test-results.tap).

Coverage includes authentication and role permissions, student registration, account administration, duration-aligned booking, partial-date blocking, protection of existing bookings, concurrent booking conflicts, two-party rescheduling and acceptance-time validation, check-in superseding pending proposals, missed-appointment guards, reminder deduplication, reporting and CSV filters, and appointment-record pagination. DOM tests exercise availability, calendar placement, student/faculty rescheduling, and admin record controls. The interactive-directory checks verify searching, selection, rejection of a newly taken slot, handoff into the booking form, creation of the correct pending request, read-only admin profiles, and removal of the Departments page.

Tests used disposable databases. Production dependency auditing reported zero known vulnerabilities at the time of checking.

## Live application and data

Local HTTP smoke checks succeeded for the homepage, workflow assets, student/faculty login, appointments, availability, blocks and reschedule endpoints. All 14 existing accounts, 12 appointments and 24 availability windows were retained. Existing appointment dates, times, status, purpose and notes were unchanged. Missing legacy QR codes were backfilled. SQLite integrity returned `ok`, with no foreign-key violations.

Release backup: `backups/before-workflow-release-2026-11-25.db`.

## Verification limits

Visual browser verification could not be completed because the computer-use tool returned unavailable input geometry and inconsistent target-window screenshots. DOM tests do not establish visual correctness; actual browser, mobile and camera checks remain pending.

Real stakeholder acceptance sessions, questionnaire results, public hosting, HTTPS verification and recovery exercises have not been performed. See the [evaluation kit](evaluation/EVALUATION_KIT.md) and [deployment guide](DEPLOYMENT.md). No stakeholder results were fabricated.

## Arrival and header validation

The suite now checks the Philippine-time check-in opening boundary, faculty-only permissions, read-only arrival review, approved-pass access, duplicate-arrival idempotence, manual lookup and confirmation, opaque QR payloads, fresh status validation, scheduled queue order, notification preview/read navigation, and desktop/mobile sidebar toggles. The existing check-in lifecycle tests now use assigned-faculty confirmation. These tests used disposable data. Camera hardware, camera permissions and responsive visual layout require real-browser/device verification.

## Profile refresh validation

Profile checks cover optional contact validation, persistence and clearing, preservation of sign-in/identity fields, read-only identification, contact form saving, uploaded photo propagation to the header, password-confirmation mismatch, and a successful password change through the separate card. All mutations occurred in disposable test databases. Two optional contact columns are added to existing user records without replacing them. A pre-release backup is saved as `backups/before-profile-refresh-2026-11-25.db`.

## Daily-use improvements

Tests cover faculty-only location/instruction changes and invalid meeting-link rejection, current instructions in appointments, affected-student notifications, required rejection reasons, explicit pending-approval booking receipts, unattended review without automatic status changes, administrator-only verified backups, and offline restore confirmation using disposable copies. A follow-up restore test also passed after adding login-session invalidation. The real application database was backed up before this release as `backups/before-daily-use-improvements-2026-11-25.db`; no live restore was performed.

School-roster verification requires an official roster and a distribution process for registration codes. It is not implemented by this release. Real mobile/camera and stakeholder acceptance checks remain pending.
## Phone installation and deployment preparation verification

November 25, 2026: `npm test` passed **47 tests, 0 failures**, in **38.36 seconds** after the PWA/mobile/deployment changes. New checks cover actual manifest icon dimensions, user-triggered native/manual installation, standalone/insecure visibility, service-worker API bypass and public offline fallback, production default without demo accounts, required session secret, HTTPS proxy cookies, cross-origin rejection, and public-only sitemap. These results came from the current command output; the older `test-results.tap` remains the prior 42-test run.

Live localhost smoke checks returned 200 for health, manifest, service worker, offline page, mobile CSS, both manifest icons and robots.txt. SQLite integrity was `ok`; 14 users and 28 appointments remained. Docker is unavailable in this environment, so the container build, server provisioning, DNS, public HTTPS, search indexing and actual Android/iPhone installation/camera/layout checks remain unverified. No public URL was created.

## Netlify, Render and PostgreSQL preparation

November 25, 2026: the current `npm test` run passed **55 tests, 0 failures**, in **60.89 seconds**. This includes the existing SQLite API/UI regression suite, Netlify build privacy/routing checks, HTTPS proxy/session checks and seven embedded-PostgreSQL integration tests. The same seven PostgreSQL checks separately passed against a real, newly initialized disposable PostgreSQL 18 cluster in **4.38 seconds**. That cluster was bound to loopback, stopped and removed after testing; the existing PostgreSQL service was not used or changed.

PostgreSQL checks cover account creation and unique IDs, simultaneous bookings, faculty approval, private QR passes, rescheduling, venue updates, arrival lookup, concurrent queue start prevention, compressed private backups, refusal to import into occupied targets, rollback of invalid restores, valid restore with session invalidation, session persistence across restart and password-based session revocation. Deployment credentials and network-specific provider settings remain unverified because hosting accounts have not been connected. Netlify CLI setup failed locally during dependency installation; no Netlify authorization, site or deploy was created. No records were uploaded. SQLite still contained 14 users and 28 appointments with integrity `ok` after these changes.

