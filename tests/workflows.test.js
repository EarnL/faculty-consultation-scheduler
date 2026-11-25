const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {createSchedulingService}=require('../scheduling');
let db,dir,child,base,student,other,faculty,admin;
const dateAfter=n=>new Date(Date.now()+n*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
async function request(url,method='GET',body,cookie){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',Connection:'close',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const login=async(email,role='student',password='123456')=>request('/api/login','POST',{email,role,password});
async function windowOn(date,start='18:00',end='22:00',duration=30){const r=await request('/api/schedule','POST',{specific_date:date,start_time:start,end_time:end,slot_duration:duration},faculty);assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;}
async function book(date,start='18:00',end='18:30',cookie=student,purpose='Workflow test'){const r=await request('/api/appointments','POST',{faculty_id:4,date,time_slot:start,end_time:end,purpose},cookie);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.id;}
before(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'dll-workflows-'));base='http://localhost:'+(43000+Math.floor(Math.random()*10000));
  const env={...process.env,PORT:base.split(':').at(-1),DB_PATH:path.join(dir,'test.db'),SESSION_DB_PATH:path.join(dir,'sessions.db'),SESSION_SECRET:'workflow-tests'};
  child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env});let logs='';child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);
  for(let i=0;i<200;i++){try{await fetch(base);break;}catch{if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}}
  db=new Database(path.join(dir,'test.db'));student=(await login('student@dll.edu.ph')).cookie;other=(await login('mgarcia@dll.edu.ph')).cookie;faculty=(await login('faculty@dll.edu.ph','faculty')).cookie;
  const setup=spawnSync(process.execPath,['scripts/setup-admin.js'],{cwd:path.resolve(__dirname,'..'),env:{...env,ADMIN_PASSWORD:'workflow-admin-password'},encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
  admin=(await login('admin','admin','workflow-admin-password')).cookie;assert.ok(student&&other&&faculty&&admin);
});
after(async()=>{if(child){child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}db?.close();if(dir)fs.rmSync(dir,{recursive:true,force:true});});

