# Faculty Consultation Hour Scheduler - User Guide

Updated: November 25, 2026 (Asia/Manila). Open http://localhost:3000 while the application is running. Consultation dates and times use Philippine time.

## Students

### Create an account

Choose **Sign In > Student > Create an account**. Enter your student number, name, course/section, and a password of at least eight characters. Department is optional. Confirm the password and submit. Registration signs you in immediately, without email, activation codes, or administrator approval. Each student number can have only one account.

### Book a consultation

Open **Book Consultation**, choose a faculty member, choose a date, then select an available time. Each window uses the faculty's chosen duration: 15, 30, 45, or 60 minutes. Enter the consultation purpose and optional remarks. Submit the request and wait for faculty approval. The system checks faculty and student time conflicts, blocked periods, and current availability.

### Request a different time

1. Open **My Appointments** and locate a pending or approved appointment.
2. Choose **Actions > Request reschedule**.
3. Choose another available date/time, enter a reason, and send the request.
4. Your original booking stays reserved. The proposed slot is checked again when faculty accepts; the proposal itself does not reserve that slot.
5. Follow the request in the reschedule panel. You can withdraw your own unanswered request.

If faculty proposes a new time, choose **Accept new time** or **Decline**. Accepting updates the existing appointment and replaces its QR pass; declining keeps the original time. Do not reuse an old QR screenshot after an accepted reschedule. Checking in or completing the original consultation supersedes any unanswered proposal.

### Cancel, check in, and track progress

Use **Actions > Cancel appointment** for pending or approved appointments. Records remain in appointment history. For an approved appointment on its scheduled date, present your Consultation Pass to the assigned faculty member. Faculty reviews the appointment and confirms arrival; students cannot self-check in. If your phone or camera is unavailable, provide your student number for faculty lookup. Open **Consultation Queue** to see your turn. A skipped turn requires faculty recall before you rejoin the active queue.

### Notifications and profile

Open **Notifications** for decisions, cancellations, reschedule responses, and in-app reminders. Approved consultations receive an upcoming reminder within the preceding 24 hours and a starting-soon reminder within 30 minutes, without duplicates for the same appointment/time/recipient. The server must be running; reminders are stored even when a recipient is signed out. Past appointments do not receive late reminders. Update your name, department, course, image, or password in **Profile**. Ask an administrator for help if you cannot access your account.

## Faculty

### Consultation availability

Open **Availability > Add consultation hours**. Choose either a recurring weekday or one specific date, enter start/end times on 15-minute boundaries, and select a slot duration. The final incomplete interval is omitted; for example, 18:00-20:00 with 45-minute appointments offers 18:00-18:45 and 18:45-19:30.

Use **Edit** to change a window, or **Remove** to delete it. Overlapping consultation windows are rejected. If a change affects active bookings, a review panel lists the students, dates, and times. Resolve those appointments by arranging a reschedule or cancelling with a reason before retrying the availability change. No booking is silently cancelled.

### Block all day or only specific hours

Choose **Block availability**, select a date, then choose **All day** or **Specific hours**. For a meeting from 10:00 to 11:00, enter that range; available consultation slots before and after it remain bookable. An appointment that crosses into the blocked range is unavailable. Enter an optional reason and save. Conflicting active bookings must be resolved first. Remove a block to reopen the period, subject to consultation hours.

### Review appointment and reschedule requests

Open **Appointment Requests**. Search or filter by date/status. Use the row's **Actions** menu to approve, reject, propose a new time, cancel, mark missed, or complete, as allowed by the appointment state. Student reschedule proposals appear in the review panel; your own proposals require student acceptance. A new time is applied only after approval and a fresh conflict check.

Faculty cancellation requires a reason and notifies the student. **Mark as missed** appears for approved appointments only after their scheduled end. **Complete consultation** is available for a checked-in student currently being served. Terminal appointments cannot be reopened.

### Calendar and consultation history

Open **My Schedule** for **Day**, **Week**, and **Month** views. Use previous/next, **Today**, or the date picker. Dates are actual calendar dates; an appointment at 08:15 appears at 08:15 and does not repeat across weeks. Availability windows and blocked periods are shown. Select an appointment to view its notes, rescheduling history, and activity.

Use **Virtual Queue & QR** to check in students, start, skip, recall, and complete consultations. Complete or skip the current consultation before starting another.

## Administrators

The initial administrator is set up locally using `npm run setup:admin`. Sign in on the **Admin** tab using the administrator username and its actual password.

**Overview** displays accounts, departments, consultation totals, and recent account-management activity. **User Accounts** lets you create faculty accounts, optionally create a student account for someone needing assistance, edit details, deactivate/reactivate users, and reset passwords. Student self-registration remains immediate. Deactivation and password resets revoke the affected sessions while preserving consultation records. Share initial/reset credentials privately. Administrator credentials are changed through the administrator's own profile.

