const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const D=require('better-sqlite3'); const bcrypt=require('bcryptjs');
let child,db,dir,student,faculty,other,base;
async function request(url,method='GET',body,cookie){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','Connection':'close',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function login(email,role='student',password='123456'){return request('/api/login','POST',{email,password,role});}
function dateAfter(days){return new Date(Date.now()+days*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});}
before(async()=>{
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'dll-scheduler-')); const port=31000+Math.floor(Math.random()*10000);base='http://localhost:'+port;
 child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DB_PATH:path.join(dir,'test.db'),SESSION_DB_PATH:path.join(dir,'sessions.db'),SESSION_SECRET:'integration-test-only'}});
 let logs='';child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);
 for(let i=0;i<100;i++){try{await fetch(base);break;}catch{if(child.exitCode!==null)throw Error(logs); await new Promise(r=>setTimeout(r,100));}}
 db=new D(path.join(dir,'test.db'));
 student=(await login('student@dll.edu.ph')).cookie;faculty=(await login('faculty@dll.edu.ph','faculty')).cookie;other=(await login('mgarcia@dll.edu.ph')).cookie;
 assert.ok(student);assert.ok(faculty);assert.ok(other);
});
after(async()=>{if(child){child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}if(db)db.close();if(dir)fs.rmSync(dir,{recursive:true,force:true});});
test('fresh database seeds completely and satisfies foreign keys',()=>{assert.equal(db.prepare('SELECT count(*) c FROM users').get().c,12);assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.prepare('SELECT count(DISTINCT faculty_id) c FROM faculty_schedules').get().c,9);});
test('password bypass removed and role boundaries enforced',async()=>{assert.equal((await login('student@dll.edu.ph','student','password123')).status,401);assert.equal((await login('student@dll.edu.ph','faculty')).status,401);const hash=bcrypt.hashSync('a-different-password',10);db.prepare('UPDATE users SET password=? WHERE id=2').run(hash);assert.equal((await login('mgarcia@dll.edu.ph','student','123456')).status,401);assert.equal((await login('mgarcia@dll.edu.ph','student','a-different-password')).status,200);});
test('reports and CSV remain scoped despite all/foreign faculty filters',async()=>{for(const cookie of [student,faculty]){for(const query of ['all','5','my']){const r=await request('/api/analytics?facultyId='+query,'GET',null,cookie);assert.equal(r.status,200);assert.ok(r.data.appointments.every(a=>cookie===student?a.student_id===1:a.faculty_id===4));}const csv=await request('/api/analytics/export?facultyId=all','GET',null,cookie);assert.equal(csv.status,200);if(cookie===student)assert.ok(!csv.data.includes('Maria Garcia'));else assert.ok(!csv.data.includes('Essay feedback review'));}});
test('booking rejects malformed, outside-hours and overlapping appointments',async()=>{const date=dateAfter(7),day=new Date(date+'T12:00:00+08:00').getUTCDay();db.prepare('INSERT INTO faculty_schedules(faculty_id,day_of_week,start_time,end_time,slot_duration) VALUES(4,?,?,?,30)').run(day,'17:00','19:00');const body={faculty_id:4,date,time_slot:'17:00',end_time:'17:30',purpose:'Test booking'};assert.equal((await request('/api/appointments','POST',{...body,date:'2026-02-30'},student)).status,400);assert.equal((await request('/api/appointments','POST',{...body,time_slot:'22:00',end_time:'22:15'},student)).status,409);assert.equal((await request('/api/appointments','POST',body,student)).status,200);assert.equal((await request('/api/appointments','POST',{...body,time_slot:'17:15',end_time:'17:45'},other)).status,409);const slots=await request('/api/faculty/4/slots?date='+date,'GET',null,student);assert.ok(!slots.data.some(s=>s.start==='17:15'));assert.equal((await request('/api/appointments','POST',{...body,faculty_id:1},student)).status,404);});
test('schedule creation validates times and overlapping ranges',async()=>{assert.equal((await request('/api/schedule','POST',{day_of_week:1,start_time:'12:00',end_time:'11:00'},faculty)).status,400);assert.equal((await request('/api/schedule','POST',{day_of_week:1,start_time:'08:15',end_time:'09:00'},faculty)).status,409);});
test('future check-in rejected without rewriting date; same-day lifecycle works',async()=>{const future=dateAfter(2);let id=Number(db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status,checkin_code) VALUES(1,4,?,'18:00','18:15','Check-in test','approved',?)").run(future,'FUTURE').lastInsertRowid);assert.equal((await request('/api/checkin','POST',{code:'FUTURE'},faculty)).status,409);assert.equal(db.prepare('SELECT date FROM appointments WHERE id=?').get(id).date,future);const today=dateAfter(0);db.prepare("UPDATE appointments SET date=?,time_slot='00:00',end_time='23:59' WHERE id=?").run(today,id);assert.equal((await request('/api/checkin','POST',{code:'FUTURE'},faculty)).status,200);assert.equal((await request('/api/queue/'+id,'PUT',{action:'nonsense'},faculty)).status,400);assert.equal((await request('/api/queue/'+id,'PUT',{action:'complete'},faculty)).status,409);assert.equal((await request('/api/queue/'+id,'PUT',{action:'skip'},faculty)).status,200); const skipped=await request('/api/queue','GET',null,student); assert.equal(skipped.data.my_turn.queue_status,'skipped'); assert.equal((await request('/api/queue','GET',null,faculty)).data.waiting_queue.some(a=>a.id===id),false); assert.equal((await request('/api/queue/'+id,'PUT',{action:'recall'},faculty)).status,200); assert.equal((await request('/api/queue/'+id,'PUT',{action:'start'},faculty)).status,200);assert.equal((await request('/api/queue/'+id,'PUT',{action:'complete'},faculty)).status,200);assert.equal((await request('/api/queue/'+id,'PUT',{action:'start'},faculty)).status,409);});
test('terminal appointments cannot be reopened and students cannot forge faculty remarks',async()=>{assert.equal((await request('/api/appointments/4','PUT',{status:'approved'},faculty)).status,403);assert.equal((await request('/api/appointments/1','PUT',{status:'cancelled',faculty_remarks:'Forged'},student)).status,403);assert.equal((await request('/api/appointments/1','PUT',{status:'invalid'},faculty)).status,409); const done=db.prepare("SELECT id FROM appointments WHERE faculty_id=4 AND status='completed'").get(); assert.equal((await request('/api/appointments/'+done.id,'PUT',{status:'approved'},faculty)).status,409);});
test('API errors, profile validation and request origin protection',async()=>{assert.equal((await request('/api/profile','PUT',{name:{}},student)).status,400);assert.equal((await request('/api/profile','PUT',{avatar:'javascript:alert(1)'},student)).status,400);assert.equal((await request('/api/missing','GET',null,student)).status,404);assert.equal((await request('/api/students/3','GET',null,student)).status,403);const r=await fetch(base+'/api/logout',{method:'POST',headers:{Origin:'https://other.example',cookie:student}});assert.equal(r.status,403);});
test('password changes invalidate former password and new login survives cookie rotation',async()=>{assert.equal((await request('/api/profile/password','PUT',{current_password:'123456',new_password:'a-strong-new-password'},student)).status,200);assert.equal((await login('student@dll.edu.ph','student','123456')).status,401);const r=await login('student@dll.edu.ph','student','a-strong-new-password');assert.equal(r.status,200);assert.notEqual(r.cookie,student);assert.equal((await request('/api/me','GET',null,r.cookie)).status,200);});
test('CSV neutralizes spreadsheet formulas and malformed filters are rejected',async()=>{const id=Number(db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status) VALUES(1,4,?,'20:00','20:15',?,'pending')").run(dateAfter(3),'=HYPERLINK("https://example.invalid")').lastInsertRowid);const csv=await request('/api/analytics/export','GET',null,faculty);assert.equal(csv.status,200);assert.ok(csv.data.includes('"\'=HYPERLINK'));assert.equal((await request('/api/analytics?startDate=invalid','GET',null,faculty)).status,400);assert.ok(id);});
test('login sessions persist across a server restart',async()=>{const signed=await login('faculty@dll.edu.ph','faculty');assert.equal(signed.status,200);child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:base.split(':').at(-1),DB_PATH:path.join(dir,'test.db'),SESSION_DB_PATH:path.join(dir,'sessions.db'),SESSION_SECRET:'integration-test-only'}});for(let i=0;i<100;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.equal((await request('/api/me','GET',null,signed.cookie)).status,200);});

test('students register with a number and immediately get a student session',async()=>{
 const body={student_id:'2026-09001',name:'New Student',course:'BSIT-1A',password:'my-new-password'};
 const r=await request('/api/register','POST',body);assert.equal(r.status,201);assert.equal(r.data.user.role,'student');assert.equal(r.data.user.email,'');assert.ok(r.cookie);assert.equal((await request('/api/me','GET',null,r.cookie)).status,200);
 assert.equal((await login(body.student_id,'student',body.password)).status,200);
 assert.equal((await request('/api/register','POST',{...body,student_id:' 2026-09001 '})).status,409);
 assert.equal((await request('/api/register','POST',{...body,student_id:'2026-09002',role:'admin'})).status,400);
 assert.equal((await request('/api/register','POST',{...body,student_id:'2026-09002',role:'faculty'})).status,400);
 assert.equal((await request('/api/register','POST',{...body,student_id:'abc<script>'})).status,400);
 assert.equal((await request('/api/register','POST',{...body,student_id:'2026-09002',password:'short'})).status,400);
 assert.equal((await request('/api/admin/users','GET',null,r.cookie)).status,403);
 assert.equal((await request('/api/admin/users','GET')).status,401);
});
test('admin bootstrap, account lifecycle, departments and school-wide reports',async()=>{
 const env={...process.env,DB_PATH:path.join(dir,'test.db'),SESSION_DB_PATH:path.join(dir,'sessions.db'),SESSION_SECRET:'integration-test-only',ADMIN_PASSWORD:'admin-test-password'};
 const setup=spawnSync(process.execPath,['scripts/setup-admin.js'],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
 assert.notEqual(spawnSync(process.execPath,['scripts/setup-admin.js'],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8'}).status,0);
 const signed=await login('admin','admin','admin-test-password');assert.equal(signed.status,200);const admin=signed.cookie;
 assert.equal((await login('admin','student','admin-test-password')).status,401);
 assert.equal((await request('/api/admin/overview','GET',null,student)).status,403);
 assert.equal((await request('/api/admin/overview','GET',null,faculty)).status,403);
 const overview=await request('/api/admin/overview','GET',null,admin);assert.equal(overview.status,200);assert.ok(overview.data.counts.some(x=>x.role==='admin'));
 const all=await request('/api/analytics?facultyId=all','GET',null,admin);assert.ok(new Set(all.data.appointments.map(a=>a.student_id)).size>1);
 assert.equal((await request('/api/admin/users','POST',{role:'admin',name:'Bad'},admin)).status,400);
 const dept=await request('/api/admin/departments','POST',{name:'Test Department'},admin);assert.equal(dept.status,201);
 assert.equal((await request('/api/admin/departments','POST',{name:'test department'},admin)).status,409);
 const made=await request('/api/admin/users','POST',{role:'faculty',faculty_id:'FAC-NEW',name:'Test Faculty',department:'Test Department',specialization:'Testing',password:'new-faculty-password'},admin);assert.equal(made.status,201);const id=made.data.user.id;
 const facLogin=await login('FAC-NEW','faculty','new-faculty-password');assert.equal(facLogin.status,200);
 assert.equal((await request('/api/admin/users','POST',{role:'faculty',faculty_id:'fac-new',name:'Duplicate',password:'new-faculty-password'},admin)).status,409);
 assert.equal((await request('/api/admin/departments/'+dept.data.id,'DELETE',null,admin)).status,409);
 assert.equal((await request('/api/admin/departments/'+dept.data.id,'PUT',{name:'Renamed Department'},admin)).status,200);assert.equal(db.prepare('SELECT department FROM users WHERE id=?').get(id).department,'Renamed Department');
 assert.equal((await request('/api/admin/users/'+id,'PUT',{is_active:false},admin)).status,200);
 assert.equal((await login('FAC-NEW','faculty','new-faculty-password')).status,401);assert.equal((await request('/api/me','GET',null,facLogin.cookie)).status,401);
 assert.equal((await request('/api/admin/users/'+id,'PUT',{is_active:true},admin)).status,200);
 assert.equal((await request('/api/admin/users/'+id+'/password','POST',{password:'reset-faculty-password'},admin)).status,200);
 assert.equal((await login('FAC-NEW','faculty','new-faculty-password')).status,401);assert.equal((await login('FAC-NEW','faculty','reset-faculty-password')).status,200);
 assert.equal((await request('/api/admin/users/'+signed.data.user.id,'PUT',{is_active:false},admin)).status,403);
 assert.equal((await request('/api/appointments/1','PUT',{status:'cancelled'},admin)).status,403);
 assert.equal((await request('/api/checkin','POST',{code:'FUTURE'},admin)).status,403);
 assert.equal((await request('/api/admin/users/'+id,'PUT',{department:''},admin)).status,200);assert.equal((await request('/api/admin/departments/'+dept.data.id,'DELETE',null,admin)).status,200);
 assert.ok(db.prepare("SELECT count(*) c FROM audit_log WHERE action='account.password_reset'").get().c>0);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
});

async function uiFixture() {
 const {JSDOM,VirtualConsole}=require('jsdom');const errors=[];
 const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',err=>errors.push(err.message));
 const dom=new JSDOM(fs.readFileSync(path.resolve(__dirname,'../public/index.html'),'utf8'),{url:base+'/#login',runScripts:'outside-only',virtualConsole});
 let cookie,sessionSettled=false;const win=dom.window;win.scrollTo=()=>{};
 win.fetch=async (url,opts={})=>{const r=await request(url,opts.method||'GET',opts.body?JSON.parse(opts.body):undefined,cookie);if(r.cookie)cookie=r.cookie;if(url==='/api/me'){await new Promise(resolve=>setTimeout(resolve,350));sessionSettled=true;}return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>r.data};};
 for(const script of ['account-screens.js','workflow-screens.js','faculty-directory.js','consultation-pass.js','portal-header.js','profile-screen.js','consultation-overview.js','app.js'])win.eval(fs.readFileSync(path.resolve(__dirname,'../public/js/'+script),'utf8'));
 const $=selector=>win.document.querySelector(selector);
 const wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}assert.fail('UI did not reach expected state: '+win.document.querySelector('#page-content')?.textContent+' '+errors.join('\n'));};
 await new Promise(r=>setTimeout(r,80));
 return {dom,win,$,wait,errors,sessionSettled:()=>sessionSettled,submit:form=>$(form).dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}))};
}
test('registration UI validates confirmation and enters the student dashboard',async()=>{
 const ui=await uiFixture();const {$,wait,submit,dom,errors}=ui;
 try {
  $('#show-register').click();await wait(()=>$('#reg-department').options.length>1);await wait(ui.sessionSettled);await new Promise(r=>setTimeout(r,20));assert.ok($('#login-form').classList.contains('hidden'));
  $('#reg-number').value='2026-UI01';$('#reg-name').value='UI Student';$('#reg-course').value='BSIT-1A';$('#reg-password').value='ui-student-password';$('#reg-confirm').value='different-password';
  submit('#register-form');assert.match($('#register-error').textContent,/do not match/);
  $('#reg-confirm').value='ui-student-password';submit('#register-form');await wait(()=>!$('#app').classList.contains('hidden'));await wait(()=>$('#page-content').textContent.includes('Welcome back'));
  assert.match($('#sidebar-user').textContent,/UI Student/);assert.ok(!$('#sidebar-nav').textContent.includes('User Accounts'));assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
test('admin UI signs in, renders overview, creates faculty and filters accounts',async()=>{
 const ui=await uiFixture();const {$,wait,submit,dom,win,errors}=ui;
 try {
  $('[data-role="admin"]').click();assert.equal($('#login-id-label').textContent,'Administrator Username');assert.ok($('#signup-invite').classList.contains('hidden'));
  $('#login-email').value='admin';$('#login-password').value='admin-test-password';submit('#login-form');await wait(()=>!!$('#overview-accounts'));
  assert.match($('#page-content').textContent,/A clear view of your IT department/);assert.match($('#sidebar-nav').textContent,/IT Department Reports/);
  $('#overview-accounts').click();await wait(()=>!!$('#admin-create-faculty'));$('#admin-create-faculty').click();assert.ok(!$('#modal-overlay').classList.contains('hidden'));
  $('#create-name').value='UI Faculty';$('#create-id').value='FAC-UI';$('#create-password').value='ui-faculty-password';submit('#account-dialog-form');await wait(()=>$('#modal-overlay').classList.contains('hidden'));
  $('#account-search').value='FAC-UI';$('#account-search').dispatchEvent(new win.Event('input'));assert.equal($('#account-result-count').textContent,'1 account');assert.match($('#account-table').textContent,/UI Faculty/);
  $('[data-user-edit]').click();$('#edit-name').value='UI Faculty Updated';submit('#account-dialog-form');await wait(()=>$('#modal-overlay').classList.contains('hidden'));await wait(()=>$('#account-table').textContent.includes('UI Faculty Updated'));
  assert.equal((await login('FAC-UI','faculty','ui-faculty-password')).status,200);assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
test('repeated bad logins are throttled',async()=>{let r;for(let i=0;i<31;i++)r=await login('does-not-exist@dll.edu.ph','student','wrong');assert.equal(r.status,429);});
