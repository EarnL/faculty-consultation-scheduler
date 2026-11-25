// Arrival confirmation is separate from approval and consultation completion.
function checkinWindow(a, now = new Date()) {
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  const minutes = parts[0] * 60 + parts[1],toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  if (a.status === 'checked-in') return { eligible: false, already_checked_in: true, message: 'Already checked in. See the original arrival time below.' };
  if (a.status !== 'approved') return { eligible: false, message: 'Only approved appointments can be checked in.' };
  if (a.date !== date) return { eligible: false, message: 'Check-in is available only on the appointment date.' };
  if (minutes < toMin(a.time_slot) - 15) return { eligible: false, message: 'Check-in opens 15 minutes before the scheduled start.' };
  if (minutes >= toMin(a.end_time)) return { eligible: false, late: true, message: 'The scheduled time has ended. Faculty may confirm a late arrival with a reason.' };
  return { eligible: true, message: 'Ready for faculty confirmation.' };
}
function installCheckin({ app, db, auth, facultyOnly, scheduler, notify }) {
  const select = `SELECT a.*,u.name AS student_name,u.student_id AS student_number,u.course AS student_course,f.name AS faculty_name,f.consultation_location,f.meeting_link,f.consultation_instructions FROM appointments a JOIN users u ON u.id=a.student_id JOIN users f ON f.id=a.faculty_id`;
  const fail = (status, message) => {const err = new Error(message);err.status = status;throw err;};
  const route = (fn) => async (req, res) => {try {await fn(req, res);} catch (err) {if (!err.status) console.error(err);res.status(err.status || 500).json({ error: err.status ? err.message : 'Unable to process arrival confirmation.' });}};
  async function find(req) {
    const { code, appointment_id } = req.body;
    let a;
    if (appointment_id) {if (!Number.isSafeInteger(Number(appointment_id))) fail(400, 'Invalid appointment.');a = await db.prepare(select + ' WHERE a.id=? AND a.faculty_id=?').get(Number(appointment_id), req.user.id);} else
    {if (typeof code !== 'string' || !code.trim() || code.length > 100) fail(400, 'Enter or scan an appointment code.');a = await db.prepare(select + ' WHERE a.checkin_code=? COLLATE NOCASE AND a.faculty_id=?').get(code.trim(), req.user.id);}
    if (!a) fail(404, 'Appointment not found for your faculty account.');
    if (!(await db.prepare('SELECT id FROM users WHERE id=? AND is_active=1').get(a.student_id))) fail(409, 'The student account is inactive.');
    return a;
  }
  const publicDetails = (a) => ({ id: a.id, student_name: a.student_name, student_number: a.student_number, student_course: a.student_course, faculty_name: a.faculty_name, date: a.date, time_slot: a.time_slot, end_time: a.end_time, purpose: a.purpose, status: a.status, checkin_time: a.checkin_time, queue_number: a.queue_number, consultation_location: a.consultation_location, meeting_link: a.meeting_link, consultation_instructions: a.consultation_instructions });
  app.get('/api/appointments/:id/pass', auth, route(async (req, res) => {
    const a = await db.prepare(select + ' WHERE a.id=?').get(req.params.id);
    if (!a || !(req.user.role === 'student' && a.student_id === req.user.id || req.user.role === 'faculty' && a.faculty_id === req.user.id)) fail(404, 'Appointment pass not found.');
    if (!['approved', 'checked-in'].includes(a.status)) fail(409, 'A consultation pass is available only after faculty approval and before completion.');
    res.set('Cache-Control', 'no-store').json({ ...publicDetails(a), checkin_code: a.checkin_code, ...checkinWindow(a) });
  }));
  app.get('/api/checkin/search', auth, facultyOnly, route(async (req, res) => {
    const number = String(req.query.student_number || '').trim();if (!number || number.length > 30) fail(400, 'Enter a student number.');
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const rows = await db.prepare(select + " WHERE a.faculty_id=? AND u.student_id=? COLLATE NOCASE AND a.date=? AND a.status IN ('approved','checked-in') ORDER BY a.time_slot,a.id").all(req.user.id, number, date);
    res.set('Cache-Control', 'no-store').json(rows.map(publicDetails));
  }));
  app.post('/api/checkin/review', auth, facultyOnly, route(async (req, res) => {const a = await find(req);res.set('Cache-Control', 'no-store').json({ appointment: publicDetails(a), ...checkinWindow(a) });}));
  const confirm = db.transaction(async (req) => {
    const a = await find(req),window = checkinWindow(a);
    if (window.already_checked_in) return { ok: true, already_checked_in: true, message: window.message, appointment: publicDetails(a) };
    const lateReason = typeof req.body.late_reason === 'string' ? req.body.late_reason.trim() : '';
    if (!window.eligible && !(window.late && lateReason.length >= 5 && lateReason.length <= 500)) fail(409, window.message + (window.late ? ' Provide a reason of 5–500 characters.' : ''));
    const q = a.queue_number || (await db.prepare('SELECT coalesce(max(queue_number),0)+1 AS n FROM appointments WHERE faculty_id=? AND date=?').get(a.faculty_id, a.date)).n;
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Manila' });
    await db.prepare("UPDATE appointments SET status='checked-in',checkin_time=?,queue_number=?,queue_status='waiting',updated_at=? WHERE id=?").run(stamp, q, stamp, a.id);
    await scheduler.resolvePending(a.id);await scheduler.event(a.id, req.user.id, 'checked_in', { queue_number: q, method: req.body.appointment_id ? 'manual' : 'qr_or_code', ...(window.late ? { late_reason: lateReason } : {}) });
    await notify(a.student_id, 'Arrival Confirmed', `Your arrival for ${a.faculty_name} has been confirmed. Consultations follow the scheduled appointment order.`, 'success', a.id);
    return { ok: true, success: true, appointment: publicDetails(await db.prepare(select + ' WHERE a.id=?').get(a.id)), message: 'Arrival confirmed. Your scheduled appointment order is preserved.' };
  });
  app.post('/api/checkin', auth, facultyOnly, route(async (req, res) => res.json(await confirm.immediate(req))));
}
module.exports = { installCheckin, checkinWindow };