test('partial-day blocking preserves outside slots and faculty-controlled durations',async()=>{
  const date=dateAfter(30);await windowOn(date);
  const block=await request('/api/blocked-dates','POST',{date,start_time:'19:00',end_time:'20:00',reason:'Department meeting'},faculty);assert.equal(block.status,201);
  const slots=(await request('/api/faculty/4/slots?date='+date,'GET',null,student)).data;
  assert.ok(slots.some(s=>s.start==='18:30'&&s.end==='19:00'));assert.ok(slots.some(s=>s.start==='20:00'));assert.ok(!slots.some(s=>s.start>='19:00'&&s.start<'20:00'));
  assert.equal((await request('/api/appointments','POST',{faculty_id:4,date,time_slot:'19:00',end_time:'19:30',purpose:'Blocked'},student)).status,409);
  assert.equal((await request('/api/appointments','POST',{faculty_id:4,date,time_slot:'18:00',end_time:'18:15',purpose:'Wrong duration'},student)).status,409);
  assert.equal((await request('/api/blocked-dates','POST',{date,start_time:'20:00',end_time:'19:00'},faculty)).status,400);
  assert.equal((await request('/api/blocked-dates','POST',{date},faculty)).status,409);
});
test('editing/removing hours and adding blocks flag affected appointments without changing them',async()=>{
  const date=dateAfter(31),window=await windowOn(date),id=await book(date);
  const before=db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  for(const [url,method,body] of [
    ['/api/schedule/'+window,'PUT',{specific_date:date,start_time:'19:00',end_time:'22:00',slot_duration:30}],
    ['/api/schedule/'+window,'DELETE',null],
    ['/api/blocked-dates','POST',{date,start_time:'18:00',end_time:'18:30',reason:'Conflicting meeting'}]
  ]){const r=await request(url,method,body,faculty);assert.equal(r.status,409);assert.ok(r.data.affected_appointments.some(a=>a.id===id));}
  assert.deepEqual(db.prepare('SELECT * FROM appointments WHERE id=?').get(id),before);assert.equal(db.prepare('SELECT start_time FROM faculty_schedules WHERE id=?').get(window).start_time,'18:00');
  assert.equal((await request('/api/schedule/'+window,'PUT',{specific_date:date,start_time:'18:00',end_time:'23:00',slot_duration:30},faculty)).status,200);
});
test('student reschedule keeps original booking and rechecks conflicts atomically on approval',async()=>{
  const date=dateAfter(32),next=dateAfter(33);await windowOn(date);await windowOn(next);const id=await book(date);assert.equal((await request('/api/appointments/'+id,'PUT',{status:'approved'},faculty)).status,200);
  const original=db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  const created=await request('/api/appointments/'+id+'/reschedule','POST',{date:next,time_slot:'18:00',end_time:'18:30',reason:'Another academic commitment'},student);assert.equal(created.status,201);const rid=created.data.id;
  assert.equal(db.prepare('SELECT date FROM appointments WHERE id=?').get(id).date,date);
  assert.ok(!(await request('/api/faculty/4/slots?date='+date,'GET',null,other)).data.some(s=>s.start==='18:00'));
  assert.equal((await request('/api/reschedules/'+rid,'PUT',{action:'approve'},student)).status,403);
  assert.equal((await request('/api/appointments/'+id+'/history','GET',null,other)).status,403);
  assert.equal((await request('/api/appointments/'+id+'/reschedule','POST',{date:next,time_slot:'18:30',end_time:'19:00',reason:'Duplicate'},student)).status,409);
  const conflicting=await book(next,'18:00','18:30',other);assert.equal((await request('/api/reschedules/'+rid,'PUT',{action:'approve'},faculty)).status,409);
  assert.equal(db.prepare('SELECT date FROM appointments WHERE id=?').get(id).date,date);assert.equal((await request('/api/appointments/'+conflicting,'PUT',{status:'cancelled'},other)).status,200);
  assert.equal((await request('/api/reschedules/'+rid,'PUT',{action:'approve'},faculty)).status,200);
  const moved=db.prepare('SELECT * FROM appointments WHERE id=?').get(id);assert.equal(moved.date,next);assert.equal(moved.status,'approved');assert.equal(moved.queue_number,null);assert.notEqual(moved.checkin_code,original.checkin_code);
  assert.ok((await request('/api/faculty/4/slots?date='+date,'GET',null,other)).data.some(s=>s.start==='18:00'));
  const history=(await request('/api/appointments/'+id+'/history','GET',null,student)).data;assert.ok(history.events.some(e=>e.action==='reschedule_approved'));assert.equal(history.reschedules[0].status,'approved');
});
test('faculty proposals require student acceptance; declines, withdrawal and cancellation preserve history',async()=>{
  const date=dateAfter(34),next=dateAfter(35);await windowOn(date);await windowOn(next);const id=await book(date);
  const propose=()=>request('/api/appointments/'+id+'/reschedule','POST',{date:next,time_slot:'18:00',end_time:'18:30',reason:'Faculty meeting'},faculty);
  let r=await propose();assert.equal(r.status,201);assert.equal((await request('/api/reschedules/'+r.data.id,'PUT',{action:'approve'},faculty)).status,403);assert.equal((await request('/api/reschedules/'+r.data.id,'PUT',{action:'reject',note:'Original slot works best'},student)).status,200);assert.equal(db.prepare('SELECT date FROM appointments WHERE id=?').get(id).date,date);
  r=await propose();assert.equal((await request('/api/reschedules/'+r.data.id,'PUT',{action:'withdraw'},faculty)).status,200);
  r=await propose();assert.equal((await request('/api/reschedules/'+r.data.id,'PUT',{action:'approve'},student)).status,200);assert.equal(db.prepare('SELECT date,status FROM appointments WHERE id=?').get(id).date,next);
  const pending=await request('/api/appointments/'+id+'/reschedule','POST',{date,time_slot:'18:00',end_time:'18:30',reason:'Return to original date'},student);assert.equal(pending.status,201);
  assert.equal((await request('/api/appointments/'+id,'PUT',{status:'cancelled'},faculty)).status,400);
  assert.equal((await request('/api/appointments/'+id,'PUT',{status:'cancelled',reason:'Emergency faculty leave'},faculty)).status,200);assert.equal(db.prepare('SELECT status FROM reschedule_requests WHERE id=?').get(pending.data.id).status,'superseded');
});
test('faculty mark missed only after the scheduled end and students cannot forge status changes',async()=>{
  const past=dateAfter(-1);const id=Number(db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status) VALUES(1,4,?,'08:00','08:30','Missed test','approved')").run(past).lastInsertRowid);
  assert.equal((await request('/api/appointments/'+id,'PUT',{status:'no-show'},student)).status,403);assert.equal((await request('/api/appointments/'+id,'PUT',{status:'no-show',faculty_remarks:'Student did not attend'},faculty)).status,200);assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(id).status,'no-show');
  const future=dateAfter(36);await windowOn(future);const next=await book(future);assert.equal((await request('/api/appointments/'+next,'PUT',{status:'approved'},faculty)).status,200);assert.equal((await request('/api/appointments/'+next,'PUT',{status:'no-show'},faculty)).status,409);
});
test('check-in supersedes unanswered proposals so they do not stay in the review queue',async()=>{
  const next=dateAfter(91);await windowOn(next);const id=Number(db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status,checkin_code) VALUES(1,4,?,'18:00','18:30','Pending proposal at check-in','approved','PENDING-CHECKIN')").run(dateAfter(0)).lastInsertRowid);
  const proposal=await request('/api/appointments/'+id+'/reschedule','POST',{date:next,time_slot:'18:00',end_time:'18:30',reason:'Proposed new time'},student);assert.equal(proposal.status,201);
  db.prepare("UPDATE appointments SET time_slot='00:00',end_time='23:59' WHERE id=?").run(id);
  assert.equal((await request('/api/checkin','POST',{code:'PENDING-CHECKIN'},faculty)).status,200);
  assert.equal(db.prepare('SELECT status FROM reschedule_requests WHERE id=?').get(proposal.data.id).status,'superseded');
});
test('45-minute slots honor anchors and omit incomplete trailing intervals',async()=>{
  const date=dateAfter(37);const id=await windowOn(date,'18:00','20:00',45);
  const slots=(await request('/api/faculty/4/slots?date='+date,'GET',null,student)).data.filter(s=>s.start>='18:00');assert.deepEqual(slots.map(s=>[s.start,s.end]),[['18:00','18:45'],['18:45','19:30']]);
  assert.equal((await request('/api/schedule/'+id,'PUT',{specific_date:date,start_time:'18:00',end_time:'19:31',slot_duration:45},faculty)).status,400);
});
test('in-app reminders are deduplicated for both parties and follow an accepted new time',async()=>{
  const date=dateAfter(40);const id=Number(db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status) VALUES(1,4,?,'18:00','18:30','Reminder test','approved')").run(date).lastInsertRowid);
  const notify=(user,title,message,type,related)=>db.prepare('INSERT INTO notifications(user_id,title,message,type,related_id) VALUES(?,?,?,?,?)').run(user,title,message,type,related);
  const service=createSchedulingService(require('../storage').sqliteAdapter(db),notify);
  assert.equal(await service.reminders(new Date(date+'T17:20:00+08:00')),2);assert.equal(await service.reminders(new Date(date+'T17:21:00+08:00')),0);assert.equal(await service.reminders(new Date(date+'T17:40:00+08:00')),2);assert.equal(await service.reminders(new Date(date+'T17:41:00+08:00')),0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM reminder_deliveries WHERE appointment_id=?').get(id).count,4);
  const next=dateAfter(41);db.prepare('UPDATE appointments SET date=? WHERE id=?').run(next,id);assert.equal(await service.reminders(new Date(next+'T17:45:00+08:00')),2);db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(id);assert.equal(await service.reminders(new Date(next+'T17:46:00+08:00')),0);
});
test('admin records and exports include cancellations, search, filters and pagination',async()=>{
  const date=dateAfter(50),insert=db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status) VALUES(1,4,?,'18:00','18:30',?,'cancelled')");for(let i=0;i<30;i++)insert.run(date,'Pagination record '+i);
  assert.equal((await request('/api/admin/appointments','GET',null,student)).status,403);
  const params=new URLSearchParams({status:'cancelled',q:'Pagination',start_date:date,end_date:date,faculty_id:'4'});
  const first=(await request('/api/admin/appointments?'+params,'GET',null,admin)).data;assert.equal(first.total,30);assert.equal(first.appointments.length,25);assert.ok(first.appointments.every(a=>a.status==='cancelled'));
  const second=(await request('/api/admin/appointments?'+params+'&page=2','GET',null,admin)).data;assert.equal(second.appointments.length,5);
  const exported=await request('/api/analytics/export?'+params,'GET',null,admin);assert.equal(exported.status,200);assert.equal((exported.data.match(/Pagination record/g)||[]).length,30);
  const stats=(await request('/api/analytics?'+params,'GET',null,admin)).data;assert.equal(stats.kpis.total,30);assert.equal(stats.kpis.cancelled,30);assert.ok(stats.status_distribution.some(s=>s.status==='cancelled'&&s.count===30));
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
});

