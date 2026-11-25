const fs = require('fs'),path = require('path'),crypto = require('crypto'),Database = require('better-sqlite3');
function installBackups({ app, db, dbPath, auth }) {
  const directory = path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups'));
  fs.mkdirSync(directory, { recursive: true });
  const valid = (name) => /^portal-backup-\d+-[a-f0-9]{8}\.db$/.test(name);
  const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Administrator access required' });
  const list = () => fs.readdirSync(directory).filter(valid).map((file) => {const stat = fs.statSync(path.join(directory, file));return { file, created_at: stat.mtime.toISOString(), bytes: stat.size };}).sort((a, b) => b.created_at.localeCompare(a.created_at));
  app.get('/api/admin/backups', auth, admin, (req, res) => res.set('Cache-Control', 'no-store').json({ latest: list()[0] || null }));
  let running = false;
  app.post('/api/admin/backups', auth, admin, async (req, res) => {
    if (running) return res.status(409).json({ error: 'A backup is already running. Please wait.' });running = true;
    const file = `portal-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`,temporary = path.join(directory, file + '.pending');
    try {await db.backup(temporary);const snapshot = new Database(temporary, { readonly: true });try {if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok' || snapshot.pragma('foreign_key_check').length) throw Error('Backup verification failed');} finally {snapshot.close();}fs.renameSync(temporary, path.join(directory, file));await db.prepare("INSERT INTO audit_log(actor_id,action,details) VALUES(?,'backup.created',?)").run(req.user.id, file);res.status(201).set('Cache-Control', 'no-store').json(list().find((x) => x.file === file));}
    catch (err) {console.error(err);res.status(500).json({ error: 'Unable to complete a verified backup.' });} finally {running = false;}
  });
  app.get('/api/admin/backups/:file/download', auth, admin, (req, res) => {if (!valid(req.params.file) || !fs.existsSync(path.join(directory, req.params.file))) return res.status(404).json({ error: 'Backup not found' });res.set('Cache-Control', 'no-store');res.download(path.join(directory, req.params.file), req.params.file);});
}
module.exports = { installBackups };
