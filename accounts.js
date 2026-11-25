const bcrypt = require('bcryptjs');

function migrateAccounts(db) {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
  if (!schema.includes("'admin'") || db.pragma('table_info(users)').find((c) => c.name === 'email').notnull) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(schema.replace(/CREATE TABLE\s+"?users"?/i, 'CREATE TABLE users_new').replace(/'student','faculty'(?!,'admin')/, "'student','faculty','admin'").replace(/(\bemail\s+TEXT\s+UNIQUE)\s+NOT NULL/i, '$1'));
        db.exec('INSERT INTO users_new SELECT * FROM users; DROP TABLE users; ALTER TABLE users_new RENAME TO users;');
        if (db.pragma('foreign_key_check').length) throw new Error('Account migration failed foreign key validation');
      })();
    } finally {db.pragma('foreign_keys = ON');}
  }
  db.prepare("UPDATE users SET email=NULL WHERE email LIKE '%@accounts.invalid'").run();
  if (!db.pragma('table_info(users)').some((c) => c.name === 'is_active')) db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  for (const field of ['contact_number', 'contact_email', 'consultation_location', 'meeting_link', 'consultation_instructions']) if (!db.pragma('table_info(users)').some((c) => c.name === field)) db.exec(`ALTER TABLE users ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, target_id INTEGER, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE TRIGGER IF NOT EXISTS prevent_duplicate_student_insert BEFORE INSERT ON users
      WHEN NEW.role='student' AND EXISTS (SELECT 1 FROM users WHERE role='student' AND lower(trim(student_id))=lower(trim(NEW.student_id)))
      BEGIN SELECT RAISE(ABORT,'Duplicate student number'); END;
    CREATE TRIGGER IF NOT EXISTS prevent_duplicate_student_update BEFORE UPDATE OF student_id,role ON users
      WHEN NEW.role='student' AND EXISTS (SELECT 1 FROM users WHERE role='student' AND id!=NEW.id AND lower(trim(student_id))=lower(trim(NEW.student_id)))
      BEGIN SELECT RAISE(ABORT,'Duplicate student number'); END;
    CREATE TRIGGER IF NOT EXISTS prevent_duplicate_faculty_insert BEFORE INSERT ON users
      WHEN NEW.role='faculty' AND EXISTS (SELECT 1 FROM users WHERE role='faculty' AND lower(trim(faculty_id))=lower(trim(NEW.faculty_id)))
      BEGIN SELECT RAISE(ABORT,'Duplicate faculty ID'); END;
  `);
}