test('concurrent requests cannot reserve the same faculty slot',async()=>{
  const date=dateAfter(80);await windowOn(date);const body={faculty_id:4,date,time_slot:'18:00',end_time:'18:30',purpose:'Concurrent booking check'};
  const results=await Promise.all([request('/api/appointments','POST',body,student),request('/api/appointments','POST',body,other)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(db.prepare("SELECT count(*) AS count FROM appointments WHERE faculty_id=4 AND date=? AND time_slot='18:00'").get(date).count,1);
});

async function fixture(){
  const {JSDOM,VirtualConsole}=require('jsdom');const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(fs.readFileSync(path.resolve(__dirname,'../public/index.html'),'utf8'),{url:base+'/#login',runScripts:'outside-only',virtualConsole:console});let cookie;
  const win=dom.window;win.scrollTo=()=>{};
  // jsdom does not implement native dialog interaction; mirror its open/close lifecycle.
  win.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  win.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new win.Event('close'));};
  win.fetch=async(url,opts={})=>{const r=await request(url,opts.method||'GET',opts.body?JSON.parse(opts.body):undefined,cookie);if(r.cookie)cookie=r.cookie;return {ok:r.status>=200&&r.status<300,json:async()=>r.data};};
  for(const file of ['account-screens.js','workflow-screens.js','faculty-directory.js','consultation-pass.js','portal-header.js','profile-screen.js','consultation-overview.js','app.js'])win.eval(fs.readFileSync(path.resolve(__dirname,'../public/js/'+file),'utf8'));
  const $=selector=>win.document.querySelector(selector),wait=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}assert.fail('UI timeout: '+$('#page-content').textContent+' '+$('#wf-dialog-error')?.textContent+' '+errors.join('\n'));};
  const submit=selector=>$(selector).dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
  const signIn=async(role)=>{await new Promise(r=>setTimeout(r,100));$('[data-role="'+role+'"]').click();$('#login-email').value=role==='admin'?'admin':role==='faculty'?'faculty@dll.edu.ph':'student@dll.edu.ph';$('#login-password').value=role==='admin'?'workflow-admin-password':'123456';submit('#login-form');await wait(()=>!$('#app').classList.contains('hidden'));};
  return {dom,win,$,wait,submit,signIn,errors};
}
test('availability UI edits duration and creates a specific-hours block',async()=>{
  const ui=await fixture(),{$,wait,submit,signIn,win}=ui;const date=dateAfter(60);
  try{await signIn('faculty');$('[data-page="fac-availability"]').click();await wait(()=>!!$('#wf-add-hours'));$('#wf-add-hours').click();$('#wf-hours-type').value='date';$('#wf-hours-type').dispatchEvent(new win.Event('change'));$('#wf-hours-date').value=date;$('#wf-hours-start').value='18:00';$('#wf-hours-end').value='20:00';$('#wf-hours-duration').value='45';submit('#wf-dialog-form');await wait(()=>$('#modal-overlay').classList.contains('hidden'));assert.match($('#page-content').textContent,/45-minute slots/);
    $('#wf-block-time').click();$('#wf-block-date').value=date;$('[name="block_type"][value="hours"]').click();assert.ok(!$('#wf-block-range').classList.contains('hidden'));$('#wf-block-start').value='18:45';$('#wf-block-end').value='19:30';$('#wf-block-reason').value='UI meeting';submit('#wf-dialog-form');await wait(()=>$('#modal-overlay').classList.contains('hidden'));assert.match($('#page-content').textContent,/18:45–19:30/);const slots=(await request('/api/faculty/4/slots?date='+date,'GET',null,student)).data;assert.ok(slots.some(s=>s.start==='18:00'&&s.end==='18:45'));assert.ok(!slots.some(s=>s.start==='18:45'));assert.deepEqual(ui.errors,[]);
  }finally{ui.dom.window.close();}
});
test('faculty calendar shows off-hour appointments on the correct day and week',async()=>{
  let date=dateAfter(63);while(new Date(date+'T12:00:00Z').getUTCDay()!==1)date=new Date(new Date(date+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);
  const next=new Date(new Date(date+'T12:00:00Z').getTime()+7*86400000).toISOString().slice(0,10),insert=db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status) VALUES(1,4,?,'18:15','18:30',?,'approved')");insert.run(date,'Off-hour calibration');insert.run(next,'Different-week appointment');
  const ui=await fixture(),{$,wait,win}=ui;
  try{await ui.signIn('faculty');$('[data-page="fac-schedule"]').click();await wait(()=>!!$('#wf-calendar-jump'));$('#wf-calendar-jump').value=date;$('#wf-calendar-jump').dispatchEvent(new win.Event('change'));assert.match($('#wf-calendar-body').textContent,/18:15/);assert.match($('#wf-calendar-body').textContent,/Off-hour calibration/);assert.ok(!$('#wf-calendar-body').textContent.includes('Different-week appointment'));
    $('[data-calendar-view="day"]').click();assert.match($('#wf-calendar-body').textContent,/18:15/);$('[data-calendar-view="month"]').click();assert.equal(win.document.querySelectorAll('.wf-month-day').length,42);assert.deepEqual(ui.errors,[]);
  }finally{ui.dom.window.close();}
});
test('student and faculty UI complete a reschedule request without losing the original booking',async()=>{
  const date=dateAfter(72),next=dateAfter(73);await windowOn(date);await windowOn(next);const id=await book(date);assert.equal((await request('/api/appointments/'+id,'PUT',{status:'approved'},faculty)).status,200);
  let ui=await fixture();
  try{const {$,wait,win,submit}=ui;await ui.signIn('student');$('[data-page="appointments"]').click();await wait(()=>!!$('[data-wf-action="'+id+'"]'));const action=$('[data-wf-action="'+id+'"]');action.value='reschedule';action.dispatchEvent(new win.Event('change'));await wait(()=>!!$('#wf-reschedule-date'));$('#wf-reschedule-date').value=next;$('#wf-reschedule-date').dispatchEvent(new win.Event('change'));await wait(()=>!$('#wf-reschedule-slot').disabled&&$('#wf-reschedule-slot').options.length>1);$('#wf-reschedule-slot').value='18:00|18:30';$('#wf-reschedule-reason').value='UI reschedule request';submit('#wf-dialog-form');await wait(()=>$('#modal-overlay').classList.contains('hidden'));assert.equal(db.prepare('SELECT date FROM appointments WHERE id=?').get(id).date,date);assert.match($('#page-content').textContent,/Waiting for a response/);assert.deepEqual(ui.errors,[]);
  }finally{ui.dom.window.close();}
  const rid=db.prepare("SELECT id FROM reschedule_requests WHERE appointment_id=? AND status='pending'").get(id).id;ui=await fixture();
  try{const {$,wait,submit}=ui;await ui.signIn('faculty');$('[data-page="fac-requests"]').click();await wait(()=>!!$('[data-wf-reply="'+rid+'"][data-response="approve"]'));$('[data-wf-reply="'+rid+'"][data-response="approve"]').click();submit('#wf-dialog-form');await wait(()=>$('#modal-overlay').classList.contains('hidden'));assert.equal(db.prepare('SELECT date FROM appointments WHERE id=?').get(id).date,next);assert.deepEqual(ui.errors,[]);
  }finally{ui.dom.window.close();}
});

