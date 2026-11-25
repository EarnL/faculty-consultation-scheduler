const crypto = require('crypto');
const ACTIVE = ['pending', 'approved', 'checked-in'];
const RESERVED = [...ACTIVE, 'completed'];
const STATUSES = [...RESERVED, 'rejected', 'cancelled', 'no-show'];
const schoolDate = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const validTime = (t) => typeof t === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const time = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const weekday = (d) => new Date(d + 'T12:00:00+08:00').getUTCDay();
const instant = (date, t) => new Date(`${date}T${t}:00+08:00`);
const overlaps = (s, e, start, end) => s < end && e > start;
const text = (s, max = 2000) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const fail = (message, status = 400, extra = {}) => {throw Object.assign(new Error(message), { status, ...extra });};

function migrateScheduling(db) {
  const add = (table, column, definition) => {if (!db.pragma(`table_info(${table})`).some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);};
  db.transaction(() => {
    add('faculty_schedules', 'slot_duration', 'INTEGER NOT NULL DEFAULT 15');
    add('faculty_schedules', 'specific_date', 'TEXT');
    add('blocked_dates', 'start_time', 'TEXT');add('blocked_dates', 'end_time', 'TEXT');
    add('appointments', 'cancel_reason', "TEXT NOT NULL DEFAULT ''");
    db.exec(`CREATE TABLE IF NOT EXISTS reschedule_requests (
      id INTEGER PRIMARY KEY, appointment_id INTEGER NOT NULL REFERENCES appointments(id), requested_by INTEGER NOT NULL REFERENCES users(id),
      original_date TEXT NOT NULL,original_start TEXT NOT NULL,original_end TEXT NOT NULL,
      proposed_date TEXT NOT NULL,proposed_start TEXT NOT NULL,proposed_end TEXT NOT NULL,reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn','superseded')),
      response_note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),responded_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_reschedule ON reschedule_requests(appointment_id) WHERE status='pending';
      CREATE TABLE IF NOT EXISTS appointment_events (id INTEGER PRIMARY KEY,appointment_id INTEGER NOT NULL REFERENCES appointments(id),actor_id INTEGER REFERENCES users(id),action TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
      CREATE INDEX IF NOT EXISTS events_by_appointment ON appointment_events(appointment_id,id);
      CREATE TABLE IF NOT EXISTS reminder_deliveries (id INTEGER PRIMARY KEY,appointment_id INTEGER NOT NULL REFERENCES appointments(id),scheduled_for TEXT NOT NULL,lead_minutes INTEGER NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),sent_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),UNIQUE(appointment_id,scheduled_for,lead_minutes,user_id));`);
  })();
}