function installAccounts(app, db, sessionDb, auth, safe) {
  const attempts = new Map();
  const limit = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const value = attempts.get(req.ip) || { count: 0, until: now + 15 * 60000 };
    if (++value.count > 20) {res.setHeader('Retry-After', Math.ceil((value.until - now) / 1000));return res.status(429).json({ error: 'Too many registration attempts. Please try again later.' });}
    attempts.set(req.ip, value);next();
  };
  const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Administrator access required' });
  const text = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const passwordOK = (p) => typeof p === 'string' && p.length >= 8 && Buffer.byteLength(p) <= 72;
  const numberOK = (n) => typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{2,29}$/.test(n.trim());
  const audit = async (actor, action, target, details = '') => await db.prepare('INSERT INTO audit_log(actor_id,action,target_id,details) VALUES(?,?,?,?)').run(actor, action, target, details);
  const revoke = async (id) => await sessionDb.prepare("DELETE FROM sessions WHERE json_extract(data,'$.userId')=?").run(id);
  const create = async (data) => {
    const role = data.role;
    const rawIdentifier = role === 'student' ? data.student_id : data.faculty_id;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    if (!text(data.name) || !numberOK(identifier) || !passwordOK(data.password) || role === 'student' && !text(data.course, 100)) return { status: 400, error: 'Enter a name, a valid ID (3–30 letters, digits or hyphens), course for students, and a password of at least 8 characters (maximum 72 bytes).' };
    for (const key of ['department', 'specialization', 'course']) if (data[key] != null && (typeof data[key] !== 'string' || data[key].length > 200)) return { status: 400, error: 'Invalid ' + key };
    if (data.department && !(await db.prepare('SELECT id FROM departments WHERE name=?').get(data.department.trim()))) return { status: 400, error: 'Choose an existing department' };
    const column = role === 'student' ? 'student_id' : 'faculty_id';
    if (await db.prepare(`SELECT id FROM users WHERE role=? AND lower(trim(${column}))=lower(?)`).get(role, identifier)) return { status: 409, error: role === 'student' ? 'This student number is already registered. Please sign in.' : 'This faculty ID is already in use.' };
    try {
      const id = Number((await db.prepare(`INSERT INTO users(email,password,name,role,student_id,faculty_id,course,department,specialization) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        null, bcrypt.hashSync(data.password, 10), data.name.trim(), role, role === 'student' ? identifier : null, role === 'faculty' ? identifier : null, data.course?.trim() || null, data.department?.trim() || null, data.specialization?.trim() || null
      )).lastInsertRowid);
      return { user: await db.prepare('SELECT * FROM users WHERE id=?').get(id) };
    } catch (e) {if (e.code?.startsWith('SQLITE_CONSTRAINT')) return { status: 409, error: 'This ID is already registered' };throw e;}
  };
  app.get('/api/departments', async (req, res) => res.json(await db.prepare('SELECT * FROM departments ORDER BY name').all()));
  app.post('/api/register', limit, async (req, res) => {
    if (req.body.role !== undefined && req.body.role !== 'student') return res.status(400).json({ error: 'Self-registration is for students only' });
    const result = await create({ ...req.body, role: 'student' });
    if (result.error) return res.status(result.status).json({ error: result.error });
    await audit(result.user.id, 'student.registered', result.user.id);
    req.session.regenerate((err) => {
      if (err) return res.status(201).json({ user: safe(result.user), sign_in_required: true });
      req.session.userId = result.user.id;
      req.session.save((err) => res.status(201).json({ user: safe(result.user), ...(err ? { sign_in_required: true } : {}) }));
    });
  });
  app.get('/api/admin/overview', auth, adminOnly, async (req, res) => {
    const counts = await db.prepare('SELECT role,is_active,count(*) AS count FROM users GROUP BY role,is_active').all();
    res.json({ counts, appointments: await db.prepare('SELECT status,count(*) AS count FROM appointments GROUP BY status').all(), departments: (await db.prepare('SELECT count(*) AS count FROM departments').get()).count,
      recent: await db.prepare('SELECT a.*,u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 12').all() });
  });
  app.get('/api/admin/users', auth, adminOnly, async (req, res) => res.json(await db.prepare('SELECT id,name,role,student_id,faculty_id,department,course,specialization,is_active,created_at FROM users ORDER BY created_at DESC,id DESC').all()));
  app.post('/api/admin/users', auth, adminOnly, async (req, res) => {
    if (!['student', 'faculty'].includes(req.body.role)) return res.status(400).json({ error: 'Only student and faculty accounts can be created here' });
    const result = await create(req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    await audit(req.user.id, 'account.created', result.user.id, result.user.role);
    res.status(201).json({ user: safe(result.user) });
  });
  app.put('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Administrator accounts are managed through setup and their own profile' });
    const allowed = ['name', 'department', 'course', 'specialization', 'is_active'];
    if (Object.keys(req.body).some((k) => !allowed.includes(k))) return res.status(400).json({ error: 'Unsupported account field' });
    for (const k of allowed.filter((k) => k !== 'is_active')) if (req.body[k] !== undefined && (typeof req.body[k] !== 'string' || req.body[k].length > 200 || k === 'name' && !req.body[k].trim())) return res.status(400).json({ error: 'Invalid ' + k });
    if (req.body.is_active !== undefined && typeof req.body.is_active !== 'boolean') return res.status(400).json({ error: 'Invalid account status' });
    if (req.body.department && !(await db.prepare('SELECT id FROM departments WHERE name=?').get(req.body.department.trim()))) return res.status(400).json({ error: 'Choose an existing department' });
    await db.transaction(async () => {
      for (const k of allowed) if (req.body[k] !== undefined) await db.prepare(`UPDATE users SET ${k}=? WHERE id=?`).run(k === 'is_active' ? Number(req.body[k]) : req.body[k].trim(), user.id);
      await audit(req.user.id, 'account.updated', user.id, Object.keys(req.body).join(', '));
    })();
    if (req.body.is_active === false) await revoke(user.id);
    res.json({ ok: true });
  });
  app.post('/api/admin/users/:id/password', auth, adminOnly, async (req, res) => {
    const user = await db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Use your profile to change administrator passwords' });
    if (!passwordOK(req.body.password)) return res.status(400).json({ error: 'Use at least 8 characters and at most 72 bytes' });
    await db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(req.body.password, 10), user.id);
    await revoke(user.id);await audit(req.user.id, 'account.password_reset', user.id);
    res.json({ ok: true });
  });
  app.post('/api/admin/departments', auth, adminOnly, async (req, res) => {
    if (!text(req.body.name, 120)) return res.status(400).json({ error: 'Enter a department name (maximum 120 characters)' });
    const name = req.body.name.trim();
    if (await db.prepare('SELECT id FROM departments WHERE name=?').get(name)) return res.status(409).json({ error: 'This department already exists' });
    const id = Number((await db.prepare('INSERT INTO departments(name) VALUES(?)').run(name)).lastInsertRowid);
    await audit(req.user.id, 'department.created', id, name);res.status(201).json({ id, name });
  });
  app.put('/api/admin/departments/:id', auth, adminOnly, async (req, res) => {
    const department = await db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id);
    if (!department) return res.status(404).json({ error: 'Department not found' });
    if (!text(req.body.name, 120)) return res.status(400).json({ error: 'Enter a department name (maximum 120 characters)' });
    const name = req.body.name.trim();
    if (await db.prepare('SELECT id FROM departments WHERE name=? AND id!=?').get(name, department.id)) return res.status(409).json({ error: 'This department already exists' });
    await db.transaction(async () => {await db.prepare('UPDATE departments SET name=? WHERE id=?').run(name, department.id);await db.prepare('UPDATE users SET department=? WHERE department=? COLLATE NOCASE').run(name, department.name);await audit(req.user.id, 'department.renamed', department.id, name);})();
    res.json({ ok: true });
  });
  app.delete('/api/admin/departments/:id', auth, adminOnly, async (req, res) => {
    const d = await db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Department not found' });
    if (await db.prepare('SELECT id FROM users WHERE department=? COLLATE NOCASE').get(d.name)) return res.status(409).json({ error: 'Move accounts to another department before removing this one' });
    await db.prepare('DELETE FROM departments WHERE id=?').run(d.id);await audit(req.user.id, 'department.removed', d.id, d.name);res.json({ ok: true });
  });
}

module.exports = { migrateAccounts, installAccounts };