test('admin records UI filters cancelled appointments and paginates all matching records',async()=>{
  const ui=await fixture(),{$,wait,win}=ui;
  try{await ui.signIn('admin');await wait(()=>!!$('[data-page="admin-records"]'));$('[data-page="admin-records"]').click();await wait(()=>!!$('#wf-record-status'));$('#wf-record-status').value='cancelled';$('#wf-record-status').dispatchEvent(new win.Event('change'));$('#wf-record-search').value='Pagination';$('#wf-record-search').dispatchEvent(new win.Event('input'));await wait(()=>$('#wf-record-count').textContent==='30 matching appointments');assert.equal(win.document.querySelectorAll('#wf-record-table tbody tr').length,25);$('#wf-record-next').click();await wait(()=>$('#wf-record-page').textContent==='Page 2 of 2');assert.equal(win.document.querySelectorAll('#wf-record-table tbody tr').length,5);assert.deepEqual(ui.errors,[]);
  }finally{ui.dom.window.close();}
});

test('interactive directory carries a selected slot into booking and prevents stale selections',async()=>{
  const date=dateAfter(7);await windowOn(date,'20:00','21:00',30);
  const ui=await fixture();const {$,wait,win}=ui;
  try{
    await ui.signIn('student');$('[data-page="directory"]').click();await wait(()=>!!$('[data-faculty="4"]'));
    assert.equal($('.fd-logo').getAttribute('src'),'/images/it-department-logo.png');
    $('#dir-search').value='no faculty matches this';$('#dir-search').dispatchEvent(new win.Event('input'));assert.match($('#dir-results-container').textContent,/No faculty match/);
    $('#dir-search').value='';$('#dir-search').dispatchEvent(new win.Event('input'));$('[data-faculty="4"]').click();await wait(()=>!!$('#fd-date'));
    $('#fd-date').value=date;$('#fd-date').dispatchEvent(new win.Event('change'));await wait(()=>!!$('.fd-slot'));assert.ok($('#fd-book').disabled);
    $('.fd-slot[data-start="20:00"]').click();assert.equal($('.fd-slot[data-start="20:00"]').getAttribute('aria-pressed'),'true');assert.ok(!$('#fd-book').disabled);
    const selected=(await request('/api/faculty/4/slots?date='+date,'GET',null,student)).data.find(s=>s.start==='20:00');
    const id=await book(date,selected.start,selected.end,other,'Competing directory booking');
    $('#fd-book').click();await wait(()=>$('#fd-selection')?.textContent.includes('no longer available'));assert.ok($('#fd-book').disabled);assert.ok($('.fd-profile-page'));
    assert.equal((await request('/api/appointments/'+id,'PUT',{status:'cancelled'},other)).status,200);
    $('#fd-date').dispatchEvent(new win.Event('change'));await wait(()=>!!$('.fd-slot[data-start="20:00"]'));$('.fd-slot[data-start="20:00"]').click();$('#fd-book').click();
    await wait(()=>!!$('#b-purpose'));assert.ok(!$('.fd-profile-page'));assert.match($('#booking-area').textContent,/20:00/);assert.match($('#booking-area').textContent,new RegExp(date));
    $('#b-purpose').value='Directory booking handoff';$('#submit-booking').click();await wait(()=>!!$('#confirm-book'));$('#confirm-book').click();await wait(()=>db.prepare("SELECT id FROM appointments WHERE purpose='Directory booking handoff' AND date=? AND time_slot='20:00' AND status='pending'").get(date));
    await wait(()=>!!$('#booking-receipt-view'));assert.match($('#modal-body').textContent,/Awaiting faculty approval/);$('#booking-receipt-view').click();await wait(()=>$('#modal-overlay').classList.contains('hidden'));assert.deepEqual(ui.errors,[]);
  }finally{ui.dom.window.close();}
});

