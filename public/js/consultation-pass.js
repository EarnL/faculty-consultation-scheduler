window.createConsultationPass=function({api,escapeHtml:e,openModal,closeModal,toast,onCleanup,loadNotifCount}){
 const $=s=>document.querySelector(s);
 const arrival=t=>t?new Date(t.includes('T')?t:t.replace(' ','T')+'+08:00').toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'';
 const details=a=>`${window.consultationVenue(a,e)}<div class="pass-details"><div><span>Student</span><strong>${e(a.student_name)} · ${e(a.student_number||'')}</strong></div><div><span>Faculty</span><strong>${e(a.faculty_name)}</strong></div><div><span>Appointment · Philippine Time</span><strong>${e(a.date)} · ${e(a.time_slot)}–${e(a.end_time)}</strong></div><div><span>Purpose</span><strong>${e(a.purpose)}</strong></div>${a.checkin_time?`<div><span>Original arrival</span><strong>${e(arrival(a.checkin_time))}</strong></div>`:''}</div>`;
 async function show(appt){
  let live=true;
  openModal('Consultation Pass','<p class="pass-notice">Loading your approved appointment pass…</p>','<button class="btn btn-outline" id="pass-loading-close">Close</button>');
  onCleanup(()=>{live=false;});$('#pass-loading-close').onclick=closeModal;
  try{
   const a=await api(`/api/appointments/${appt.id}/pass`);
   if(!live)return;
   openModal('Consultation Pass',`<div class="pass-brand"><img src="/images/it-department-logo.png" alt="IT department logo"><div><strong>IT Consultation Pass</strong><span>${e(a.status==='checked-in'?'Arrival confirmed':'Approved appointment')}</span></div></div>${details(a)}${a.status==='approved'?'<div id="modal-qr-canvas" class="pass-qr"></div><p class="pass-instruction">Present this pass to your faculty member when you arrive.</p>':'<p class="pass-notice">Already checked in. You do not need to scan again.</p>'}<p class="pass-notice">Check-in opens 15 minutes before your appointment. Your scheduled order is preserved. If you cannot show this pass, faculty can find your appointment using your student number.</p>`, '<button class="btn btn-outline" id="pass-close">Close</button>');
   $('#pass-close').onclick=closeModal;
   if(a.status==='approved'){
    const box=$('#modal-qr-canvas');
    if(a.checkin_code)box.insertAdjacentHTML('afterend',`<details class="pass-manual-code"><summary>Show manual verification code</summary><code>${e(a.checkin_code)}</code></details>`);
    if(window.QRCode&&a.checkin_code){try{new QRCode(box,{text:a.checkin_code,width:200,height:200,colorDark:'#0b1d33',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});}catch{box.textContent='QR unavailable. Faculty can look up your student number.';}}
    else box.textContent='QR unavailable. Faculty can look up your student number.';
   }
  }catch(err){if(live){closeModal();toast(err.message,'error');}}
 }
 function scan(onSuccess){
  let scanner=null,alive=true,busy=false;
  async function stop(){if(scanner){const active=scanner;scanner=null;try{await active.stop();}catch{}try{await active.clear();}catch{}}}
  openModal('Confirm student arrival',`<p class="pass-notice">Review the appointment before confirming arrival. The QR is optional; student-number lookup works without a camera.</p><div class="pass-tabs"><button class="btn btn-outline" id="pass-camera">Scan QR</button><button class="btn btn-outline" id="pass-code-tab">Enter code</button><button class="btn btn-outline" id="pass-search-tab">Student number</button></div><div id="pass-camera-area" class="hidden"><div id="qr-reader"></div><p class="pass-notice">Point the camera at the student's consultation pass.</p></div><form id="pass-code-form"><label class="field">Appointment code<input id="manual-verify-code" maxlength="100" autocomplete="off" required placeholder="Enter the appointment code"></label><button class="btn btn-primary" id="btn-submit-manual-code">Review appointment</button></form><form id="pass-search-form" class="hidden"><label class="field">Student number<input id="pass-student-number" maxlength="30" required placeholder="Enter the student's number"></label><button class="btn btn-primary">Find today's appointments</button></form><div id="checkin-result" aria-live="polite"></div>`, '<button class="btn btn-outline" id="btn-close-scanner">Close</button>');
  onCleanup(()=>{alive=false;void stop();});$('#btn-close-scanner').onclick=closeModal;
  const result=$('#checkin-result');
  function error(err){if(alive)result.innerHTML=`<p class="pass-error" role="alert">${e(err.message)}</p>`;}
  async function review(payload){
   if(busy||!alive)return;busy=true;result.innerHTML='<p class="pass-notice">Reviewing appointment…</p>';await stop();
   try{
    const r=await api('/api/checkin/review',{method:'POST',body:payload});if(!alive)return;
    result.innerHTML=`<section class="pass-review"><h3>Review arrival</h3>${details(r.appointment)}<p class="pass-notice">${e(r.message)}</p>${r.late?'<label class="field">Late arrival reason<textarea id="pass-late-reason" minlength="5" maxlength="500" placeholder="Explain why this late arrival is being accepted"></textarea></label>':''}${r.eligible||r.late?'<button class="btn btn-primary" id="pass-confirm-arrival">Confirm arrival</button>':''}</section>`;
    $('#pass-confirm-arrival')?.addEventListener('click',async()=>{
     const button=$('#pass-confirm-arrival');const late_reason=$('#pass-late-reason')?.value.trim();
     if(r.late&&(!late_reason||late_reason.length<5)){toast('Enter a late arrival reason of at least 5 characters.','error');return;}
     button.disabled=true;
     try{const saved=await api('/api/checkin',{method:'POST',body:{...payload,...(late_reason?{late_reason}:{})}});if(!alive)return;toast(saved.already_checked_in?'Already checked in; original arrival preserved.':'Student arrival confirmed.','success');closeModal();if(onSuccess)onSuccess(saved.appointment);loadNotifCount();}
     catch(err){error(err);}
    });
   }catch(err){error(err);}finally{busy=false;}
  }
  $('#pass-code-form').onsubmit=event=>{event.preventDefault();review({code:$('#manual-verify-code').value.trim()});};
  $('#pass-search-form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;result.innerHTML='<p class="pass-notice">Finding appointments…</p>';try{const list=await api('/api/checkin/search?student_number='+encodeURIComponent($('#pass-student-number').value.trim()));if(!alive)return;result.innerHTML=list.length?list.map(a=>`<button class="pass-search-result" data-pass-id="${a.id}"><strong>${e(a.student_name)}</strong><span>${e(a.time_slot)}–${e(a.end_time)} · ${e(a.status)}</span></button>`).join(''):'<p class="pass-notice">No approved appointments for this student with you today.</p>';result.querySelectorAll('[data-pass-id]').forEach(b=>b.onclick=()=>review({appointment_id:Number(b.dataset.passId)}));}catch(err){error(err);}finally{busy=false;}};
  async function tab(mode){await stop();if(!alive)return;$('#pass-camera-area').classList.toggle('hidden',mode!=='camera');$('#pass-code-form').classList.toggle('hidden',mode!=='code');$('#pass-search-form').classList.toggle('hidden',mode!=='search');result.innerHTML='';
   if(mode==='camera'){
    if(!window.Html5Qrcode){error(Error('Camera scanner unavailable. Use student-number lookup or enter a code.'));return;}
    try{const active=new Html5Qrcode('qr-reader');scanner=active;await active.start({facingMode:'environment'},{fps:10,qrbox:{width:220,height:220}},code=>{if(!busy)review({code:code.trim()});},()=>{});if(!alive||scanner!==active){try{await active.stop();}catch{}}}catch{if(alive)error(Error('Camera unavailable. Use student-number lookup or enter a code.'));}
   }
  }
  $('#pass-camera').onclick=()=>tab('camera');$('#pass-code-tab').onclick=()=>tab('code');$('#pass-search-tab').onclick=()=>tab('search');
 }
 return {show,scan};
};
