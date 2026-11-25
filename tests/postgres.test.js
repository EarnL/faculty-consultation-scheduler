const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),bcrypt=require('bcryptjs'),zlib=require('node:zlib');
let context,listener,base,admin,faculty,student,other,facultyId,studentId,appointmentId,bootstrap;
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'portal-postgres-'));
process.env.PG_TEST_PATH=path.join(directory,'pg');process.env.SESSION_SECRET='postgres-test-secret';
process.env.NODE_ENV='test';delete process.env.DATABASE_URL;
if(process.env.TEST_POSTGRES_URL) {
  if(new URL(process.env.TEST_POSTGRES_URL).hostname!=='127.0.0.1'||process.env.TEST_POSTGRES_DISPOSABLE!=='true')throw Error('Network PostgreSQL tests require an explicitly disposable loopback instance.');
  process.env.DATABASE_URL=process.env.TEST_POSTGRES_URL;delete process.env.PG_TEST_PATH;
}
async function request(url,method='GET',body,cookie){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],response};}
const login=(email,role,password='postgres-test-password')=>request('/api/login','POST',{email,role,password});
const future=new Date(Date.now()+7*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
before(async()=>{
  const module=require('../server');bootstrap=module.bootstrap;context=await module.ready;
  listener=context.app.listen(0);base='http://localhost:'+listener.address().port;
  await context.db.prepare("INSERT INTO users(email,password,name,role) VALUES(?,?,?,'admin')").run('admin',bcrypt.hashSync('postgres-test-password',10),'Test Administrator');
  await context.db.prepare('INSERT INTO departments(name) VALUES(?)').run('Information Technology');
  admin=(await login('admin','admin')).cookie;assert.ok(admin);
});
after(async()=>{if(listener)await new Promise(resolve=>listener.close(resolve));if(context)await context.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('portal-postgres-'))throw Error('Unsafe test cleanup');fs.rmSync(target,{recursive:true,force:true});});
test('PostgreSQL registration, unique student identifiers, and admin faculty creation',async()=>{
  const r=await request('/api/register','POST',{student_id:'2026-PG01',name:'Postgres Student',course:'BSIT-3A',password:'postgres-test-password'});assert.equal(r.status,201,JSON.stringify(r.data));student=r.cookie;studentId=r.data.user.id;
  assert.equal((await request('/api/register','POST',{student_id:'2026-pg01',name:'Duplicate',course:'BSIT-3A',password:'postgres-test-password'})).status,409);
  other=(await request('/api/register','POST',{student_id:'2026-PG02',name:'Other Student',course:'BSIT-3A',password:'postgres-test-password'})).cookie;
  const f=await request('/api/admin/users','POST',{role:'faculty',faculty_id:'FAC-PG01',name:'Test Faculty',department:'Information Technology',specialization:'Databases',password:'postgres-test-password'},admin);assert.equal(f.status,201,JSON.stringify(f.data));facultyId=f.data.user.id;faculty=(await login('FAC-PG01','faculty')).cookie;assert.ok(faculty);
});
test('PostgreSQL consultation hours, concurrent booking conflict, rejection and private QR passes',async()=>{
  const schedule=await request('/api/schedule','POST',{specific_date:future,start_time:'18:00',end_time:'21:00',slot_duration:30},faculty);assert.equal(schedule.status,201,JSON.stringify(schedule.data));
  const payload={faculty_id:facultyId,date:future,time_slot:'18:00',end_time:'18:30',purpose:'Database design feedback'};
  const results=await Promise.all([request('/api/appointments','POST',payload,student),request('/api/appointments','POST',payload,other)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409],JSON.stringify(results.map(r=>r.data)));
  const winner=results.findIndex(r=>r.status===200);appointmentId=results[winner].data.id;
  if(winner===1){[student,other]=[other,student];studentId=(await request('/api/me','GET',null,student)).data.user.id;}
  assert.equal((await request('/api/appointments/'+appointmentId,'PUT',{status:'rejected'},faculty)).status,400);
  const approved=await request('/api/appointments/'+appointmentId,'PUT',{status:'approved'},faculty);assert.equal(approved.status,200,JSON.stringify(approved.data));
  const pass=await request('/api/appointments/'+appointmentId+'/pass','GET',null,student);assert.equal(pass.status,200,JSON.stringify(pass.data));assert.ok(pass.data.checkin_code);
  assert.equal((await request('/api/appointments/'+appointmentId+'/pass','GET',null,other)).status,404);
});
test('PostgreSQL directory, venue notifications, reports and reschedule acceptance',async()=>{
  assert.equal((await request('/api/profile','PUT',{consultation_location:'IT faculty office'},faculty)).status,200);
  const directory=await request('/api/faculty','GET',null,student);assert.equal(directory.status,200);assert.ok(Array.isArray(directory.data[0].schedules));
  const report=await request('/api/analytics','GET',null,faculty);assert.equal(report.status,200,JSON.stringify(report.data));
  const r=await request('/api/appointments/'+appointmentId+'/reschedule','POST',{date:future,time_slot:'19:00',end_time:'19:30',reason:'Our group has a laboratory activity at the original time.'},student);assert.equal(r.status,201,JSON.stringify(r.data));
  const accepted=await request('/api/reschedules/'+r.data.id,'PUT',{action:'approve'},faculty);assert.equal(accepted.status,200,JSON.stringify(accepted.data));
  const notifications=await request('/api/notifications','GET',null,student);assert.equal(notifications.status,200);
});
test('PostgreSQL arrival lookup and concurrent queue starts keep only one consultation serving',async()=>{
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
  await context.db.prepare("UPDATE appointments SET date=?,time_slot='00:00',end_time='23:59' WHERE id=?").run(today,appointmentId);
  const a=await context.db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
  const review=await request('/api/checkin/review','POST',{code:a.checkin_code.toLowerCase()},faculty);assert.equal(review.status,200,JSON.stringify(review.data));
  const confirmed=await request('/api/checkin','POST',{code:a.checkin_code,late_reason:'Confirmed arrival during the supervised test.'},faculty);assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
  const number=(await context.db.prepare('SELECT student_id FROM users WHERE id=?').get(studentId)).student_id;
  assert.equal((await request('/api/checkin/search?student_number='+encodeURIComponent(number.toLowerCase()),'GET',null,faculty)).data.length,1);
  const second=Number((await context.db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status,checkin_time) VALUES(?,?,?,'00:15','23:59','Second arrival','checked-in',?)").run(studentId,facultyId,today,today+' 00:15:00')).lastInsertRowid);
  const started=await Promise.all([appointmentId,second].map(id=>request('/api/queue/'+id,'PUT',{action:'start'},faculty)));
  assert.deepEqual(started.map(r=>r.status).sort(),[200,409],JSON.stringify(started.map(r=>r.data)));
  assert.equal((await context.db.prepare("SELECT count(*) AS n FROM appointments WHERE faculty_id=? AND queue_status='serving'").get(facultyId)).n,1);
});
test('PostgreSQL backups are private, compressed and contain records without session tokens',async()=>{
  assert.equal((await request('/api/admin/backups','POST',{},student)).status,403);
  const backup=await request('/api/admin/backups','POST',{},admin);assert.equal(backup.status,201,JSON.stringify(backup.data));
  const response=await fetch(base+'/api/admin/backups/'+backup.data.file+'/download',{headers:{cookie:admin}});assert.equal(response.status,200);
  const snapshot=JSON.parse(zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'));
  assert.equal(snapshot.format,'it-consult-postgres-v1');assert.ok(snapshot.tables.users.length>=4);assert.equal('sessions' in snapshot.tables,false);
});
test('PostgreSQL import refuses occupied targets and restores valid snapshots atomically',async()=>{
  const tables={};for(const table of require('../postgres-backups').TABLES)tables[table]=await context.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  await assert.rejects(require('../postgres-transfer').importTables(context.db,tables),/already has accounts/);
  const invalid=structuredClone(tables);invalid.users[0].role='unsupported';
  await assert.rejects(require('../postgres-transfer').importTables(context.db,invalid,{replace:true}));
  assert.equal((await context.db.prepare('SELECT count(*) AS n FROM users').get()).n,tables.users.length);
  const Database=require('better-sqlite3');
  const source=new Database(':memory:');require('../sqlite-schema')(source);
  for(const table of require('../postgres-backups').TABLES)for(const row of tables[table]){const columns=Object.keys(row);source.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column]));}
  const saved={};for(const table of require('../postgres-backups').TABLES)saved[table]=source.prepare(`SELECT * FROM ${table} ORDER BY id`).all();source.close();
  await context.db.prepare("UPDATE appointments SET purpose='Temporary change' WHERE id=?").run(appointmentId);
  await require('../postgres-transfer').importTables(context.db,saved,{replace:true});
  assert.equal((await context.db.prepare('SELECT purpose FROM appointments WHERE id=?').get(appointmentId)).purpose,'Database design feedback');
  assert.equal((await request('/api/me','GET',null,student)).status,401);
  // Restore intentionally revokes all sessions; sign in again for subsequent checks.
  student=(await login((await context.db.prepare('SELECT student_id FROM users WHERE id=?').get(studentId)).student_id,'student')).cookie;
});
test('PostgreSQL sessions survive a server restart and password changes revoke other sessions',async()=>{
  const saved=student;await new Promise(resolve=>listener.close(resolve));await context.close();context=await bootstrap();listener=context.app.listen(0);base='http://localhost:'+listener.address().port;
  assert.equal((await request('/api/me','GET',null,saved)).status,200);
  const current=await login((await request('/api/me','GET',null,saved)).data.user.student_id,'student');assert.equal(current.status,200);
  const changed=await request('/api/profile/password','PUT',{current_password:'postgres-test-password',new_password:'changed-postgres-password'},current.cookie);assert.equal(changed.status,200,JSON.stringify(changed.data));
  assert.equal((await request('/api/me','GET',null,saved)).status,401);
});