test('admin directory is read-only and departments page is absent',async()=>{
 const ui=await fixture();const {$,wait}=ui;
 try{await ui.signIn('admin');await wait(()=>!!$('#overview-accounts'));assert.equal($('[data-page="admin-departments"]'),null);assert.equal($('[data-admin-page="admin-departments"]'),null);assert.ok(!$('#page-content').textContent.includes('organize departments'));
 $('[data-page="directory"]').click();await wait(()=>!!$('[data-faculty="4"]'));$('[data-faculty="4"]').click();await wait(()=>!!$('#fd-date'));assert.ok($('#page-content .fd-profile-page'));assert.equal($('dialog.fd-dialog'),null);assert.equal($('#dir-search'),null);assert.equal($('#fd-book'),null);assert.match($('.fd-booking-footer').textContent,/Students can request/);$('.fd-close').click();assert.equal($('.fd-profile-page'),null);assert.ok($('#dir-search'));assert.ok($('[data-faculty="4"]'));assert.deepEqual(ui.errors,[]);
 }finally{ui.dom.window.close();}
});

test('faculty-only arrival review, approved passes, duplicate safety and scheduled queue order',async()=>{
 const today=dateAfter(0);
 const add=(start,end,code,status='approved',sid=1)=>Number(db.prepare('INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status,checkin_code) VALUES(1,4,?,?,?,?,?,?)').run(today,start,end,'Arrival verification',status,code).lastInsertRowid);
 const id=add('00:00','23:59','PASS-REVIEW'),pending=add('01:00','01:30','PASS-PENDING','pending');
 assert.equal((await request('/api/appointments/'+pending+'/pass','GET',null,student)).status,409);
 assert.equal((await request('/api/appointments/'+id+'/pass','GET',null,other)).status,404);
 assert.equal((await request('/api/checkin','POST',{code:'PASS-REVIEW'},student)).status,403);
 const preview=await request('/api/checkin/review','POST',{code:'PASS-REVIEW'},faculty);assert.equal(preview.status,200);assert.equal(preview.data.eligible,true);assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(id).status,'approved');
 const confirmed=await request('/api/checkin','POST',{code:'PASS-REVIEW'},faculty);assert.equal(confirmed.status,200);
 const duplicate=await request('/api/checkin','POST',{code:'PASS-REVIEW'},faculty);assert.equal(duplicate.data.already_checked_in,true);assert.equal(duplicate.data.appointment.checkin_time,confirmed.data.appointment.checkin_time);
 assert.equal(db.prepare("SELECT count(*) n FROM appointment_events WHERE appointment_id=? AND action='checked_in'").get(id).n,1);
 const otherFaculty=(await login(db.prepare('SELECT email FROM users WHERE id=5').get().email,'faculty')).cookie;assert.equal((await request('/api/checkin/review','POST',{code:'PASS-REVIEW'},otherFaculty)).status,404);
 const late=add('00:00','00:01','PASS-LATE');assert.equal((await request('/api/checkin','POST',{appointment_id:late},faculty)).status,409);assert.equal((await request('/api/checkin','POST',{appointment_id:late,late_reason:'Student arrived late; faculty accepted.'},faculty)).status,200);
 const ordered=(await request('/api/queue','GET',null,faculty)).data.waiting_queue;assert.ok(ordered.every((a,i)=>!i||ordered[i-1].time_slot<=a.time_slot));
});