The portal focuses on Information Technology. The administrator Departments page and its overview links have been removed; existing account records are preserved.

**Appointment Records** is a read-only, searchable table across all users. Filter by faculty, status, dates, or student/purpose text. Cancelled and missed records are included. Use pagination to browse and **Export CSV** to download all records matching the filters, across all pages. Open **Details** for consultation and reschedule history. **School-wide Reports** provides summaries by date, faculty, and status, including cancellations.

## Troubleshooting

- **Old interface:** refresh with Ctrl+Shift+R.
- **Slot no longer available:** refresh the choices; another booking or availability change may have taken it.
- **Reschedule cannot be accepted:** the proposed slot is now unavailable. Decline or withdraw it and arrange another time; the original booking remains unchanged.
- **Availability cannot be changed:** review the affected bookings shown in the dialog. Resolve them before saving again.
- **Camera access unavailable:** use the manual verification code. Camera scanning requires permission and localhost or HTTPS.
- **No reminder while the app is stopped:** reminders are processed while the server runs; they are not email or SMS messages.

## Interactive faculty directory

Open **Faculty Members** to search by name or specialization, or filter to faculty with open slots in the next 14 days. Cards show the next available consultation based on live scheduling data. Click a card to open the full profile page, review published hours and consultation durations, and choose a date and time. The IT department logo appears in the directory header.

Students can select **Request Consultation** to continue to the existing purpose/remarks form with their chosen faculty, date and time already selected. The app checks the slot again before continuing and when submitting. A submitted request remains pending until faculty approval. Faculty and administrators can browse profiles and availability, with no student booking action. Use Back to faculty members to return to the directory with your search and availability filter preserved.

## Header and arrival confirmation

The logged-in header shows your current page, Philippine date, profile shortcut and notification bell with an unread count. Click the bell for recent updates; select an update to mark it read and open Notifications, or choose View all notifications. Use the chevron inside the sidebar to collapse navigation. A hamburger appears in the header only while navigation is closed; click it to reopen the sidebar. Desktop collapse preference is saved in this browser; mobile navigation has a chevron collapse button and overlay. Escape closes the notification dropdown or mobile sidebar.

Faculty can open Scan QR / Check-In from the consultation queue, scan a pass, enter its code, or look up a student number. Review the student, purpose and appointment time before selecting Confirm arrival. Check-in opens 15 minutes before the scheduled start on the same Philippine date. After the scheduled end, the assigned faculty member must record a late-arrival reason. Duplicate scans preserve the original arrival and do not create another queue entry. Queue ordering follows scheduled times; queue numbers identify entries rather than granting priority. Cancelled, rejected, missed, pending and completed appointments cannot be checked in. Accepted rescheduling invalidates the old QR. No camera is required for manual lookup.

## My Profile and header photo

Click your larger profile avatar in the header or open My Profile. The page shows your student number/faculty ID (read-only), department, name, course/section or specialization, and optional contact number and contact email. Saving contact details does not change sign-in credentials. Contact an administrator to correct identification details. Contact details are not shown in the faculty directory.

Choose Change photo, select a JPG/PNG/WebP image up to 1 MB, then Save photo. The saved photo appears immediately in the header and sidebar. Remove restores the default profile image and header initials. Password fields are hidden until you select Change password; enter the current password, new password, and matching confirmation in the card. Closing the card clears its password inputs. A successful change signs out other sessions.

The active navigation item has a highlighted background, accent indicator and accessible current-page label. On mobile, opening navigation locks background scrolling and keeps keyboard focus inside the drawer; Escape or the overlay closes it. Reduced-motion preferences disable navigation animations.

## Consultation instructions and daily overview

Faculty can save a room/office, optional HTTPS meeting link and meeting instructions in My Profile. Students see current instructions in the faculty profile, next-consultation card, appointment details and consultation pass. Updating instructions notifies students with upcoming active appointments; check the current details before attending. Private contact fields remain separate.

Student and faculty dashboards highlight the next active consultation, status and current location. Faculty also see elapsed approved appointments under Attendance review. Select one to review its history and mark it missed if appropriate. Attendance is never changed automatically. Rejection requires a reason; suggested reasons can be selected and edited before sending. After booking, the confirmation card explicitly says Awaiting faculty approval and links to My Appointments.

## Administrator backups

On Overview, Create backup produces and verifies a consistent SQLite application backup. The latest successful backup time and a download link appear there. Access is restricted to administrators. Restore is deliberately an offline operation described in DEPLOYMENT.md; no restore runs from the web interface.
