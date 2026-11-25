require('express-async-errors');
// ============================================================
//  Faculty Consultation Hour Scheduler – Backend
//  Dalubhasaan ng Lungsod ng Lucena (DLL)
// ============================================================

const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { migrateAccounts, installAccounts } = require('./accounts');
const { migrateScheduling, installScheduling } = require('./scheduling');
process.env.TZ = 'Asia/Manila';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function bootstrap() {
  const app = express();
  if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
    throw new Error('Production requires a stable SESSION_SECRET of at least 32 characters.');
  }
  let publicOrigin = '';
  if (process.env.PUBLIC_URL) {
    const url = new URL(process.env.PUBLIC_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_URL must be an HTTPS origin, such as https://consult.example.edu.');
    publicOrigin = url.origin;
  }
  const PORT = process.env.PORT || 3000;
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'scheduler.db');
  let db, sessionDb;
  if (process.env.DATABASE_URL || process.env.PG_TEST_PATH) {
    db = await require('./storage').postgresAdapter({ connectionString: process.env.DATABASE_URL, testPath: process.env.PG_TEST_PATH });sessionDb = db;
  } else {
    if (process.env.RENDER === 'true') throw Error('Render requires DATABASE_URL for persistent PostgreSQL storage.');
    db = new Database(dbPath);require('./sqlite-schema')(db);
    sessionDb = new Database(process.env.SESSION_DB_PATH || path.join(__dirname, 'sessions.db'));
    await sessionDb.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL)');
  }
  class DatabaseSessionStore extends session.Store {
    async get(sid, cb) {try {const row = await sessionDb.prepare('SELECT data FROM sessions WHERE sid=? AND expires>?').get(sid, Date.now());cb(null, row ? JSON.parse(row.data) : null);} catch (e) {cb(e);}}
    async set(sid, data, cb = () => {}) {try {await sessionDb.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?)').run(sid, JSON.stringify(data), data.cookie.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 86400000);cb();} catch (e) {cb(e);}}
    async destroy(sid, cb = () => {}) {try {await sessionDb.prepare('DELETE FROM sessions WHERE sid=?').run(sid);cb();} catch (e) {cb(e);}}
  }
  const secretPath = path.join(__dirname, '.session-secret');
  if (!process.env.SESSION_SECRET && !fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  const sessionSecret = process.env.SESSION_SECRET || fs.readFileSync(secretPath, 'utf8').trim();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'loopback') app.set('trust proxy', 'loopback');
  // Only use 1 behind a single trusted proxy with no direct public app port.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/') || req.path === '/offline.html') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.path === '/sw.js' || req.path === '/' || req.path === '/index.html' || req.path === '/manifest.webmanifest') res.setHeader('Cache-Control', 'no-cache');
    const permittedOrigin = req.headers.origin === `${req.protocol}://${req.get('host')}` || publicOrigin && req.headers.origin === publicOrigin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && !permittedOrigin) return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    next();
  });

  // ── Middleware ───────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /offline.html\n${publicOrigin ? `Sitemap: ${publicOrigin}/sitemap.xml\n` : ''}`));
  app.get('/sitemap.xml', (req, res) => {
    if (!publicOrigin) return res.status(503).type('text/plain').send('The public site URL has not been configured.');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${publicOrigin.replace(/&/g, '&amp;').replace(/</g, '&lt;')}/</loc></url></urlset>`);
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(session({
    secret: sessionSecret,
    store: new DatabaseSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
  }));

  // ── Database ────────────────────────────────────────────────


  function schoolDate() {return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });}
  function validDate(value) {return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;}
  function validTime(value) {return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);}
  function minutes(value) {const [h, m] = value.split(':').map(Number);return h * 60 + m;}
  function validText(value, max) {return typeof value === 'string' && value.trim().length > 0 && value.length <= max;}


  async function notify(userId, title, message, type = 'info', relatedId = null) {
    await db.prepare(`INSERT INTO notifications (user_id,title,message,type,related_id) VALUES (?,?,?,?,?)`).
    run(userId, title, message, type, relatedId);
  }

  function safe(user) {
    if (!user) return null;
    const { password, ...rest } = user;
    if (!rest.email || rest.email.endsWith('@accounts.invalid')) rest.email = '';
    return rest;
  }

  // ── Seed Demo Data ──────────────────────────────────────────
  function seedNotify(userId, title, message, type, relatedId) {db.prepare("INSERT INTO notifications(user_id,title,message,type,related_id) VALUES(?,?,?,?,?)").run(userId, title, message, type, relatedId);}
  if (!db.kind) await db.transaction(function seed() {
    if (process.env.SEED_DEMO === 'false' || process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'true') return;
    const count = db.prepare('SELECT count(*) as c FROM users').get().c;
    if (count > 0) return; // already seeded

    const hash = bcrypt.hashSync('123456', 10);

    // Students
    const ins = db.prepare(`INSERT INTO users (email,password,name,role,department,course,student_id,avatar) VALUES (?,?,?,?,?,?,?,?)`);
    ins.run('student@dll.edu.ph', hash, 'Juan Dela Cruz', 'student', 'College of Computer Studies', 'BSCS-3A', '0000-0000', '');
    ins.run('mgarcia@dll.edu.ph', hash, 'Maria Garcia', 'student', 'College of Computer Studies', 'BSIT-2B', '2024-00456', '');
    ins.run('preyes@dll.edu.ph', hash, 'Pedro Reyes', 'student', 'College of Education', 'BSEd-4A', '2022-00789', '');

    // Faculty
    const insF = db.prepare(`INSERT INTO users (email,password,name,role,department,specialization,faculty_id,avatar) VALUES (?,?,?,?,?,?,?,?)`);
    insF.run('faculty@dll.edu.ph', hash, 'Prof. Niño Jayson Regio', 'faculty', 'Information Technology', 'Artificial Intelligence', 'FAC-001', '');
    insF.run('lmesiera.fac@dll.edu.ph', hash, 'Prof. Leonard Andrew De La Cruz Mesiera', 'faculty', 'Information Technology', 'Software Engineering & Web Development', 'FAC-006', '');
    insF.run('ajael.fac@dll.edu.ph', hash, 'Prof. Alvin Dimaano Jael', 'faculty', 'Information Technology', 'Database Systems & Information Management', 'FAC-007', '');
    insF.run('dfontanilla.fac@dll.edu.ph', hash, 'Prof. Darrel Ann Stephany Panganiban Fontanilla', 'faculty', 'Information Technology', 'Human-Computer Interaction & Systems Analysis', 'FAC-008', '');
    insF.run('jbalingbing.fac@dll.edu.ph', hash, 'Prof. John Rovie Romero Balingbing', 'faculty', 'Information Technology', 'Data Structures & Algorithms', 'FAC-009', '');
    insF.run('aborja.fac@dll.edu.ph', hash, 'Prof. Allysa Gene Jalbuena Borja', 'faculty', 'Information Technology', 'Artificial Intelligence & Machine Learning', 'FAC-010', '');
    insF.run('mdudas.fac@dll.edu.ph', hash, 'Prof. Mark Anthony Llego Dudas', 'faculty', 'Information Technology', 'Network Administration & Cybersecurity', 'FAC-011', '');
    insF.run('aborela.fac@dll.edu.ph', hash, 'Prof. Angelica Mae Villaflor Borela', 'faculty', 'Information Technology', 'Multimedia Arts & Graphic Design', 'FAC-012', '');
    insF.run('mmonzon.fac@dll.edu.ph', hash, 'Prof. Mike Angelo Ballaran Monzon', 'faculty', 'Information Technology', 'Operating Systems & Mobile App Development', 'FAC-013', '');

    // Faculty schedules  (day 1=Mon … 5=Fri)
    const insS = db.prepare(`INSERT INTO faculty_schedules (faculty_id,day_of_week,start_time,end_time) VALUES (?,?,?,?)`);
    // Prof. Santos – MWF 8-10, TTh 13-15
    [1, 3, 5].forEach((d) => insS.run(4, d, '08:00', '10:00'));
    [2, 4].forEach((d) => insS.run(4, d, '13:00', '15:00'));
    // Faculty Schedules
    [1, 3, 5].forEach((d) => insS.run(5, d, '08:00', '11:00'));
    [2, 4].forEach((d) => insS.run(6, d, '13:00', '16:00'));
    [1, 3].forEach((d) => insS.run(7, d, '09:00', '12:00'));
    [2, 4, 5].forEach((d) => insS.run(8, d, '10:00', '13:00'));
    [1, 4].forEach((d) => insS.run(9, d, '13:00', '16:00'));
    [2, 3, 5].forEach((d) => insS.run(10, d, '08:00', '11:00'));
    [1, 2, 4].forEach((d) => insS.run(11, d, '14:00', '17:00'));
    [3, 5].forEach((d) => insS.run(12, d, '09:00', '12:00'));

    // Sample appointments
    const insA = db.prepare(`INSERT INTO appointments (student_id,faculty_id,date,time_slot,end_time,purpose,remarks,status) VALUES (?,?,?,?,?,?,?,?)`);
    insA.run(1, 4, '2026-11-23', '08:00', '08:15', 'Capstone project guidance', 'Need help with system design', 'approved');
    insA.run(1, 5, '2026-11-24', '10:00', '10:15', 'Statistics homework clarification', '', 'pending');
    insA.run(2, 4, '2026-11-23', '08:15', '08:30', 'Thesis proposal discussion', '', 'approved');
    insA.run(3, 6, '2026-11-25', '08:00', '08:15', 'Essay feedback review', '', 'completed');
    insA.run(1, 7, '2026-11-26', '13:00', '13:15', 'Network security lab questions', '', 'pending');

    for (const a of db.prepare("SELECT a.*,f.name AS faculty_name FROM appointments a JOIN users f ON f.id=a.faculty_id").all()) {
      if (a.status === 'approved') seedNotify(a.student_id, 'Appointment Approved', `Your consultation with ${a.faculty_name} on ${a.date} at ${a.time_slot} has been approved.`, 'success', a.id);
      if (a.status === 'pending') seedNotify(a.student_id, 'Request Submitted', `Your consultation with ${a.faculty_name} is pending approval.`, 'info', a.id);
    }

    console.log('✓ Demo data seeded');
  })();
  if (!db.kind) {db = require('./storage').sqliteAdapter(db);sessionDb = require('./storage').sqliteAdapter(sessionDb);}


  // ── Auth Middleware ──────────────────────────────────────────
  await db.exec("INSERT OR IGNORE INTO departments(name) SELECT DISTINCT trim(department) FROM users WHERE department IS NOT NULL AND trim(department)!=''");

  async function auth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    req.user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    if (!req.user.is_active) {req.session.destroy(() => {});return res.status(403).json({ error: 'This account is deactivated. Please contact an administrator.' });}
    next();
  }
  function facultyOnly(req, res, next) {
    if (req.user.role !== 'faculty') return res.status(403).json({ error: 'Faculty only' });
    next();
  }

  // ════════════════════════════════════════════════════════════
  //  ROUTES
  // ════════════════════════════════════════════════════════════

  // ── Auth ────────────────────────────────────────────────────
  const loginAttempts = new Map();
  const cleanupTimer = setInterval(async () => {const now = Date.now();for (const [key, value] of loginAttempts) if (value.until < now) loginAttempts.delete(key);try {await sessionDb.prepare('DELETE FROM sessions WHERE expires<?').run(now);} catch {console.error('Session cleanup will retry on the next interval.');}}, 60000);
  cleanupTimer.unref();
  const scheduler = await installScheduling({ app, db, auth, facultyOnly, notify });
  require(db.kind === 'postgres' ? './postgres-backups' : './backups').installBackups({ app, db, dbPath, auth });

  app.post('/api/login', async (req, res) => {
    const key = req.ip;
    const previous = loginAttempts.get(key);
    const attempt = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 15 * 60000 };
    if (attempt.count >= 30) {res.setHeader('Retry-After', Math.ceil((attempt.until - Date.now()) / 1000));return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });}
    attempt.count++;loginAttempts.set(key, attempt);
    if (typeof req.body.email !== 'string' || typeof req.body.password !== 'string' || req.body.email.length > 254 || Buffer.byteLength(req.body.password) > 72) return res.status(400).json({ error: 'Enter a valid login and password' });
    const { email, password, role } = req.body;
    const currentRole = ['student', 'faculty', 'admin'].includes(role) ? role : 'student';

    const invalidMsg = currentRole === 'student' ?
    'Invalid student credentials. Please check your Student ID/email and password.' :
    currentRole === 'admin' ? 'Invalid administrator username or password.' : 'Invalid faculty credentials. Please check your Faculty ID/email and password.';

    if (!email || !String(email).trim() || !password || !String(password).trim()) {
      const emptyMsg = currentRole === 'student' ?
      'Please enter your Student ID/email and password.' :
      'Please enter your Faculty ID/email and password.';
      return res.status(400).json({ error: emptyMsg });
    }

    const rawInput = String(email).trim();
    const inputVal = rawInput.toLowerCase();
    const strippedVal = inputVal.replace(/@dll\.edu\.ph$/i, '').replace(/@.*$/, '');
    const withDomain = strippedVal + '@dll.edu.ph';

    // Find user by email, student_id, or faculty_id strictly within the requested role
    const sql = `
    SELECT * FROM users 
    WHERE role = ? AND (
      lower(email) = ? OR 
      lower(email) = ? OR 
      lower(coalesce(student_id, '')) = ? OR 
      lower(coalesce(student_id, '')) = ? OR 
      lower(coalesce(faculty_id, '')) = ? OR 
      lower(coalesce(faculty_id, '')) = ?
    )
  `;
    const params = [currentRole, inputVal, withDomain, inputVal, strippedVal, inputVal, strippedVal];
    const user = await db.prepare(sql).get(...params);

    // Use the same credential error for unavailable accounts.
    if (!user || !user.is_active) {
      return res.status(401).json({ error: invalidMsg });
    }

    const isMatch = typeof password === 'string' && bcrypt.compareSync(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: invalidMsg });
    }

    if (user.role !== currentRole) {
      return res.status(401).json({ error: invalidMsg });
    }

    loginAttempts.delete(key);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Unable to create session' });
      req.session.userId = user.id;
      req.session.save((err) => err ? res.status(500).json({ error: 'Unable to save session' }) : res.json({ user: safe(user) }));
    });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {res.clearCookie('connect.sid');res.json({ ok: true });});
  });

  app.get('/api/me', auth, (req, res) => {
    res.json({ user: safe(req.user) });
  });

  // ── Faculty list ────────────────────────────────────────────
  app.get('/api/faculty', auth, async (req, res) => {
    const rows = await db.prepare(`SELECT id,name,department,specialization,faculty_id,avatar,consultation_location,meeting_link,consultation_instructions FROM users WHERE role='faculty' AND is_active=1`).all();
    // attach schedule summaries
    const schedStmt = db.prepare(`SELECT day_of_week,start_time,end_time,slot_duration,specific_date FROM faculty_schedules WHERE faculty_id=? AND is_available=1 ORDER BY day_of_week,start_time`);
    for (const faculty of rows) faculty.schedules = await schedStmt.all(faculty.id);
    res.json(rows);
  });

  app.get('/api/faculty/:id', auth, async (req, res) => {
    const fac = await db.prepare(`SELECT id,name,department,specialization,faculty_id,avatar,email,consultation_location,meeting_link,consultation_instructions FROM users WHERE id=? AND role='faculty' AND is_active=1`).get(req.params.id);
    if (!fac) return res.status(404).json({ error: 'Faculty not found' });
    fac.schedules = await db.prepare(`SELECT * FROM faculty_schedules WHERE faculty_id=? AND is_available=1 ORDER BY day_of_week,start_time`).all(fac.id);
    fac.blocked = await db.prepare(`SELECT date,reason,start_time,end_time FROM blocked_dates WHERE faculty_id=?`).all(fac.id);
    res.json(fac);
  });

  // Available slots for a specific faculty + date
  app.get('/api/appointments', auth, async (req, res) => {
    let rows;
    if (req.user.role === 'student') {
      rows = await db.prepare(`
      SELECT a.*, u.name as faculty_name, u.department as faculty_dept, u.avatar as faculty_avatar
      FROM appointments a JOIN users u ON u.id = a.faculty_id
      WHERE a.student_id = ? ORDER BY a.date DESC, a.time_slot DESC
    `).all(req.user.id);
    } else {
      rows = await db.prepare(`
      SELECT a.*, u.name as student_name, u.course as student_course, u.student_id as sid, u.avatar as student_avatar
      FROM appointments a JOIN users u ON u.id = a.student_id
      WHERE a.faculty_id = ? ORDER BY a.date DESC, a.time_slot DESC
    `).all(req.user.id);
    }
    const venues = new Map((await db.prepare("SELECT id,consultation_location,meeting_link,consultation_instructions FROM users WHERE role='faculty'").all()).map(({ id, ...details }) => [id, details]));
    rows.forEach((a) => Object.assign(a, venues.get(a.faculty_id)));
    res.json(rows);
  });

  app.get('/api/notifications', auth, async (req, res) => {
    await scheduler.reminders();
    const rows = await db.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(req.user.id);
    const unread = (await db.prepare(`SELECT count(*) as c FROM notifications WHERE user_id=? AND is_read=0`).get(req.user.id)).c;
    res.json({ notifications: rows, unread });
  });

  app.put('/api/notifications/:id/read', auth, async (req, res) => {
    await db.prepare(`UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?`).run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  app.put('/api/notifications/read-all', auth, async (req, res) => {
    await db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=?`).run(req.user.id);
    res.json({ ok: true });
  });

  // ── Profile ─────────────────────────────────────────────────
  app.get('/api/profile', auth, (req, res) => {
    res.json(safe(req.user));
  });

  app.put('/api/profile', auth, require("./transaction-response")(db, async (req, res) => {
    const { name, department, course, specialization, avatar } = req.body;
    const { contact_number, contact_email } = req.body;
    const venueFields = ['consultation_location', 'meeting_link', 'consultation_instructions'];
    if (venueFields.some((k) => req.body[k] !== undefined)) {
      if (req.user.role !== 'faculty') return res.status(403).json({ error: 'Only faculty can update consultation instructions.' });
      for (const key of venueFields) if (req.body[key] !== undefined && (typeof req.body[key] !== 'string' || req.body[key].length > (key === 'consultation_location' ? 200 : 1000))) return res.status(400).json({ error: 'Invalid consultation details.' });
      if (req.body.meeting_link?.trim()) {try {if (new URL(req.body.meeting_link.trim()).protocol !== 'https:') throw Error();} catch {return res.status(400).json({ error: 'Use a valid HTTPS meeting link, or leave it blank.' });}}
    }

    if (contact_number !== undefined && (typeof contact_number !== 'string' || contact_number.length > 30 || contact_number.trim() && (!/^[+\d\s()\-]+$/.test(contact_number) || contact_number.replace(/\D/g, '').length < 7 || contact_number.replace(/\D/g, '').length > 15))) return res.status(400).json({ error: 'Enter a valid contact number with 7–15 digits, or leave it blank.' });
    if (contact_email !== undefined && (typeof contact_email !== 'string' || contact_email.length > 254 || contact_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email.trim()))) return res.status(400).json({ error: 'Enter a valid contact email, or leave it blank.' });
    for (const key of ['name', 'department', 'course', 'specialization']) if (req.body[key] !== undefined && (typeof req.body[key] !== 'string' || req.body[key].length > 200 || key === 'name' && !req.body[key].trim())) return res.status(400).json({ error: 'Invalid profile field: ' + key });
    if (department && !(await db.prepare('SELECT id FROM departments WHERE name=?').get(department.trim()))) return res.status(400).json({ error: 'Choose an existing department' });
    if (avatar !== undefined && (typeof avatar !== 'string' || avatar.length > 2000000 || avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) && avatar !== '/images/default-avatar.png')) return res.status(400).json({ error: 'Please upload a PNG, JPEG, or WebP profile image' });
    if (avatar !== undefined) {
      await db.prepare(`UPDATE users SET name=coalesce(?,name), department=coalesce(?,department), course=coalesce(?,course), specialization=coalesce(?,specialization), avatar=? WHERE id=?`).
      run(name || null, department?.trim() ?? null, course || null, specialization || null, avatar || '', req.user.id);
    } else {
      await db.prepare(`UPDATE users SET name=coalesce(?,name), department=coalesce(?,department), course=coalesce(?,course), specialization=coalesce(?,specialization) WHERE id=?`).
      run(name || null, department?.trim() ?? null, course || null, specialization || null, req.user.id);
    }
    await db.prepare('UPDATE users SET contact_number=coalesce(?,contact_number),contact_email=coalesce(?,contact_email) WHERE id=?').run(contact_number?.trim() ?? null, contact_email?.trim() ?? null, req.user.id);

    if (venueFields.some((k) => req.body[k] !== undefined)) {
      const changed = venueFields.some((k) => req.body[k] !== undefined && req.body[k].trim() !== (req.user[k] || ''));
      await db.prepare('UPDATE users SET consultation_location=coalesce(?,consultation_location),meeting_link=coalesce(?,meeting_link),consultation_instructions=coalesce(?,consultation_instructions) WHERE id=?').run(...venueFields.map((k) => req.body[k]?.trim() ?? null), req.user.id);
      if (changed) for (const a of await db.prepare("SELECT id,student_id FROM appointments WHERE faculty_id=? AND date>=? AND status IN ('pending','approved','checked-in')").all(req.user.id, schoolDate())) {await notify(a.student_id, 'Consultation instructions updated', `${req.user.name} updated their consultation location or meeting instructions. Open your appointment for current details.`, 'info', a.id);await scheduler.event(a.id, req.user.id, 'instructions_updated');}
    }
    res.json({ ok: true, user: safe(await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
  }));

  app.put('/api/profile/password', auth, require("./transaction-response")(db, async (req, res) => {
    const { current_password, new_password } = req.body;
    if (typeof current_password !== 'string' || typeof new_password !== 'string' || new_password.length < 8 || Buffer.byteLength(new_password) > 72) return res.status(400).json({ error: 'Current password is required; new password must be at least 8 characters and at most 72 bytes' });
    if (!bcrypt.compareSync(current_password, req.user.password))
    return res.status(400).json({ error: 'Current password is incorrect' });
    await db.prepare(`UPDATE users SET password=? WHERE id=?`).run(bcrypt.hashSync(new_password, 10), req.user.id);
    await sessionDb.prepare("DELETE FROM sessions WHERE json_extract(data,'$.userId')=? AND sid!=?").run(req.user.id, req.sessionID);
    res.json({ ok: true });
  }));

  // ── Faculty Students Directory ──────────────────────────────
  app.get('/api/students', auth, facultyOnly, async (req, res) => {
    const facId = req.user.id;
    const students = await db.prepare(`
    SELECT 
      u.id,
      u.name,
      u.email,
      u.student_id as sid,
      u.course,
      u.department,
      u.avatar,
      COUNT(a.id) as total_consultations,
      MAX(a.date) as last_consultation_date
    FROM users u
    JOIN appointments a ON a.student_id = u.id
    WHERE a.faculty_id = ?
    GROUP BY u.id
    ORDER BY last_consultation_date DESC, u.name ASC
  `).all(facId);

    const apptStmt = db.prepare(`
    SELECT a.*, u.name as faculty_name, u.department as faculty_dept
    FROM appointments a
    JOIN users u ON u.id = a.faculty_id
    WHERE a.faculty_id = ? AND a.student_id = ?
    ORDER BY a.date DESC, a.time_slot DESC
  `);

    await Promise.all(students.map(async (s) => {
      s.appointments = await apptStmt.all(facId, s.id);
      const latest = s.appointments[0];
      s.last_status = latest ? latest.status : 'none';
      s.last_time_slot = latest ? latest.time_slot : '';
      s.last_purpose = latest ? latest.purpose : '';
      s.upcoming_count = s.appointments.filter((a) => a.status === 'approved' || a.status === 'checked-in').length;
      s.completed_count = s.appointments.filter((a) => a.status === 'completed').length;
      s.pending_count = s.appointments.filter((a) => a.status === 'pending').length;
      s.cancelled_count = s.appointments.filter((a) => a.status === 'cancelled' || a.status === 'rejected').length;
    }));

    res.json(students);
  });

  app.get('/api/students/:id', auth, facultyOnly, async (req, res) => {
    const facId = req.user.id;
    const studentId = Number(req.params.id);
    const student = await db.prepare(`
    SELECT id, name, email, student_id as sid, course, department, avatar
    FROM users
    WHERE id = ? AND role = 'student'
  `).get(studentId);

    if (!student || !(await db.prepare('SELECT id FROM appointments WHERE faculty_id=? AND student_id=?').get(facId, studentId))) return res.status(404).json({ error: 'Student not found' });

    student.appointments = await db.prepare(`
    SELECT a.*, u.name as faculty_name, u.department as faculty_dept
    FROM appointments a
    JOIN users u ON u.id = a.faculty_id
    WHERE a.faculty_id = ? AND a.student_id = ?
    ORDER BY a.date DESC, a.time_slot DESC
  `).all(facId, studentId);

    student.total_consultations = student.appointments.length;
    student.last_consultation_date = student.appointments[0] ? student.appointments[0].date : null;
    student.last_status = student.appointments[0] ? student.appointments[0].status : null;

    res.json(student);
  });

  // ── Faculty Schedule Management ─────────────────────────────
  app.get('/api/stats', auth, async (req, res) => {
    const today = schoolDate();
    if (req.user.role === 'student') {
      const upcoming = (await db.prepare(`SELECT count(*) as c FROM appointments WHERE student_id=? AND status='approved'  AND date>=?`).get(req.user.id, today)).c;
      const pending = (await db.prepare(`SELECT count(*) as c FROM appointments WHERE student_id=? AND status='pending'`).get(req.user.id)).c;
      const approved = (await db.prepare(`SELECT count(*) as c FROM appointments WHERE student_id=? AND status='approved'`).get(req.user.id)).c;
      const completed = (await db.prepare(`SELECT count(*) as c FROM appointments WHERE student_id=? AND status='completed'`).get(req.user.id)).c;
      res.json({ upcoming, pending, approved, completed });
    } else {
      const today_appts = (await db.prepare(`SELECT count(*) as c FROM appointments WHERE faculty_id=? AND date=? AND status='approved'`).get(req.user.id, today)).c;
      const pending = (await db.prepare(`SELECT count(*) as c FROM appointments WHERE faculty_id=? AND status='pending'`).get(req.user.id)).c;
      const upcoming = (await db.prepare(`SELECT count(*) as c FROM appointments WHERE faculty_id=? AND status='approved' AND date>=?`).get(req.user.id, today)).c;
      const completed = (await db.prepare(`SELECT count(*) as c FROM appointments WHERE faculty_id=? AND status='completed'`).get(req.user.id)).c;
      const students = (await db.prepare(`SELECT count(DISTINCT student_id) as c FROM appointments WHERE faculty_id=?`).get(req.user.id)).c;
      res.json({ today: today_appts, pending, upcoming, completed, students });
    }
  });

  // ── Virtual Consultation Queue ──────────────────────────────
  app.get('/api/queue', auth, async (req, res) => {
    const today = req.query.date || schoolDate();

    if (req.user.role === 'student') {
      // Return student's active or upcoming appointments
      const studentAppts = await db.prepare(`
      SELECT a.*, u.name as faculty_name, u.department as faculty_dept, u.avatar as faculty_avatar
      FROM appointments a JOIN users u ON u.id = a.faculty_id
      WHERE a.student_id = ? AND (a.date >= ? OR (a.checkin_time IS NOT NULL AND substr(a.checkin_time, 1, 10) = ?))
        AND a.status IN ('approved', 'checked-in', 'completed')
      ORDER BY 
        CASE a.queue_status WHEN 'serving' THEN 1 WHEN 'next' THEN 2 WHEN 'waiting' THEN 3 ELSE 4 END,
        a.date ASC, a.time_slot ASC
    `).all(req.user.id, today, today);

      // Identify student's active appointment for today
      const activeAppt = studentAppts.find((a) =>
      a.status === 'checked-in' && (
      a.date === today || a.checkin_time && a.checkin_time.startsWith(today))
      ) || studentAppts.find((a) => a.date === today && a.status === 'approved') || null;

      let myTurn = null;
      if (activeAppt) {
        // Find today's queue for this faculty
        const facQueue = await db.prepare(`
        SELECT id, queue_number, queue_status, status, time_slot, checkin_time
        FROM appointments
        WHERE faculty_id = ? AND (date = ? OR (checkin_time IS NOT NULL AND substr(checkin_time, 1, 10) = ?))
          AND status = 'checked-in' AND queue_status != 'skipped'
        ORDER BY 
          CASE queue_status WHEN 'serving' THEN 1 WHEN 'next' THEN 2 WHEN 'waiting' THEN 3 ELSE 4 END,
          time_slot ASC, id ASC
      `).all(activeAppt.faculty_id, today, today);

        const serving = facQueue.find((q) => q.queue_status === 'serving');
        const myIdx = facQueue.findIndex((q) => q.id === activeAppt.id);
        const ahead = myIdx > 0 ? myIdx : 0;
        const waitMin = activeAppt.queue_status === 'serving' ? 0 : ahead * 15;

        // Determine display status for student (Waiting, Next in Line, Currently Being Served, Completed)
        let effectiveStatus = activeAppt.queue_status || 'waiting';
        if (activeAppt.queue_status === 'serving') {
          effectiveStatus = 'serving';
        } else if (activeAppt.queue_status === 'completed' || activeAppt.status === 'completed') {
          effectiveStatus = 'completed';
        } else if (activeAppt.status === 'checked-in' && activeAppt.queue_status !== 'skipped') {
          if (!serving && myIdx === 0) {
            effectiveStatus = 'next';
          } else if (serving && myIdx === 1) {
            effectiveStatus = 'next';
          } else {
            effectiveStatus = 'waiting';
          }
        }

        myTurn = {
          ...activeAppt,
          queue_status: effectiveStatus,
          students_ahead: ahead,
          estimated_wait_minutes: waitMin,
          serving_student_num: serving ? serving.queue_number : null
        };
      }

      const otherAppts = studentAppts.filter((a) => !activeAppt || a.id !== activeAppt.id);

      return res.json({
        role: 'student',
        has_appointment: Boolean(activeAppt),
        my_turn: myTurn,
        history: otherAppts,
        queue: studentAppts
      });
    }

    // Faculty perspective:
    const queueList = await db.prepare(`
    SELECT a.*, u.name as student_name, u.course as student_course, u.student_id as sid, u.email as student_email, u.avatar as student_avatar
    FROM appointments a JOIN users u ON u.id = a.student_id
    WHERE a.faculty_id = ? AND (a.date = ? OR (a.checkin_time IS NOT NULL AND substr(a.checkin_time, 1, 10) = ?))
      AND (a.status = 'checked-in' OR a.status = 'completed')
    ORDER BY 
      CASE a.queue_status 
        WHEN 'serving' THEN 1 
        WHEN 'next' THEN 2 
        WHEN 'waiting' THEN 3 
        WHEN 'skipped' THEN 4 
        WHEN 'completed' THEN 5 
        ELSE 6 
      END,
      a.time_slot ASC, a.id ASC
  `).all(req.user.id, today, today);

    const currentlyServing = queueList.find((q) => q.queue_status === 'serving' && q.status !== 'completed') || null;

    // Next in line:
    let nextInLine = queueList.find((q) => q.queue_status === 'next' && q.status !== 'completed');
    if (!nextInLine) {
      nextInLine = queueList.find((q) => q.queue_status === 'waiting' && q.status !== 'completed' && q.id !== currentlyServing?.id) || null;
    }

    const waitingQueue = queueList.filter((q) =>
    q.status !== 'completed' &&
    q.queue_status !== 'completed' && q.queue_status !== 'skipped' &&
    q.id !== currentlyServing?.id
    );

    const completedQueue = queueList.filter((q) => q.queue_status === 'completed' || q.status === 'completed');

    const summary = {
      serving: currentlyServing ? 1 : 0,
      waiting: waitingQueue.length,
      completed: completedQueue.length,
      total: queueList.length
    };

    res.json({
      role: 'faculty',
      date: today,
      serving: currentlyServing,
      currently_serving: currentlyServing,
      next: nextInLine,
      next_in_line: nextInLine,
      queue: queueList,
      waiting_queue: waitingQueue,
      completed_queue: completedQueue,
      summary
    });
  });

  app.put('/api/queue/:id', auth, facultyOnly, require("./transaction-response")(db, async (req, res) => {
    const appt = await db.prepare('SELECT * FROM appointments WHERE id=?').get(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    if (appt.faculty_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { action } = req.body; // 'start', 'next', 'complete', 'skip', 'recall'
    if (!['start', 'complete', 'skip', 'recall'].includes(action)) return res.status(400).json({ error: 'Invalid queue action' });
    if (appt.date !== schoolDate() || appt.status !== 'checked-in') return res.status(409).json({ error: 'Only students checked in today can be managed in the queue' });
    if (action === 'complete' && appt.queue_status !== 'serving') return res.status(409).json({ error: 'Start the consultation before completing it' });
    if (action === 'recall' && appt.queue_status !== 'skipped') return res.status(409).json({ error: 'Only skipped students can be recalled' });
    if (action === 'start' && appt.queue_status === 'skipped') return res.status(409).json({ error: 'Recall this student before starting' });
    const facName = req.user.name;

    if (action === 'start') {
      if (await db.prepare("SELECT id FROM appointments WHERE faculty_id=? AND date=? AND queue_status='serving' AND status='checked-in' AND id!=?").get(req.user.id, schoolDate(), appt.id)) return res.status(409).json({ error: 'Complete or skip the current consultation before starting another' });

      await db.prepare(`
      UPDATE appointments 
      SET queue_status='serving', status='checked-in', updated_at=datetime('now','localtime') 
      WHERE id=?
    `).run(appt.id);

      await notify(appt.student_id, 'Now Being Served',
      `Prof. ${facName} is now ready for your consultation! Please proceed to the room.`, 'success', appt.id);

    } else if (action === 'complete') {
      await db.prepare(`
      UPDATE appointments 
      SET queue_status='completed', status='completed', updated_at=datetime('now','localtime') 
      WHERE id=?
    `).run(appt.id);

      await notify(appt.student_id, 'Consultation Completed',
      `Your consultation with Prof. ${facName} has concluded. Thank you!`, 'success', appt.id);

      // Notify next waiting student
      const today = schoolDate();
      const nextWaiting = await db.prepare(`
      SELECT a.*, u.name as student_name FROM appointments a
      JOIN users u ON u.id = a.student_id
      WHERE a.faculty_id = ? AND (a.date = ? OR (a.checkin_time IS NOT NULL AND substr(a.checkin_time, 1, 10) = ?))
        AND a.status = 'checked-in' AND a.queue_status = 'waiting'
      ORDER BY a.time_slot ASC, a.id ASC
      LIMIT 1
    `).get(req.user.id, today, today);

      if (nextWaiting) {
        await notify(nextWaiting.student_id, 'Next in Line',
        `You are next in line for consultation with Prof. ${facName}. Please prepare your materials and standby.`, 'info', nextWaiting.id);
      }

    } else if (action === 'skip') {
      await db.prepare(`
      UPDATE appointments 
      SET queue_status='skipped', updated_at=datetime('now','localtime') 
      WHERE id=?
    `).run(appt.id);

      await notify(appt.student_id, 'Turn Skipped',
      `You were temporarily skipped in the queue for Prof. ${facName}. Please approach your professor.`, 'warning', appt.id);

    } else if (action === 'recall') {
      await db.prepare(`
      UPDATE appointments 
      SET queue_status='waiting', updated_at=datetime('now','localtime') 
      WHERE id=?
    `).run(appt.id);

      await notify(appt.student_id, 'Recalled to Queue',
      `You have been returned to the active consultation queue for Prof. ${facName}.`, 'info', appt.id);
    }

    if (action === 'complete') await scheduler.resolvePending(appt.id);
    await scheduler.event(appt.id, req.user.id, 'queue_' + action);
    res.json({ ok: true, success: true, message: `Queue action ${action} performed.` });
  }));

  // ── QR Code Appointment Check-In ────────────────────────────
  require('./checkin').installCheckin({ app, db, auth, facultyOnly, scheduler, notify });

  app.get('/api/analytics', auth, async (req, res) => {
    const start_date = req.query.start_date || req.query.startDate;
    const end_date = req.query.end_date || req.query.endDate;
    const faculty_id = req.query.faculty_id || req.query.facultyId;
    const status = req.query.status;
    if (start_date && !validDate(start_date) || end_date && !validDate(end_date) || start_date && end_date && start_date > end_date || faculty_id && !['all', 'my'].includes(faculty_id) && !/^[1-9]\d*$/.test(faculty_id)) return res.status(400).json({ error: 'Invalid report filters' });

    let query = `
    SELECT a.*, u.name as faculty_name, u.department as faculty_dept, s.name as student_name, s.course as student_course
    FROM appointments a
    JOIN users u ON u.id = a.faculty_id
    JOIN users s ON s.id = a.student_id
    WHERE 1=1
  `;
    const params = [];

    if (req.user.role !== 'admin') {
      query += req.user.role === 'faculty' ? ' AND a.faculty_id = ?' : ' AND a.student_id = ?';
      params.push(req.user.id);
    }

    if (faculty_id && !['all', 'my'].includes(faculty_id)) {
      query += ` AND a.faculty_id = ?`;
      params.push(Number(faculty_id));
    } else if (req.user.role === 'faculty' && (!faculty_id || faculty_id === 'my')) {
      query += ` AND a.faculty_id = ?`;
      params.push(req.user.id);
    }

    if (start_date) {
      query += ` AND a.date >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND a.date <= ?`;
      params.push(end_date);
    }
    if (status) {
      query += ` AND a.status = ?`;
      params.push(status);
    }

    if (req.query.q) {
      if (typeof req.query.q !== 'string' || req.query.q.length > 100) return res.status(400).json({ error: 'Search must be at most 100 characters' });
      query += ' AND (s.name LIKE ? OR s.student_id LIKE ? OR u.name LIKE ? OR a.purpose LIKE ?)';
      params.push(...Array(4).fill('%' + req.query.q + '%'));
    }
    query += ` ORDER BY a.date DESC, a.time_slot DESC`;

    const rows = await db.prepare(query).all(...params);

    // Aggregations
    const total = rows.length;
    const completed = rows.filter((r) => r.status === 'completed').length;
    const pending = rows.filter((r) => r.status === 'pending').length;
    const approved = rows.filter((r) => r.status === 'approved').length;
    const checked_in = rows.filter((r) => r.status === 'checked-in').length;
    const rejected = rows.filter((r) => r.status === 'rejected').length;
    const noShow = rows.filter((r) => r.status === 'no-show').length;
    const cancelled = rows.filter((r) => r.status === 'cancelled').length;

    const kpis = {
      total,
      completed,
      pending,
      approved,
      checked_in,
      rejected,
      no_show: noShow,
      cancelled,
      completion_rate: total > 0 ? Math.round(completed / total * 100) : 0
    };

    // Include every appointment status in summaries and exports.
    const statusDistribution = [
    { status: 'cancelled', count: cancelled, percentage: total > 0 ? Math.round(cancelled / total * 100) : 0 },
    { status: 'completed', count: completed, percentage: total > 0 ? Math.round(completed / total * 100) : 0 },
    { status: 'approved', count: approved, percentage: total > 0 ? Math.round(approved / total * 100) : 0 },
    { status: 'checked-in', count: checked_in, percentage: total > 0 ? Math.round(checked_in / total * 100) : 0 },
    { status: 'pending', count: pending, percentage: total > 0 ? Math.round(pending / total * 100) : 0 },
    { status: 'rejected', count: rejected, percentage: total > 0 ? Math.round(rejected / total * 100) : 0 },
    { status: 'no-show', count: noShow, percentage: total > 0 ? Math.round(noShow / total * 100) : 0 }];


    // Popular time slots
    const slotMap = {};
    rows.forEach((r) => {
      slotMap[r.time_slot] = (slotMap[r.time_slot] || 0) + 1;
    });
    const popularSlots = Object.entries(slotMap).
    map(([time_slot, count]) => ({ time_slot, slot: time_slot, count })).
    sort((a, b) => b.count - a.count).
    slice(0, 8);

    // Day of week stats (Mon-Fri)
    const dowOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const dowMap = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 };
    rows.forEach((r) => {
      const d = new Date(r.date + 'T00:00:00').getDay();
      const name = DAYS_SHORT[d] || 'Other';
      if (dowMap[name] !== undefined) dowMap[name]++;
    });
    const weeklyStats = dowOrder.map((day_name) => ({
      day_name,
      count: dowMap[day_name] || 0
    }));

    // Monthly stats (grouped by YYYY-MM)
    const monthMap = {};
    rows.forEach((r) => {
      const m = r.date.slice(0, 7);
      monthMap[m] = (monthMap[m] || 0) + 1;
    });
    const monthlyStats = Object.entries(monthMap).
    map(([month, count]) => {
      let label = month;
      try {
        const [y, mo] = month.split('-');
        const dateObj = new Date(Number(y), Number(mo) - 1, 1);
        label = dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      } catch (e) {}
      return { month, label, count };
    }).
    sort((a, b) => a.month.localeCompare(b.month));

    const facultyList = await db.prepare("SELECT id, name, department, specialization FROM users WHERE role='faculty' AND (?!='faculty' OR id=?)").all(req.user.role, req.user.id);

    res.json({
      kpis,
      summary: kpis,
      status_distribution: statusDistribution,
      popular_slots: popularSlots,
      popular_time_slots: popularSlots,
      weekly_stats: weeklyStats,
      weekly_distribution: weeklyStats,
      monthly_stats: monthlyStats,
      monthly_statistics: monthlyStats,
      faculty_list: facultyList,
      appointments: rows
    });
  });

  // CSV Export endpoint
  app.get('/api/analytics/export', auth, async (req, res) => {
    const start_date = req.query.start_date || req.query.startDate;
    const end_date = req.query.end_date || req.query.endDate;
    const faculty_id = req.query.faculty_id || req.query.facultyId;
    const status = req.query.status;
    if (start_date && !validDate(start_date) || end_date && !validDate(end_date) || start_date && end_date && start_date > end_date || faculty_id && !['all', 'my'].includes(faculty_id) && !/^[1-9]\d*$/.test(faculty_id)) return res.status(400).json({ error: 'Invalid report filters' });

    let query = `
    SELECT a.id, a.date, a.time_slot, a.end_time, a.status, a.purpose, a.remarks, a.faculty_remarks, a.checkin_code, a.checkin_time, a.queue_number,
           u.name as faculty_name, u.department as faculty_dept, s.name as student_name, s.course as student_course, s.student_id as sid
    FROM appointments a
    JOIN users u ON u.id = a.faculty_id
    JOIN users s ON s.id = a.student_id
    WHERE 1=1
  `;
    const params = [];

    if (req.user.role !== 'admin') {
      query += req.user.role === 'faculty' ? ' AND a.faculty_id = ?' : ' AND a.student_id = ?';
      params.push(req.user.id);
    }

    if (faculty_id && !['all', 'my'].includes(faculty_id)) {
      query += ` AND a.faculty_id = ?`;
      params.push(Number(faculty_id));
    } else if (req.user.role === 'faculty' && (!faculty_id || faculty_id === 'my')) {
      query += ` AND a.faculty_id = ?`;
      params.push(req.user.id);
    }

    if (start_date) {
      query += ` AND a.date >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND a.date <= ?`;
      params.push(end_date);
    }
    if (status) {
      query += ` AND a.status = ?`;
      params.push(status);
    }

    if (req.query.q) {
      if (typeof req.query.q !== 'string' || req.query.q.length > 100) return res.status(400).json({ error: 'Search must be at most 100 characters' });
      query += ' AND (s.name LIKE ? OR s.student_id LIKE ? OR u.name LIKE ? OR a.purpose LIKE ?)';
      params.push(...Array(4).fill('%' + req.query.q + '%'));
    }
    query += ` ORDER BY a.date DESC, a.time_slot DESC`;
    const rows = await db.prepare(query).all(...params);

    let csv = 'Appointment ID,Date,Time Slot,Student Name,Student ID,Course,Faculty Name,Department,Purpose,Status,Queue #,Check-in Time,Code\n';
    rows.forEach((r) => {
      const clean = (str) => `"${String(str ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
      csv += [
      r.id,
      r.date,
      `${r.time_slot} - ${r.end_time}`,
      clean(r.student_name),
      clean(r.sid),
      clean(r.student_course),
      clean(r.faculty_name),
      clean(r.faculty_dept),
      clean(r.purpose),
      r.status,
      r.queue_number || '',
      r.checkin_time || '',
      r.checkin_code || ''].
      join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="DLL_Consultation_Report_${schoolDate()}.csv"`);
    res.send(csv);
  });

  // ── SPA fallback ────────────────────────────────────────────
  installAccounts(app, db, sessionDb, auth, safe);

  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
  app.use((err, req, res, next) => {console.error(err.message);res.status(err.status || 500).json({ error: err.status === 400 ? 'Invalid request body' : 'Unable to process request' });});

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ── Start ───────────────────────────────────────────────────
  return { app, db, sessionDb, scheduler, close: async () => {clearInterval(cleanupTimer);scheduler.stop();await db.close();if (sessionDb !== db) await sessionDb.close();} };
}
const ready = bootstrap();
if (require.main === module) ready.then(({ app }) => app.listen(process.env.PORT || 3000, () => console.log('IT Consultation Portal running on port ' + (process.env.PORT || 3000)))).catch((error) => {console.error(error.message);process.exitCode = 1;});
module.exports = { ready, bootstrap };