test('faculty manual lookup reviews before confirming arrival without a QR',async()=>{
 const id=Number(db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status,checkin_code) VALUES(1,4,?,'00:00','23:59','Manual arrival UI','approved','PASS-MANUAL-UI')").run(dateAfter(0)).lastInsertRowid);
 const ui=await fixture(),{$,wait,submit}=ui;
 try{await ui.signIn('faculty');$('[data-page="fac-queue"]').click();await wait(()=>!!$('#btn-open-scanner'));$('#btn-open-scanner').click();$('#pass-search-tab').click();await wait(()=>!$('#pass-search-form').classList.contains('hidden'));$('#pass-student-number').value=db.prepare('SELECT student_id FROM users WHERE id=1').get().student_id;submit('#pass-search-form');await wait(()=>!!$('[data-pass-id="'+id+'"]'));$('[data-pass-id="'+id+'"]').click();await wait(()=>!!$('#pass-confirm-arrival'));assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(id).status,'approved');$('#pass-confirm-arrival').click();await wait(()=>$('#modal-overlay').classList.contains('hidden'));assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(id).status,'checked-in');assert.deepEqual(ui.errors,[]);}finally{ui.dom.window.close();}
});

test('portal header toggles desktop/mobile sidebar and previews notifications',async()=>{
 db.prepare("INSERT INTO notifications(user_id,title,message,type,created_at) VALUES(1,'Header preview test','Read this appointment update.','info',datetime('now','+1 day'))").run();
 const ui=await fixture(),{$,wait,win}=ui;
 try{await ui.signIn('student');assert.ok($('#header-page-title'));await wait(()=>!$('#header-notif-count').hidden);assert.equal($('#menu-toggle').hidden,true);$('#sidebar-dismiss').click();assert.equal($('#menu-toggle').hidden,false);assert.ok($('#app').classList.contains('sidebar-collapsed'));assert.equal($('#menu-toggle').getAttribute('aria-expanded'),'false');$('#menu-toggle').click();assert.equal($('#menu-toggle').getAttribute('aria-expanded'),'true');assert.equal($('#menu-toggle').hidden,true);assert.equal($('[data-page="dashboard"]').getAttribute('aria-current'),'page');
 $('#mobile-notif-btn').click();await wait(()=>!$('#header-notifications').hidden&&$('#header-notification-list').textContent.includes('Header preview test'));assert.ok($('#header-notification-list .is-unread'));$('#header-notification-list [data-notification]').click();await wait(()=>!!$('#mark-all-read'));assert.equal($('#header-notifications').hidden,true);assert.equal(db.prepare("SELECT is_read FROM notifications WHERE title='Header preview test'").get().is_read,1);
 Object.defineProperty(win,'innerWidth',{value:700,configurable:true});win.dispatchEvent(new win.Event('resize'));$('#menu-toggle').click();assert.ok($('#sidebar').classList.contains('open'));assert.equal($('#menu-toggle').hidden,true);assert.equal($('#main-content').inert,true);$('#sidebar-dismiss').click();assert.ok(!$('#sidebar').classList.contains('open'));assert.equal($('#main-content').inert,false);assert.equal($('#menu-toggle').hidden,false);$('#menu-toggle').click();$('#btn-logout').focus();win.document.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(win.document.activeElement.id,'sidebar-dismiss');win.document.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(win.document.activeElement.id,'btn-logout');win.document.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal($('#menu-toggle').hidden,false);assert.equal(win.document.activeElement.id,'menu-toggle');assert.equal(win.document.body.classList.contains('navigation-drawer-open'),false);assert.deepEqual(ui.errors,[]);
 }finally{ui.dom.window.close();}
});

