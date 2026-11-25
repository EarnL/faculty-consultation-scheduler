// Adds sample consultations without changing existing accounts or appointments.
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'scheduler.db'));
db.pragma('foreign_keys = ON');
const batch = 'natural-consultations-v1';
const base = process.argv[2] || new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Manila'});
if (!/^\d{4}-\d{2}-\d{2}$/.test(base) || !Number.isFinite(Date.parse(base))) throw new Error('Use YYYY-MM-DD.');
const day = offset => new Date(Date.parse(base + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0,10);
const clock = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const mins = s => Number(s.slice(0,2))*60 + Number(s.slice(3));
async function main() {
  if (db.prepare("SELECT 1 FROM appointment_events WHERE action='demo_seed' AND details LIKE ?").get(`%${batch}%`)) {
    console.log('Sample batch already exists; no duplicates added.'); return;
  }
  const directory = path.join(path.dirname(db.name), 'backups');
  fs.mkdirSync(directory, {recursive:true});
  const backup = path.join(directory, `before-demo-data-${Date.now()}.db`);
  await db.backup(backup);
  const before = db.prepare('SELECT COUNT(*) n FROM appointments').get().n;
  const students = db.prepare("SELECT id,name FROM users WHERE role='student' AND is_active=1 ORDER BY id").all();
  const faculty = db.prepare("SELECT id FROM users WHERE role='faculty' AND is_active=1 ORDER BY id").all();
  const purposes = [
    ['Capstone proposal feedback', 'We would like feedback on our scope and proposed features.'],
    ['Help with database normalization', 'I have prepared my ER diagram and a few sample tables.'],
    ['Review of programming exercise', 'I would like help understanding the errors in my Java program.'],
    ['Research methodology consultation', 'Please review the draft of our data collection procedure.'],
    ['Web application project review', 'Our group would like feedback on the booking flow and interface.'],
    ['Clarification on networking activity', 'I need guidance on subnetting and our laboratory activity.']
  ];
  const added = [];
  db.transaction(() => {
    for (let i=0;i<students.length;i++) {
      for (const [j,status] of ['approved','pending','completed','rejected'].entries()) {
        const student = students[i];
        const teacher = faculty[(i+j)%faculty.length];
        let chosen;
        for (let offset=j<2?1:-14; offset<=(j<2?21:-1) && !chosen; offset++) {
          const date = day(offset);
          const weekday = new Date(date+'T12:00:00Z').getUTCDay();
          const schedules = db.prepare('SELECT * FROM faculty_schedules WHERE faculty_id=? AND is_available=1 AND (specific_date=? OR (specific_date IS NULL AND day_of_week=?)) ORDER BY start_time').all(teacher.id,date,weekday);
          const blocks = db.prepare('SELECT * FROM blocked_dates WHERE faculty_id=? AND date=?').all(teacher.id,date);
          for (const s of schedules) {
            for (let t=mins(s.start_time);t+s.slot_duration<=mins(s.end_time);t+=s.slot_duration) {
              const start=clock(t), end=clock(t+s.slot_duration);
              if (blocks.some(b=>!b.start_time || start<b.end_time && end>b.start_time)) continue;
              const conflict=db.prepare("SELECT 1 FROM appointments WHERE date=? AND (faculty_id=? OR student_id=?) AND status IN ('pending','approved','checked-in','completed') AND time_slot<? AND end_time>?").get(date,teacher.id,student.id,end,start);
              if (!conflict) { chosen={date,start,end}; break; }
            }
            if(chosen) break;
          }
        }
        if(!chosen) throw new Error('No suitable sample slot for '+student.name);
        const [purpose,remarks] = purposes[(i+j)%purposes.length];
        const note = status==='completed' ? 'Reviewed the draft and discussed the next steps. Please apply the suggested revisions.' : status==='rejected' ? 'Please revise the consultation purpose to specify the topic you need help with, then submit a new request.' : '';
        const created=day(j<2?0:-16)+' 09:00:00';
        const id=Number(db.prepare('INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,remarks,status,faculty_remarks,checkin_code,queue_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(student.id,teacher.id,chosen.date,chosen.start,chosen.end,purpose,remarks,status,note,crypto.randomBytes(24).toString('hex'),status==='completed'?'completed':'waiting',created,created).lastInsertRowid);
        db.prepare('INSERT INTO appointment_events(appointment_id,actor_id,action,details,created_at) VALUES(?,?,?,?,?)').run(id,student.id,'demo_seed',JSON.stringify({batch,sample:true,status}),created);
        // Only upcoming samples create actionable notifications.
        if(j<2) db.prepare('INSERT INTO notifications(user_id,title,message,type,related_id) VALUES(?,?,?,?,?)').run(status==='approved'?student.id:teacher.id,status==='approved'?'Consultation approved':'New consultation request',`${purpose} — ${chosen.date}, ${chosen.start}–${chosen.end}.`,'info',id);
        added.push({id,student:student.name,status,...chosen});
      }
    }
  }).immediate();
  if(db.pragma('integrity_check',{simple:true})!=='ok' || db.pragma('foreign_key_check').length) throw new Error('Database verification failed.');
  console.log(JSON.stringify({backup,previousAppointments:before,added:added.length,appointments:added},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.close());
