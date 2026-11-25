# Requirements Traceability and Validation

Release review: November 25, 2026 (Asia/Manila).

This matrix maps the functional requirements in the supplied capstone paper to the implemented application. Automated checks are evidence of the tested behavior, not a substitute for respondent evaluation, client approval, actual camera/mobile testing, or public deployment.

## Functional requirements

| Requirement | Implemented behavior | Main automated evidence |
|---|---|---|
| FR-01 Login | Password verification and separate student/faculty/admin access | Password bypass, role-boundary and session-restart tests |
| FR-02 Role-based access | Own-record scope, active-account checks and admin-only management | Report ownership, protected records, profile and admin access tests |
| FR-03 Faculty directory | Interactive profiles for all roles, live slots, search and student booking handoff | Directory handoff, stale-slot and read-only admin interface tests; visual review remains manual |
| FR-04 Availability | Date selection and generated available slots using weekly/date-specific windows | Slot-duration, blocked-range and booking validation tests |
| FR-05 Booking | Validated pending requests with conflict prevention | Booking and simultaneous-request tests |
| FR-06 Consultation reason | Required purpose and bounded optional remarks | Booking API validation and saved-record checks |
| FR-07 Manage own appointments | View, cancel, and request rescheduling while keeping the original slot | Student reschedule API and complete student/faculty interface flow |
| FR-08 Notifications | Approval/rejection/cancellation/rescheduling updates and deduplicated in-app reminders | Notification creation and reminder lead/deduplication tests |
| FR-09 Availability management | Add/edit/remove recurring or date-specific windows with 15/30/45/60-minute slots | Availability editing, conflict preservation and 45-minute-slot tests |
| FR-10 Unavailable time | All-day or specific-hour blocks with existing-booking review | Partial-day block API and interface tests |
| FR-11 Review/modify requests | Faculty approve/reject and propose a different time; recipient must accept | Faculty-proposal, decline, withdrawal and conflict-on-accept tests |
| FR-12 Faculty schedules | Actual-date day/week/month calendar, date navigation and non-hour start times | Off-hour appointments and correct-week/month interface test |
| FR-13 Update status | Complete a served consultation, cancel with reason, mark approved appointments missed after end | Queue lifecycle, faculty status and timing guard tests |
| FR-14 Account management | Create student/faculty accounts, edit, deactivate/reactivate and reset passwords; self-registration stays open | Admin bootstrap, account lifecycle and faculty-creation interface tests |
| FR-15 Monitor records | Read-only admin appointment table, search, status/date/faculty filters and history | Admin records API and cancelled-record pagination interface tests |
| FR-16 Reports | Summaries and CSV by date, faculty/status and search, including cancellations and missed entries | Scoped reporting, cancelled-record export and CSV escaping tests |
| FR-17 Conflict prevention | Shared interval validation inside immediate write transactions | Overlap, simultaneous booking and reschedule revalidation tests |
| FR-18 Status tracking | Pending, approved, rejected, cancelled, completed, missed and checked-in statuses | Status transition and report-distribution tests |
| FR-19 Appointment history | Preserved past/upcoming records, reschedule before/after history and activity | Reschedule history, terminal-state and data-preservation checks |

The optional admin-created student account supports assistance cases. It does not add an approval requirement to student signup. Faculty-directory layout, actual camera behavior and end-user usability remain part of manual acceptance testing.

## How verification is run

```powershell
npm test
```

The tests create disposable SQLite databases and separate local servers. They do not create, cancel, reschedule or delete real user appointments. DOM tests exercise actual frontend handlers against those temporary APIs. Browser rendering, real devices, camera permissions, HTTPS hosting, accessibility review and user acceptance remain manual checks.

The latest saved machine-readable test output is [test-results.tap](test-results.tap). The generated summary is [TEST_REPORT.md](TEST_REPORT.md).

## Live data and release checks

A complete release backup was saved as `backups/before-workflow-release-2026-11-25.db`. A read-only comparison after migration confirmed that all 14 existing accounts, 12 appointments, 24 availability windows and the existing blocked-date records were retained. Existing appointment dates, start/end times, status, purpose and notes were unchanged. Missing legacy QR codes were backfilled without rotating existing codes. SQLite integrity returned `ok`; the foreign-key check returned no violations.

The homepage, new script/stylesheet, student/faculty login, availability, blocks and reschedule endpoints returned successful responses on localhost. Automated live checking only read records and created/destroyed login sessions. The application is not publicly hosted by this release.

## Limitations and remaining evidence

- Visual computer-use verification stopped because the tool could not confidently identify the current browser URL on Windows. No browser safety barrier was bypassed. Layout rendering and real-device checks remain unverified in this release.
- Formal stakeholder acceptance, completed questionnaires, respondent counts/ratings and the final evaluation analysis are pending real sessions. Use [the evaluation kit](evaluation/EVALUATION_KIT.md); do not invent results.
- Public hosting, HTTPS/proxy verification, backup recovery exercises and institution sign-off remain deployment tasks described in [DEPLOYMENT.md](DEPLOYMENT.md).
- QR queueing and slot recommendations are additional implemented features. Email/LMS/SIS/external-calendar integrations remain outside the paper's stated scope.