test('student pass fetches current approval and encodes only the opaque reference',async()=>{
 const id=Number(db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status,checkin_code) VALUES(1,4,?,'20:00','20:30','Pass privacy UI','approved','OPAQUE-PASS-UI')").run(dateAfter(9)).lastInsertRowid);
 const ui=await fixture(),{$,wait,win}=ui;let encoded;
 win.QRCode=function(box,options){encoded=options.text;box.textContent='QR rendered';};win.QRCode.CorrectLevel={M:0};
 try{await ui.signIn('student');$('[data-page="appointments"]').click();await wait(()=>!!$('[data-wf-action="'+id+'"]'));let action=$('[data-wf-action="'+id+'"]');action.value='qr';action.dispatchEvent(new win.Event('change'));await wait(()=>!!$('.pass-brand'));assert.equal(encoded,'OPAQUE-PASS-UI');assert.match($('#modal-body').textContent,/Present this pass/);$('#pass-close').click();db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(id);action.value='qr';action.dispatchEvent(new win.Event('change'));await wait(()=>$('#modal-overlay').classList.contains('hidden'));assert.deepEqual(ui.errors,[]);}finally{ui.dom.window.close();}
});

test('faculty consultation instructions are validated, visible and notify upcoming students',async()=>{
 const upcoming=dateAfter(109);await windowOn(upcoming);await book(upcoming);
 assert.equal((await request('/api/profile','PUT',{consultation_location:'Not allowed'},student)).status,403);
 assert.equal((await request('/api/profile','PUT',{meeting_link:'javascript:alert(1)'},faculty)).status,400);
 const result=await request('/api/profile','PUT',{consultation_location:'IT Office 203',meeting_link:'https://example.com/consultation',consultation_instructions:'Bring your project draft.'},faculty);assert.equal(result.status,200);
 const detail=(await request('/api/faculty/4','GET',null,student)).data;assert.equal(detail.consultation_location,'IT Office 203');assert.equal(detail.consultation_instructions,'Bring your project draft.');
 const appointments=(await request('/api/appointments','GET',null,student)).data;assert.ok(appointments.filter(a=>a.faculty_id===4).every(a=>a.meeting_link==='https://example.com/consultation'));
 assert.ok(db.prepare("SELECT id FROM notifications WHERE user_id=1 AND title='Consultation instructions updated'").get());
 const date=dateAfter(110);await windowOn(date);const id=await book(date);assert.equal((await request('/api/appointments/'+id,'PUT',{status:'rejected'},faculty)).status,400);assert.equal((await request('/api/appointments/'+id,'PUT',{status:'rejected',reason:'Please clarify your consultation purpose.'},faculty)).status,200);assert.match(db.prepare('SELECT faculty_remarks FROM appointments WHERE id=?').get(id).faculty_remarks,/clarify/);
});

test('today dashboard flags unattended appointments without changing attendance',async()=>{
 const id=Number(db.prepare("INSERT INTO appointments(student_id,faculty_id,date,time_slot,end_time,purpose,status) VALUES(1,4,?,'00:00','00:01','Unattended dashboard test','approved')").run(dateAfter(-1)).lastInsertRowid);
 const ui=await fixture(),{$,wait}=ui;
 try{await ui.signIn('faculty');await wait(()=>!!$('#consultation-today'));assert.match($('#consultation-today').textContent,/Attendance review/);assert.ok($('[data-attendance-review="'+id+'"]'));assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(id).status,'approved');$('[data-attendance-review="'+id+'"]').click();await wait(()=>!!$('#wf-detail-close'));assert.match($('#modal-body').textContent,/IT Office 203/);assert.deepEqual(ui.errors,[]);}finally{ui.dom.window.close();}
});

