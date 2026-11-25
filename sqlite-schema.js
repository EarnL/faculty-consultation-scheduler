const {migrateAccounts}=require('./accounts');
const {migrateScheduling}=require('./scheduling');
module.exports=function initializeSqlite(db){

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password      TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('student','faculty')),
    department    TEXT,
    course        TEXT,
    student_id    TEXT,
    faculty_id    TEXT,
    specialization TEXT,
    avatar        TEXT,
    created_at    DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS faculty_schedules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    faculty_id    INTEGER NOT NULL,
    day_of_week   INTEGER NOT NULL,          -- 0=Sun … 6=Sat
    start_time    TEXT NOT NULL,
    end_time      TEXT NOT NULL,
    is_available  INTEGER DEFAULT 1,
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id      INTEGER NOT NULL,
    faculty_id      INTEGER NOT NULL,
    date            TEXT NOT NULL,
    time_slot       TEXT NOT NULL,
    end_time        TEXT NOT NULL,
    purpose         TEXT NOT NULL,
    remarks         TEXT DEFAULT '',
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed','cancelled','checked-in','no-show')),
    faculty_remarks TEXT DEFAULT '',
    checkin_code    TEXT,
    checkin_time    DATETIME,
    queue_number    INTEGER,
    queue_status    TEXT DEFAULT 'waiting' CHECK(queue_status IN ('waiting','next','serving','completed','skipped')),
    created_at      DATETIME DEFAULT (datetime('now','localtime')),
    updated_at      DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (student_id) REFERENCES users(id),
    FOREIGN KEY (faculty_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    type        TEXT DEFAULT 'info',
    related_id  INTEGER,
    is_read     INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS blocked_dates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    faculty_id  INTEGER NOT NULL,
    date        TEXT NOT NULL,
    reason      TEXT DEFAULT '',
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ── Helpers ─────────────────────────────────────────────────
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

db.exec(`CREATE INDEX IF NOT EXISTS idx_appointments_faculty_date ON appointments(faculty_id,date,status); CREATE INDEX IF NOT EXISTS idx_appointments_student_date ON appointments(student_id,date,status); CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,is_read); CREATE INDEX IF NOT EXISTS idx_schedule_faculty_day ON faculty_schedules(faculty_id,day_of_week);`);

migrateAccounts(db);
migrateScheduling(db);
};