function createSchedulingService(db, notify) {
  async function faculty(id) {const f = await db.prepare("SELECT * FROM users WHERE id=? AND role='faculty' AND is_active=1").get(id);if (!f) fail('Faculty not found', 404);return f;}
  const schedules = async (id, date) => await db.prepare('SELECT * FROM faculty_schedules WHERE faculty_id=? AND is_available=1 AND (specific_date=? OR (specific_date IS NULL AND day_of_week=?)) ORDER BY start_time').all(id, date, weekday(date));
  const blocks = async (id, date) => await db.prepare('SELECT * FROM blocked_dates WHERE faculty_id=? AND date=?').all(id, date);
  function fits(s, date, start, end) {return (s.specific_date ? s.specific_date === date : s.day_of_week === weekday(date)) && s.start_time <= start && s.end_time >= end;}
  async function availableSlots(id, date, studentId, exclude = 0, now = new Date()) {
    await faculty(id);if (!validDate(date)) fail('Choose a valid date');if (date < schoolDate(now)) return [];
    const blocked = await blocks(id, date);
    const bookings = await db.prepare("SELECT time_slot,end_time FROM appointments WHERE date=? AND (faculty_id=? OR student_id=?) AND id!=? AND status IN ('pending','approved','checked-in','completed')").all(date, id, studentId || 0, exclude);
    const slots = [];
    for (const s of await schedules(id, date)) for (let n = minutes(s.start_time); n + s.slot_duration <= minutes(s.end_time); n += s.slot_duration) {
      const start = time(n),end = time(n + s.slot_duration);
      if (instant(date, start) <= now || blocked.some((b) => !b.start_time || overlaps(start, end, b.start_time, b.end_time)) || bookings.some((b) => overlaps(start, end, b.time_slot, b.end_time))) continue;
      if (!slots.some((x) => x.start === start && x.end === end)) slots.push({ start, end, duration: s.slot_duration });
    }
    return slots.sort((a, b) => a.start.localeCompare(b.start));
  }
  async function validateSlot(id, studentId, date, start, end, exclude = 0) {
    if (!validDate(date) || !validTime(start) || !validTime(end) || start >= end) fail('Choose a valid date and time range');
    await faculty(id);
    if (instant(date, start) <= new Date()) fail('The selected appointment time has already passed');
    if (!(await availableSlots(id, date, studentId, exclude)).some((s) => s.start === start && s.end === end)) fail('This slot is unavailable. Choose a slot within the faculty’s current consultation hours and slot duration.', 409);
  }
  const event = async (id, actor, action, details = {}) => await db.prepare('INSERT INTO appointment_events(appointment_id,actor_id,action,details) VALUES(?,?,?,?)').run(id, actor, action, JSON.stringify(details));
  const code = () => 'DLL-' + crypto.randomBytes(10).toString('hex').toUpperCase();
  const own = (user, a) => user.role === 'student' ? a.student_id === user.id : user.role === 'faculty' ? a.faculty_id === user.id : false;
  async function appointment(id, user, allowAdmin = false) {const a = await db.prepare('SELECT * FROM appointments WHERE id=?').get(id);if (!a) fail('Appointment not found', 404);if (!own(user, a) && !(allowAdmin && user.role === 'admin')) fail('Forbidden', 403);return Object.assign(a, await db.prepare('SELECT consultation_location,meeting_link,consultation_instructions FROM users WHERE id=?').get(a.faculty_id));}
  async function resolvePending(id) {await db.prepare("UPDATE reschedule_requests SET status='superseded',responded_at=datetime('now','localtime') WHERE appointment_id=? AND status='pending'").run(id);}
  async function affected(id, predicate) {return (await db.prepare("SELECT a.id,a.date,a.time_slot,a.end_time,a.status,u.name AS student_name FROM appointments a JOIN users u ON u.id=a.student_id WHERE a.faculty_id=? AND a.status IN ('pending','approved','checked-in') AND a.date>=? ORDER BY a.date,a.time_slot").all(id, schoolDate())).filter(predicate);}
  const requireResolved = (list) => {if (list.length) fail('Resolve the affected appointments before saving this availability change. Existing bookings have been preserved.', 409, { affected_appointments: list });};
  async function reminders(now = new Date()) {
    let sent = 0;
    await db.transaction(async () => {
      const rows = await db.prepare("SELECT a.*,s.name AS student_name,f.name AS faculty_name FROM appointments a JOIN users s ON s.id=a.student_id JOIN users f ON f.id=a.faculty_id WHERE a.status='approved' AND s.is_active=1 AND f.is_active=1 AND a.date BETWEEN ? AND ?").all(schoolDate(now), schoolDate(new Date(now.getTime() + 86400000)));
      for (const a of rows) {const delta = (instant(a.date, a.time_slot) - now) / 60000;if (delta <= 0 || delta > 1440) continue;const lead = delta <= 30 ? 30 : 1440;
        for (const userId of [a.student_id, a.faculty_id]) {
          const scheduled = a.date + 'T' + a.time_slot;
          const done = await db.prepare('INSERT OR IGNORE INTO reminder_deliveries(appointment_id,scheduled_for,lead_minutes,user_id) VALUES(?,?,?,?)').run(a.id, scheduled, lead, userId);
          if (!done.changes) continue;
          await notify(userId, lead === 30 ? 'Consultation Starting Soon' : 'Upcoming Consultation', `Your consultation ${userId === a.student_id ? 'with ' + a.faculty_name : 'with ' + a.student_name} is scheduled for ${a.date}, ${a.time_slot}–${a.end_time}${lead === 30 ? ' (within 30 minutes)' : ''}.`, 'info', a.id);sent++;
        }
      }
    }).immediate();return sent;
  }
  return { faculty, schedules, blocks, fits, availableSlots, validateSlot, event, code, own, appointment, resolvePending, affected, requireResolved, reminders };
}