test('admin backups are verified, restricted and restore only with deliberate offline confirmation',async()=>{
 assert.equal((await request('/api/admin/backups','POST',null,student)).status,403);const created=await request('/api/admin/backups','POST',null,admin);assert.equal(created.status,201);assert.match(created.data.file,/^portal-backup-/);
 const snapshot=path.join(dir,'backups',created.data.file),target=path.join(dir,'restore-target.db');fs.copyFileSync(snapshot,target);let targetDb=new Database(target);targetDb.prepare("UPDATE users SET name='Temporary restore target' WHERE id=1").run();targetDb.close();
 const sessionPath=path.join(dir,'restore-sessions.db');const sessions=new Database(sessionPath);sessions.exec("CREATE TABLE sessions(sid TEXT PRIMARY KEY,data TEXT,expires INTEGER);INSERT INTO sessions VALUES('old-session','{}',0)");sessions.close();
 const env={...process.env,DB_PATH:target,SESSION_DB_PATH:sessionPath,PORT:'65431'};const refused=spawnSync(process.execPath,['scripts/restore-backup.js','--file',snapshot],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8'});assert.equal(refused.status,1);
 const restored=spawnSync(process.execPath,['scripts/restore-backup.js','--file',snapshot,'--confirm-replace'],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8'});assert.equal(restored.status,0,restored.stderr);const clearedSessions=new Database(sessionPath);assert.equal(clearedSessions.prepare('SELECT count(*) n FROM sessions').get().n,0);clearedSessions.close();targetDb=new Database(target);assert.notEqual(targetDb.prepare('SELECT name FROM users WHERE id=1').get().name,'Temporary restore target');assert.equal(targetDb.pragma('integrity_check',{simple:true}),'ok');targetDb.close();
 assert.equal((await request('/api/admin/backups','GET',null,admin)).data.latest.file,created.data.file);
});

test('profile contact details persist, validate and leave identity unchanged',async()=>{
 const before=(await request('/api/profile','GET',null,student)).data;
 assert.equal((await request('/api/profile','PUT',{contact_number:'abc'},student)).status,400);
 assert.equal((await request('/api/profile','PUT',{contact_email:'not-an-email'},student)).status,400);
 const saved=await request('/api/profile','PUT',{contact_number:'+63 917 123 4567',contact_email:'student.contact@example.com',student_id:'CHANGED-ID'},student);assert.equal(saved.status,200);assert.equal(saved.data.user.contact_number,'+63 917 123 4567');assert.equal(saved.data.user.contact_email,'student.contact@example.com');assert.equal(saved.data.user.student_id,before.student_id);assert.equal(saved.data.user.email,before.email);assert.equal(saved.data.user.password,undefined);
 assert.equal((await request('/api/profile','PUT',{contact_number:'',contact_email:''},student)).status,200);const cleared=(await request('/api/profile','GET',null,student)).data;assert.equal(cleared.contact_number,'');assert.equal(cleared.contact_email,'');
});

test('modern profile saves contact and photo in the header, with password editing in a separate card',async()=>{
 const ui=await fixture(),{$,wait,submit,win}=ui;
 const photo='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 try{await ui.signIn('student');$('#header-profile').click();await wait(()=>!!$('#profile-form'));assert.equal($('#pf-id').readOnly,true);assert.equal($('#pwd-form'),null);$('#pf-contact-number').value='09171234567';$('#pf-contact-email').value='profile.ui@example.com';submit('#profile-form');await wait(()=>db.prepare('SELECT contact_email FROM users WHERE id=1').get().contact_email==='profile.ui@example.com');await wait(()=>!$('#profile-save').disabled);assert.match($('#header-page-title').textContent,/Profile/);
 const file=new win.File([Uint8Array.from(Buffer.from(photo,'base64'))],'avatar.png',{type:'image/png'});Object.defineProperty($('#avatar-file-input'),'files',{value:[file],configurable:true});$('#avatar-file-input').dispatchEvent(new win.Event('change'));await wait(()=>!$('#avatar-preview-bar').classList.contains('hidden'));$('#btn-save-avatar').click();await wait(()=>!!$('#header-profile img'));assert.equal($('#header-profile img').getAttribute('src'),'data:image/png;base64,'+photo);await wait(()=>!!$('#btn-remove-avatar'));assert.equal($('#pf-contact-email').value,'profile.ui@example.com');
 $('#profile-change-password').click();assert.ok($('#pwd-form'));$('#pf-cur-pwd').value='123456';$('#pf-new-pwd').value='profile-ui-new-password';$('#pf-confirm-pwd').value='different-password';submit('#pwd-form');assert.match($('#password-error').textContent,/do not match/);$('#pf-confirm-pwd').value='profile-ui-new-password';submit('#pwd-form');await wait(()=>$('#modal-overlay').classList.contains('hidden'));assert.equal((await login('student@dll.edu.ph','student','profile-ui-new-password')).status,200);assert.deepEqual(ui.errors,[]);
 }finally{ui.dom.window.close();}
});