async function installScheduling({ app, db, auth, facultyOnly, notify }) {
  const service = createSchedulingService(db, notify);
  const { faculty, availableSlots, validateSlot, event, code, appointment, resolvePending, affected, requireResolved, fits } = service;
  const route = (fn) => async (req, res, next) => {try {await fn(req, res);} catch (e) {if (e.status) return res.status(e.status).json({ error: e.message, ...(e.affected_appointments ? { affected_appointments: e.affected_appointments } : {}) });next(e);}};
  const atomic = fn => route(require('./transaction-response')(db,fn));
  const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Administrator access required' });
  app.get('/api/faculty/:id/slots', auth, route(async (req, res) => {
    const exclude = Number(req.query.exclude_appointment_id) || 0;
    if (exclude) {const a = await appointment(exclude, req.user);if (a.faculty_id !== Number(req.params.id)) fail('Choose the assigned faculty', 400);}
    res.json(await availableSlots(Number(req.params.id), req.query.date, req.user.role === 'student' ? req.user.id : exclude ? (await db.prepare('SELECT student_id FROM appointments WHERE id=?').get(exclude)).student_id : 0, exclude));
  }));
  app.get('/api/faculty/:id/recommendation', auth, route(async (req, res) => {
    const id = Number(req.params.id);await faculty(id);const found = [];
    for (let d = 0; d <= 14; d++) {const date = schoolDate(new Date(Date.now() + d * 86400000));for (const s of await availableSlots(id, date, req.user.role === 'student' ? req.user.id : 0)) found.push({ date, day_name: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday(date)], time_slot: s.start, start_time: s.start, end_time: s.end, duration: s.duration });}
    const chosen = found.find((s) => s.date === req.query.date && s.time_slot === req.query.time) || found.find((s) => s.date === req.query.date) || found[0];
    const recommended = chosen ? { ...chosen, reason: chosen.date === req.query.date ? 'Available on your preferred date.' : 'Earliest available consultation slot.' } : null;
    res.json({ recommended, recommendation: recommended, alternatives: found.filter((s) => s !== chosen).slice(0, 5), message: recommended ? '' : 'No available consultation slots within the next two weeks.' });
  }));
  app.post('/api/appointments', auth, atomic(async (req, res) => {
    if (req.user.role !== 'student') fail('Students only', 403);
    const b = req.body;
    if (!Number.isSafeInteger(Number(b.faculty_id)) || !text(b.purpose, 500) || b.remarks != null && (typeof b.remarks !== 'string' || b.remarks.length > 2000)) fail('Enter valid appointment details and a purpose');
    await validateSlot(Number(b.faculty_id), req.user.id, b.date, b.time_slot, b.end_time);
    const id = Number((await db.prepare('INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,remarks,checkin_code) VALUES(?,?,?,?,?,?,?,?)').run(req.user.id, b.faculty_id, b.date, b.time_slot, b.end_time, b.purpose.trim(), b.remarks || '', code())).lastInsertRowid);
    await event(id, req.user.id, 'created', { date: b.date, start: b.time_slot, end: b.end_time });
    await notify(Number(b.faculty_id), 'New Consultation Request', `${req.user.name} requested a consultation on ${b.date} at ${b.time_slot}.`, 'info', id);
    await notify(req.user.id, 'Request Submitted', `Your consultation on ${b.date} at ${b.time_slot} is pending approval.`, 'info', id);res.json({ id });
  }));
  app.put('/api/appointments/:id', auth, atomic(async (req, res) => {
    const a = await appointment(req.params.id, req.user),b = req.body,status = b.status;
    if (req.user.role === 'student' && (status !== 'cancelled' || b.faculty_remarks !== undefined)) fail('Students can only cancel their own appointment', 403);
    if (b.faculty_remarks !== undefined && (typeof b.faculty_remarks !== 'string' || b.faculty_remarks.length > 2000)) fail('Remarks must be at most 2000 characters');
    const transitions = { pending: ['approved', 'rejected', 'cancelled'], approved: ['cancelled', 'no-show'], 'checked-in': ['completed', 'cancelled'], completed: [], cancelled: [], rejected: [], 'no-show': [] };
    if (status !== undefined && !transitions[a.status]?.includes(status)) fail('This appointment cannot transition to the requested status', 409);
    if (status === 'rejected' && !text(b.reason || b.faculty_remarks)) fail('Enter a rejection reason');
    if (status === 'cancelled' && req.user.role === 'faculty' && !text(b.reason || b.faculty_remarks)) fail('Enter a cancellation reason');
    if (status === 'no-show' && instant(a.date, a.end_time) > new Date()) fail('An appointment cannot be marked missed before its scheduled end', 409);
    if (status === 'completed' && a.queue_status !== 'serving') fail('Start the consultation in the queue before completing it', 409);
    if (status === 'approved') await validateSlot(a.faculty_id, a.student_id, a.date, a.time_slot, a.end_time, a.id);
    const reason = b.reason || b.faculty_remarks || '';if (typeof reason !== 'string' || reason.length > 2000) fail('Reason must be at most 2000 characters');
    await db.prepare("UPDATE appointments SET status=coalesce(?,status),faculty_remarks=coalesce(?,faculty_remarks),cancel_reason=CASE WHEN ?='cancelled' THEN ? ELSE cancel_reason END,updated_at=datetime('now','localtime') WHERE id=?").run(status || null, b.faculty_remarks ?? (status === 'rejected' ? reason : null), status || null, reason, a.id);
    if (status === 'approved' && !a.queue_number) {const n = (await db.prepare('SELECT coalesce(max(queue_number),0)+1 AS n FROM appointments WHERE faculty_id=? AND date=?').get(a.faculty_id, a.date)).n;await db.prepare('UPDATE appointments SET queue_number=? WHERE id=?').run(n, a.id);}
    if (status === 'completed') await db.prepare("UPDATE appointments SET queue_status='completed' WHERE id=?").run(a.id);
    if (['cancelled', 'no-show'].includes(status)) await db.prepare("UPDATE appointments SET queue_status='skipped' WHERE id=?").run(a.id);
    if (status && status !== 'approved') await resolvePending(a.id);
    await event(a.id, req.user.id, status || 'remarks_updated', { reason });
    if (status) {const label = status === 'no-show' ? 'Marked Missed' : status[0].toUpperCase() + status.slice(1);await notify(req.user.role === 'student' ? a.faculty_id : a.student_id, 'Appointment ' + label, `The consultation on ${a.date} at ${a.time_slot} was ${status === 'no-show' ? 'marked missed' : status}.${reason ? ' Reason: ' + reason : ''}`, status === 'cancelled' ? 'warning' : 'info', a.id);}
    res.json({ ok: true });
  }));
  app.get('/api/reschedules', auth, route(async (req, res) => {
    if (!['student', 'faculty', 'admin'].includes(req.user.role)) fail('Forbidden', 403);
    const scope = req.user.role === 'admin' ? '1=1' : req.user.role === 'student' ? 'a.student_id=?' : 'a.faculty_id=?';
    res.json(await db.prepare(`SELECT r.*,a.student_id,a.faculty_id,a.status AS appointment_status,s.name AS student_name,f.name AS faculty_name,u.name AS requested_by_name FROM reschedule_requests r JOIN appointments a ON a.id=r.appointment_id JOIN users s ON s.id=a.student_id JOIN users f ON f.id=a.faculty_id JOIN users u ON u.id=r.requested_by WHERE ${scope} ORDER BY r.id DESC`).all(...(req.user.role === 'admin' ? [] : [req.user.id])));
  }));
  app.post('/api/appointments/:id/reschedule', auth, atomic(async (req, res) => {
    const a = await appointment(req.params.id, req.user),b = req.body;
    if (!['pending', 'approved'].includes(a.status)) fail('Only pending or approved appointments can be rescheduled', 409);
    if (!text(b.reason)) fail('Enter a reason for the reschedule');
    if (await db.prepare("SELECT id FROM reschedule_requests WHERE appointment_id=? AND status='pending'").get(a.id)) fail('This appointment already has a pending reschedule request', 409);
    if (a.date === b.date && a.time_slot === b.time_slot && a.end_time === b.end_time) fail('Choose a different consultation slot');
    await validateSlot(a.faculty_id, a.student_id, b.date, b.time_slot, b.end_time, a.id);
    const id = Number((await db.prepare('INSERT INTO reschedule_requests(appointment_id,requested_by,original_date,original_start,original_end,proposed_date,proposed_start,proposed_end,reason) VALUES(?,?,?,?,?,?,?,?,?)').run(a.id, req.user.id, a.date, a.time_slot, a.end_time, b.date, b.time_slot, b.end_time, b.reason.trim())).lastInsertRowid);
    await event(a.id, req.user.id, 'reschedule_requested', { request_id: id, date: b.date, start: b.time_slot, end: b.end_time, reason: b.reason.trim() });
    await notify(req.user.role === 'student' ? a.faculty_id : a.student_id, 'Reschedule Requested', `${req.user.name} proposed ${b.date}, ${b.time_slot}–${b.end_time}. Your original booking remains unchanged until you accept.`, 'info', a.id);
    res.status(201).json({ id });
  }));
  app.put('/api/reschedules/:id', auth, atomic(async (req, res) => {
    const r = await db.prepare('SELECT * FROM reschedule_requests WHERE id=?').get(req.params.id);if (!r) fail('Request not found', 404);
    const a = await appointment(r.appointment_id, req.user),{ action, note = '' } = req.body;
    if (!['approve', 'reject', 'withdraw'].includes(action) || typeof note !== 'string' || note.length > 2000) fail('Choose a valid response');
    if (r.status !== 'pending') fail('This reschedule request has already been resolved', 409);
    if (action === 'withdraw' ? r.requested_by !== req.user.id : r.requested_by === req.user.id) fail('Only the other party can accept or decline a proposal; only its author can withdraw it', 403);
    if (!['pending', 'approved'].includes(a.status) || a.date !== r.original_date || a.time_slot !== r.original_start || a.end_time !== r.original_end) fail('The original appointment has changed; create a new request', 409);
    if (action === 'approve') {
      await validateSlot(a.faculty_id, a.student_id, r.proposed_date, r.proposed_start, r.proposed_end, a.id);
      await db.prepare("UPDATE appointments SET date=?,time_slot=?,end_time=?,status='approved',queue_number=NULL,queue_status='waiting',checkin_time=NULL,checkin_code=?,updated_at=datetime('now','localtime') WHERE id=?").run(r.proposed_date, r.proposed_start, r.proposed_end, code(), a.id);
    }
    const status = { approve: 'approved', reject: 'rejected', withdraw: 'withdrawn' }[action];
    await db.prepare("UPDATE reschedule_requests SET status=?,response_note=?,responded_at=datetime('now','localtime') WHERE id=?").run(status, note, r.id);
    await event(a.id, req.user.id, 'reschedule_' + status, { request_id: r.id, from: { date: r.original_date, start: r.original_start, end: r.original_end }, to: { date: r.proposed_date, start: r.proposed_start, end: r.proposed_end }, note });
    for (const id of [a.student_id, a.faculty_id]) await notify(id, 'Reschedule ' + status[0].toUpperCase() + status.slice(1), action === 'approve' ? `Your consultation is now ${r.proposed_date}, ${r.proposed_start}–${r.proposed_end}. The previous QR pass has been replaced.` : `The reschedule was ${status}. The original appointment remains ${a.date}, ${a.time_slot}–${a.end_time}.${note ? ' Note: ' + note : ''}`, 'info', a.id);
    res.json({ ok: true });
  }));
  app.get('/api/appointments/:id/history', auth, route(async (req, res) => {
    const a = await appointment(req.params.id, req.user, true);
    res.json({ appointment: a, events: (await db.prepare('SELECT e.*,u.name AS actor_name FROM appointment_events e LEFT JOIN users u ON u.id=e.actor_id WHERE appointment_id=? ORDER BY e.id DESC').all(a.id)).map((e) => ({ ...e, details: JSON.parse(e.details) })), reschedules: await db.prepare('SELECT r.*,u.name AS requested_by_name FROM reschedule_requests r JOIN users u ON u.id=r.requested_by WHERE appointment_id=? ORDER BY r.id DESC').all(a.id) });
  }));

  function scheduleData(body) {
    const specific = body.specific_date || null,day = specific ? weekday(specific) : body.day_of_week,duration = body.slot_duration ?? 15;
    if (specific && !validDate(specific) || !Number.isInteger(day) || day < 0 || day > 6 || !validTime(body.start_time) || !validTime(body.end_time) || body.start_time >= body.end_time || minutes(body.start_time) % 15 || minutes(body.end_time) % 15 || ![15, 30, 45, 60].includes(duration) || minutes(body.end_time) - minutes(body.start_time) < duration) fail('Choose a valid day/date, times on 15-minute boundaries, and a 15, 30, 45 or 60-minute slot duration');
    if (specific && specific < schoolDate()) fail('Choose today or a future date');
    return { specific_date: specific, day_of_week: day, start_time: body.start_time, end_time: body.end_time, slot_duration: duration };
  }
  async function scheduleConflict(id, s, exclude = 0) {
    const other = await db.prepare('SELECT * FROM faculty_schedules WHERE faculty_id=? AND id!=? AND is_available=1').all(id, exclude);
    if (other.some((o) => overlaps(s.start_time, s.end_time, o.start_time, o.end_time) && (s.specific_date ? o.specific_date ? o.specific_date === s.specific_date : o.day_of_week === s.day_of_week : o.specific_date ? o.specific_date >= schoolDate() && o.day_of_week === s.day_of_week : o.day_of_week === s.day_of_week))) fail('This availability overlaps existing consultation hours', 409);
  }
  app.get('/api/schedule', auth, facultyOnly, route(async (req, res) => res.json(await db.prepare('SELECT * FROM faculty_schedules WHERE faculty_id=? ORDER BY specific_date,day_of_week,start_time').all(req.user.id))));
  app.post('/api/schedule', auth, facultyOnly, atomic(async (req, res) => {
    const s = scheduleData(req.body);await scheduleConflict(req.user.id, s);
    const id = Number((await db.prepare('INSERT INTO faculty_schedules(faculty_id,day_of_week,start_time,end_time,slot_duration,specific_date) VALUES(?,?,?,?,?,?)').run(req.user.id, s.day_of_week, s.start_time, s.end_time, s.slot_duration, s.specific_date)).lastInsertRowid);res.status(201).json({ id });
  }));
  app.put('/api/schedule/:id', auth, facultyOnly, atomic(async (req, res) => {
    const original = await db.prepare('SELECT * FROM faculty_schedules WHERE id=? AND faculty_id=?').get(req.params.id, req.user.id);if (!original) fail('Consultation hours not found', 404);
    const s = scheduleData(req.body);await scheduleConflict(req.user.id, s, original.id);
    requireResolved(await affected(req.user.id, (a) => fits(original, a.date, a.time_slot, a.end_time) && (!fits(s, a.date, a.time_slot, a.end_time) || s.slot_duration !== original.slot_duration || (minutes(a.time_slot) - minutes(s.start_time)) % s.slot_duration !== 0)));
    await db.prepare('UPDATE faculty_schedules SET day_of_week=?,start_time=?,end_time=?,slot_duration=?,specific_date=? WHERE id=?').run(s.day_of_week, s.start_time, s.end_time, s.slot_duration, s.specific_date, original.id);res.json({ ok: true });
  }));
  app.delete('/api/schedule/:id', auth, facultyOnly, atomic(async (req, res) => {
    const s = await db.prepare('SELECT * FROM faculty_schedules WHERE id=? AND faculty_id=?').get(req.params.id, req.user.id);if (!s) fail('Consultation hours not found', 404);
    requireResolved(await affected(req.user.id, (a) => fits(s, a.date, a.time_slot, a.end_time)));await db.prepare('DELETE FROM faculty_schedules WHERE id=?').run(s.id);res.json({ ok: true });
  }));
  app.get('/api/blocked-dates', auth, facultyOnly, route(async (req, res) => res.json(await db.prepare('SELECT * FROM blocked_dates WHERE faculty_id=? ORDER BY date,start_time').all(req.user.id))));
  app.post('/api/blocked-dates', auth, facultyOnly, atomic(async (req, res) => {
    const { date, reason = '' } = req.body,start = req.body.start_time || null,end = req.body.end_time || null;
    if (!validDate(date) || date < schoolDate() || typeof reason !== 'string' || reason.length > 500 || (start || end) && (!validTime(start) || !validTime(end) || start >= end || minutes(start) % 15 || minutes(end) % 15)) fail('Choose a valid date and time range (or all day), and a reason up to 500 characters');
    if ((await service.blocks(req.user.id, date)).some((b) => !start || !b.start_time || overlaps(start, end, b.start_time, b.end_time))) fail('This period overlaps an existing availability block', 409);
    requireResolved(await affected(req.user.id, (a) => a.date === date && (!start || overlaps(a.time_slot, a.end_time, start, end))));
    const id = Number((await db.prepare('INSERT INTO blocked_dates(faculty_id,date,reason,start_time,end_time) VALUES(?,?,?,?,?)').run(req.user.id, date, reason, start, end)).lastInsertRowid);res.status(201).json({ id });
  }));
  app.delete('/api/blocked-dates/:id', auth, facultyOnly, atomic(async (req, res) => {
    if (!(await db.prepare('DELETE FROM blocked_dates WHERE id=? AND faculty_id=?').run(req.params.id, req.user.id)).changes) fail('Availability block not found', 404);res.json({ ok: true });
  }));
  app.get('/api/admin/appointments', auth, admin, route(async (req, res) => {
    const q = req.query;let where = '1=1',params = [];
    for (const [key, column] of [['start_date', 'date'], ['end_date', 'date']]) if (q[key]) {if (!validDate(q[key])) fail('Choose valid report dates');where += ` AND a.${column}${key === 'start_date' ? '>=' : '<='}?`;params.push(q[key]);}
    if (q.start_date && q.end_date && q.start_date > q.end_date) fail('End date must follow start date');
    if (q.faculty_id && q.faculty_id !== 'all') {if (!/^\d+$/.test(q.faculty_id)) fail('Choose a valid faculty member');where += ' AND a.faculty_id=?';params.push(Number(q.faculty_id));}
    if (q.status) {if (!STATUSES.includes(q.status)) fail('Choose a valid status');where += ' AND a.status=?';params.push(q.status);}
    if (q.q) {if (typeof q.q !== 'string' || q.q.length > 100) fail('Search must be at most 100 characters');where += ' AND (s.name LIKE ? OR s.student_id LIKE ? OR f.name LIKE ? OR a.purpose LIKE ?)';params.push(...Array(4).fill('%' + q.q + '%'));}
    const join = ' FROM appointments a JOIN users s ON s.id=a.student_id JOIN users f ON f.id=a.faculty_id WHERE ' + where;
    const total = (await db.prepare('SELECT count(*) AS total' + join).get(...params)).total;
    const page = Math.max(1, Math.min(100000, Number.parseInt(q.page, 10) || 1)),pageSize = 25;
    const rows = await db.prepare('SELECT a.*,s.name AS student_name,s.student_id AS sid,s.course AS student_course,f.name AS faculty_name,f.department AS faculty_dept' + join + ' ORDER BY a.date DESC,a.time_slot DESC,a.id DESC LIMIT ? OFFSET ?').all(...params, pageSize, (page - 1) * pageSize);
    res.json({ appointments: rows, total, page, page_size: pageSize });
  }));
  // Give legacy demo bookings without passes a usable code; never rotate existing passes.
  await db.transaction(async () => {for (const a of await db.prepare("SELECT id FROM appointments WHERE checkin_code IS NULL AND status IN ('pending','approved')").all()) await db.prepare('UPDATE appointments SET checkin_code=? WHERE id=?').run(code(), a.id);})();
  const timer = setInterval(async () => {try {await service.reminders();} catch (e) {console.error('Reminder processing failed:', e.message);}}, 30000);timer.unref();
  await service.reminders();
  return { ...service, stop: () => clearInterval(timer) };
}
module.exports = { migrateScheduling, createSchedulingService, installScheduling, schoolDate, validDate, instant };
