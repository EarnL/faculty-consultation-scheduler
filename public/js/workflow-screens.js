window.createWorkflowScreens = function({api,escapeHtml:e,openModal,closeModal,toast,navigate,currentUser,showQRPassModal}) {
  const $=s=>document.querySelector(s);
  const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const statuses=['pending','approved','checked-in','completed','cancelled','rejected','no-show'];
  const labels={pending:'Pending',approved:'Approved','checked-in':'Checked in',completed:'Completed',cancelled:'Cancelled',rejected:'Rejected','no-show':'Missed'};
  const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
  const dateObject=d=>new Date(d+'T12:00:00Z');
  const addDays=(d,n)=>{const x=dateObject(d);x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const formatDate=(d,opts={month:'short',day:'numeric',year:'numeric'})=>dateObject(d).toLocaleDateString('en-PH',{...opts,timeZone:'UTC'});
  const startOfWeek=d=>addDays(d,-((dateObject(d).getUTCDay()+6)%7));
  const badge=s=>`<span class="badge ${e(s)}">${e(labels[s]||s)}</span>`;
  const options=(selected='')=>`<option value="">All statuses</option>${statuses.map(s=>`<option value="${s}" ${s===selected?'selected':''}>${labels[s]}</option>`).join('')}`;
  const header=(eyebrow,title,subtitle,actions='')=>`<div class="account-page-header"><div><span class="account-eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div><div class="wf-header-actions">${actions}</div></div>`;
  const empty=(title,message)=>`<div class="wf-empty"><span class="wf-empty-icon">◷</span><h3>${title}</h3><p>${message}</p></div>`;
  const loading=el=>{el.innerHTML='<div class="account-loading">Getting your consultation workspace ready…</div>';};
  const error=(el,err,retry)=>{el.innerHTML=`<div class="card wf-empty"><h3>We couldn’t load this page</h3><p role="alert">${e(err.message)}</p><button class="btn btn-outline" id="wf-retry">Try again</button></div>`;$('#wf-retry').onclick=retry;};
  const footer=label=>`<button class="btn btn-outline" id="wf-dialog-cancel" type="button">Cancel</button><button class="btn btn-primary" id="wf-dialog-save" type="submit" form="wf-dialog-form">${label}</button>`;
  const dialogError='<div class="wf-form-error hidden" id="wf-dialog-error" role="alert"></div>';
  function displayError(err) {
    const area=$('#wf-dialog-error');area.classList.remove('hidden');
    area.innerHTML=`<p>${e(err.message)}</p>${err.details?.affected_appointments?.length?`<div class="wf-conflict-list">${err.details.affected_appointments.map(a=>`<div><strong>${e(a.student_name)}</strong><span>${e(a.date)} · ${e(a.time_slot)}–${e(a.end_time)} · #${a.id}</span></div>`).join('')}</div><button type="button" class="account-text-button" id="wf-resolve-conflicts">Review affected appointments →</button>`:''}`;
    $('#wf-resolve-conflicts')?.addEventListener('click',()=>{closeModal();navigate('fac-requests');});
  }
  function wireForm(handler) {
    $('#wf-dialog-cancel').onclick=closeModal;
    $('#wf-dialog-form').onsubmit=async event=>{
      event.preventDefault();const button=$('#wf-dialog-save');button.disabled=true;$('#wf-dialog-error').classList.add('hidden');
      try{await handler(new FormData(event.currentTarget));closeModal();}catch(err){displayError(err);}finally{button.disabled=false;}
    };
  }
  const localTimestamp=(date,time)=>new Date(`${date}T${time}:00+08:00`);
  function actions(a) {
    const faculty=currentUser().role==='faculty';
    if(currentUser().role==='admin')return [];
    const result=[];
    if(faculty&&a.status==='pending')result.push(['approve','Approve request'],['reject','Reject request']);
    if(faculty&&a.status==='checked-in'&&a.queue_status==='serving')result.push(['complete','Complete consultation']);
    if(faculty&&a.status==='approved'&&localTimestamp(a.date,a.end_time)<=new Date())result.push(['missed','Mark as missed']);
    if(['pending','approved'].includes(a.status))result.push(['reschedule',faculty?'Propose a new time':'Request reschedule']);
    if((faculty&&['pending','approved','checked-in'].includes(a.status))||(!faculty&&['pending','approved'].includes(a.status)))result.push(['cancel','Cancel appointment']);
    if(!faculty&&['approved','checked-in'].includes(a.status)&&a.checkin_code)result.push(['qr','Show QR pass']);
    return result;
  }
  function rowActions(a) {const list=actions(a);return `<div class="wf-row-actions"><button class="btn btn-outline btn-sm" data-wf-view="${a.id}">Details</button>${list.length?`<select aria-label="Actions for appointment ${a.id}" data-wf-action="${a.id}"><option value="">Actions…</option>${list.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select>`:''}</div>`;}
  function bindActions(root,appointments,refresh) {
    root.querySelectorAll('[data-wf-view]').forEach(b=>b.onclick=()=>showDetails(appointments.find(a=>a.id===Number(b.dataset.wfView)),refresh));
    root.querySelectorAll('[data-wf-action]').forEach(select=>select.onchange=()=>{const action=select.value;select.value='';if(action)handleAction(action,appointments.find(a=>a.id===Number(select.dataset.wfAction)),refresh);});
  }
  async function handleAction(action,a,refresh) {
    if(action==='qr')return showQRPassModal(a);
    if(action==='reschedule')return rescheduleDialog(a,refresh);
    const descriptions={approve:['Approve appointment','Confirm this consultation request.'],reject:['Reject appointment','Let the student know why this request cannot be accommodated.'],cancel:['Cancel appointment','The appointment history will be kept and the other person will be notified.'],missed:['Mark appointment as missed','Use this when the student did not attend the scheduled consultation.'],complete:['Complete consultation','Mark this consultation as completed.']};
    const [title,description]=descriptions[action],reasonRequired=['cancel','reject'].includes(action)&&currentUser().role==='faculty';
    openModal(title,`<form id="wf-dialog-form" class="account-form"><div class="wf-dialog-summary"><strong>${e(a.student_name||a.faculty_name||'Consultation')}</strong><p>${e(formatDate(a.date))} · ${e(a.time_slot)}–${e(a.end_time)}</p></div><p class="account-form-intro">${description}</p>${action==='reject'?`<div class="rejection-choices">${['Schedule conflict','Please choose another available time','Please clarify the consultation purpose'].map(reason=>`<button type="button" data-reject-reason="${e(reason)}">${e(reason)}</button>`).join('')}</div>`:''}${action!=='complete'?`<div class="field"><label for="wf-action-reason">${reasonRequired?(action==='reject'?'Rejection reason':'Cancellation reason'):'Note (optional)'}</label><textarea id="wf-action-reason" name="reason" maxlength="2000" rows="3" ${reasonRequired?'required':''}></textarea></div>`:''}${dialogError}</form>`,footer(title));
    document.querySelectorAll('[data-reject-reason]').forEach(b=>b.onclick=()=>{$('#wf-action-reason').value=b.dataset.rejectReason;$('#wf-action-reason').focus();});
    wireForm(async form=>{
      const status={approve:'approved',reject:'rejected',cancel:'cancelled',missed:'no-show',complete:'completed'}[action];
      const reason=form.get('reason')||'';
      if(action==='complete')await api('/api/queue/'+a.id,{method:'PUT',body:{action:'complete'}});
      else await api('/api/appointments/'+a.id,{method:'PUT',body:{status,reason,...(currentUser().role==='faculty'?{faculty_remarks:reason}:{})}});
      toast('Appointment '+labels[status].toLowerCase()+'.','success');await refresh();
    });
  }
  async function rescheduleDialog(a,refresh) {
    const initial=a.date>=today()?a.date:today();
    openModal(currentUser().role==='student'?'Request a new consultation time':'Propose a new consultation time',`<form id="wf-dialog-form" class="account-form"><div class="wf-dialog-summary"><span class="account-eyebrow">CURRENT BOOKING</span><strong>${e(formatDate(a.date))} · ${e(a.time_slot)}–${e(a.end_time)}</strong><p>Your original booking stays in place until the other person accepts.</p></div><div class="account-form-grid"><div class="field"><label for="wf-reschedule-date">New date</label><input id="wf-reschedule-date" name="date" type="date" min="${today()}" value="${initial}" required></div><div class="field"><label for="wf-reschedule-slot">Available slot</label><select id="wf-reschedule-slot" name="slot" required disabled><option value="">Loading slots…</option></select></div></div><p id="wf-slot-help" class="wf-field-help">Choose an available time from the faculty’s consultation hours.</p><div class="field"><label for="wf-reschedule-reason">Reason for rescheduling</label><textarea id="wf-reschedule-reason" name="reason" rows="3" maxlength="2000" placeholder="Let the other person know why you need a different time." required></textarea></div>${dialogError}</form>`,footer('Send request'));
    let requestVersion=0;
    const loadSlots=async()=>{
      const version=++requestVersion,select=$('#wf-reschedule-slot'),date=$('#wf-reschedule-date').value;select.disabled=true;$('#wf-dialog-save').disabled=true;
      try{
        const slots=await api(`/api/faculty/${a.faculty_id}/slots?date=${encodeURIComponent(date)}&exclude_appointment_id=${a.id}`);
        if(version!==requestVersion||!select.isConnected)return;
        const choices=slots.filter(s=>!(date===a.date&&s.start===a.time_slot&&s.end===a.end_time));
        select.innerHTML=choices.length?`<option value="">Choose a time</option>${choices.map(s=>`<option value="${s.start}|${s.end}">${s.start}–${s.end} · ${s.duration} minutes</option>`).join('')}`:'<option value="">No alternative slots on this date</option>';
        select.disabled=!choices.length;$('#wf-dialog-save').disabled=!choices.length;$('#wf-slot-help').textContent=choices.length?'The new slot is checked again when the request is accepted.':'Try another date. Your current booking has not changed.';
      }catch(err){if(version===requestVersion&&select.isConnected)displayError(err);}
    };
    $('#wf-reschedule-date').onchange=loadSlots;
    wireForm(async form=>{const [start,end]=String(form.get('slot')||'').split('|');if(!start||!end)throw Error('Choose an available consultation slot.');await api(`/api/appointments/${a.id}/reschedule`,{method:'POST',body:{date:form.get('date'),time_slot:start,end_time:end,reason:form.get('reason')}});toast('Reschedule request sent. Your original booking is still reserved.','success');await refresh();});
    await loadSlots();
  }
  function replyDialog(request,action,refresh) {
    const title={approve:'Accept new time',reject:'Decline reschedule',withdraw:'Withdraw request'}[action];
    openModal(title,`<form id="wf-dialog-form" class="account-form"><div class="wf-dialog-summary"><strong>${e(formatDate(request.proposed_date))} · ${e(request.proposed_start)}–${e(request.proposed_end)}</strong><p>Replacing ${e(formatDate(request.original_date))}, ${e(request.original_start)}–${e(request.original_end)}</p></div><p class="account-form-intro">${action==='approve'?'The new slot will be checked for conflicts before your booking is changed.':'Your original booking stays unchanged.'}</p><div class="field"><label for="wf-reply-note">Note (optional)</label><textarea id="wf-reply-note" name="note" maxlength="2000" rows="2"></textarea></div>${dialogError}</form>`,footer(title));
    wireForm(async form=>{await api('/api/reschedules/'+request.id,{method:'PUT',body:{action,note:form.get('note')}});toast('Reschedule request updated.','success');await refresh();});
  }
  async function showDetails(a,refresh=async()=>{}) {
    try{
      const history=await api('/api/appointments/'+a.id+'/history');
      const eventLabels={created:'Appointment requested',approved:'Appointment approved',rejected:'Appointment rejected',cancelled:'Appointment cancelled','no-show':'Marked as missed',completed:'Consultation completed',remarks_updated:'Remarks updated',reschedule_requested:'New time proposed',reschedule_approved:'Reschedule accepted',reschedule_rejected:'Reschedule declined',reschedule_withdrawn:'Request withdrawn',queue_start:'Consultation started',queue_complete:'Consultation completed',queue_skip:'Turn skipped',queue_recall:'Returned to queue'};
      openModal('Appointment #'+a.id,`<div class="wf-detail-heading">${badge(a.status)}<span>${e(formatDate(a.date))} · ${e(a.time_slot)}–${e(a.end_time)}</span></div><div class="wf-detail-facts"><div><span>${currentUser().role==='student'?'Faculty':'Student'}</span><strong>${e(a.student_name||a.faculty_name||'Consultation')}</strong></div>${a.faculty_name&&a.student_name?`<div><span>Faculty</span><strong>${e(a.faculty_name)}</strong></div>`:''}<div><span>Consultation purpose</span><p>${e(a.purpose)}</p></div>${a.remarks?`<div><span>Student note</span><p>${e(a.remarks)}</p></div>`:''}${a.faculty_remarks?`<div><span>Faculty note</span><p>${e(a.faculty_remarks)}</p></div>`:''}${history.appointment.cancel_reason?`<div><span>Cancellation reason</span><p>${e(history.appointment.cancel_reason)}</p></div>`:''}</div>${window.consultationVenue(history.appointment,e)}<h4 class="wf-section-heading">Rescheduling history</h4>${history.reschedules.length?history.reschedules.map(r=>`<div class="wf-history-card"><strong>${e(r.proposed_date)} · ${e(r.proposed_start)}–${e(r.proposed_end)}</strong><span class="wf-request-status">${e(r.status)}</span><p>${e(r.reason)}</p><small>Proposed by ${e(r.requested_by_name)}${r.response_note?' · '+e(r.response_note):''}</small></div>`).join(''):'<p class="account-muted">No rescheduling requests.</p>'}<h4 class="wf-section-heading">Activity</h4><div class="wf-timeline">${history.events.length?history.events.map(event=>`<div><i></i><div><strong>${e(eventLabels[event.action]||'Appointment updated')}</strong><p>${e(event.actor_name||'System')} · ${e(event.created_at)}</p>${event.details.reason?`<small>${e(event.details.reason)}</small>`:''}</div></div>`).join(''):'<p class="account-muted">No changes recorded since activity tracking was introduced.</p>'}</div><div class="wf-detail-actions">${rowActions(a)}</div>`,`<button type="button" class="btn btn-outline" id="wf-detail-close">Close</button>`);
      $('#wf-detail-close').onclick=closeModal;
      // Hide the redundant Details button inside its own dialog.
      $('#modal-body [data-wf-view]')?.remove();bindActions($('#modal-body'),[a],refresh);
    }catch(err){toast(err.message,'error');}
  }
  async function renderAppointments(el) {
    loading(el);
    try{
      const [appointments,requests]=await Promise.all([api('/api/appointments'),api('/api/reschedules')]);
      const faculty=currentUser().role==='faculty',pending=requests.filter(r=>r.status==='pending'),incoming=pending.filter(r=>r.requested_by!==currentUser().id);
      const refresh=()=>renderAppointments(el);
      el.innerHTML=header(faculty?'FACULTY WORKSPACE':'YOUR CONSULTATIONS',faculty?'Appointment requests':'My appointments',faculty?'Review requests, coordinate new times, and keep every consultation on track.':'Keep track of your bookings and make room for changes.',faculty?`<button class="btn btn-outline" id="wf-open-calendar">Open calendar</button>`:`<button class="btn btn-primary" id="wf-book-new">+ Book Consultation</button>`)+`
      <div class="wf-summary-strip"><span><strong>${appointments.filter(a=>a.status==='pending').length}</strong> pending</span><span><strong>${appointments.filter(a=>a.status==='approved').length}</strong> approved</span><span><strong>${incoming.length}</strong> reschedules to review</span><span><strong>${appointments.filter(a=>a.status==='completed').length}</strong> completed</span></div>
      ${pending.length?`<section class="wf-request-panel"><div class="wf-section-title"><div><span class="account-eyebrow">A CHANGE OF PLANS</span><h2>Reschedule requests <span>${pending.length}</span></h2></div><p>Original bookings remain reserved until accepted.</p></div><div class="wf-request-grid">${pending.map(r=>`<article class="wf-request-card"><div><span class="wf-request-tag">${r.requested_by===currentUser().id?'Waiting for a response':'Your response needed'}</span><strong>${e(faculty?r.student_name:r.faculty_name)}</strong></div><div class="wf-time-change"><span>${e(formatDate(r.original_date))}<small>${e(r.original_start)}–${e(r.original_end)}</small></span><b>→</b><span>${e(formatDate(r.proposed_date))}<small>${e(r.proposed_start)}–${e(r.proposed_end)}</small></span></div><p>${e(r.reason)}</p><div class="wf-request-footer">${r.requested_by===currentUser().id?`<button class="account-text-button" data-wf-reply="${r.id}" data-response="withdraw">Withdraw request</button>`:`<button class="btn btn-primary btn-sm" data-wf-reply="${r.id}" data-response="approve">Accept new time</button><button class="btn btn-outline btn-sm" data-wf-reply="${r.id}" data-response="reject">Decline</button>`}</div></article>`).join('')}</div></section>`:''}
      <section class="card wf-table-card"><div class="account-toolbar"><label class="account-search"><span aria-hidden="true">⌕</span><input id="wf-appointment-search" placeholder="Search ${faculty?'student':'faculty'}, purpose, or remarks…" aria-label="Search appointments"></label><select id="wf-appointment-status" aria-label="Filter appointments by status">${options()}</select><input type="date" id="wf-appointment-from" aria-label="Appointments from date"><input type="date" id="wf-appointment-to" aria-label="Appointments to date"></div><div class="account-table-meta"><span id="wf-appointment-count"></span><span>Times shown in Philippine time</span></div><div id="wf-appointments-table"></div></section>`;
      $('#wf-book-new')?.addEventListener('click',()=>navigate('book'));$('#wf-open-calendar')?.addEventListener('click',()=>navigate('fac-schedule'));
      el.querySelectorAll('[data-wf-reply]').forEach(b=>b.onclick=()=>replyDialog(requests.find(r=>r.id===Number(b.dataset.wfReply)),b.dataset.response,refresh));
      const table=()=>{
        const q=$('#wf-appointment-search').value.trim().toLowerCase(),status=$('#wf-appointment-status').value,from=$('#wf-appointment-from').value,to=$('#wf-appointment-to').value;
        const rows=appointments.filter(a=>(!status||a.status===status)&&(!from||a.date>=from)&&(!to||a.date<=to)&&[a.student_name,a.faculty_name,a.purpose,a.remarks,a.faculty_remarks,a.sid].some(v=>String(v||'').toLowerCase().includes(q)));
        $('#wf-appointment-count').textContent=rows.length+' appointment'+(rows.length===1?'':'s');
        $('#wf-appointments-table').innerHTML=rows.length?`<div class="table-wrapper"><table class="data-table wf-table"><thead><tr><th>${faculty?'Student':'Faculty'}</th><th>Date & time</th><th>Purpose</th><th>Status</th><th>Manage</th></tr></thead><tbody>${rows.map(a=>`<tr><td><strong>${e(faculty?a.student_name:a.faculty_name)}</strong><small>${e(faculty?a.student_course||a.sid||'':a.faculty_dept||'')}</small></td><td><strong>${e(formatDate(a.date))}</strong><small>${e(a.time_slot)}–${e(a.end_time)}</small></td><td class="wf-purpose">${e(a.purpose)}${pending.some(r=>r.appointment_id===a.id)?'<small class="wf-pending-note">Reschedule pending</small>':''}</td><td>${badge(a.status)}</td><td>${rowActions(a)}</td></tr>`).join('')}</tbody></table></div>`:empty('No appointments found','Try another filter or book a new consultation.');
        bindActions($('#wf-appointments-table'),appointments,refresh);
      };
      $('#wf-appointment-search').oninput=table;for(const id of ['status','from','to'])$('#wf-appointment-'+id).onchange=table;table();
    }catch(err){error(el,err,()=>renderAppointments(el));}
  }
  async function renderAvailability(el) {
    loading(el);
    try{
      const [schedules,blocks]=await Promise.all([api('/api/schedule'),api('/api/blocked-dates')]);
      const refresh=()=>renderAvailability(el),recurring=schedules.filter(s=>!s.specific_date),dated=schedules.filter(s=>s.specific_date);
      el.innerHTML=header('PLAN YOUR TIME','Consultation availability','Set a regular rhythm, add extra hours, and protect time when you’re unavailable.',`<button class="btn btn-outline" id="wf-block-time">Block availability</button><button class="btn btn-primary" id="wf-add-hours">+ Add consultation hours</button>`)+`
      <div class="wf-summary-strip"><span><strong>${recurring.length}</strong> weekly windows</span><span><strong>${dated.length}</strong> date-specific windows</span><span><strong>${blocks.filter(b=>b.date>=today()).length}</strong> upcoming blocks</span></div>
      <div class="wf-availability-grid"><section class="card wf-availability-section"><div class="wf-section-title"><div><span class="account-eyebrow">OPEN FOR CONSULTATIONS</span><h2>Your consultation hours</h2></div></div><p class="wf-section-intro">Recurring hours repeat each week. Date-specific hours add availability on one date.</p>${schedules.length?schedules.map(s=>`<article class="wf-hours-row"><div class="wf-day-mark">${s.specific_date?e(formatDate(s.specific_date,{month:'short',day:'numeric'})):DAYS[s.day_of_week].slice(0,3)}</div><div class="wf-hours-info"><strong>${s.specific_date?e(formatDate(s.specific_date)):DAYS[s.day_of_week]}</strong><p>${s.start_time}–${s.end_time}</p><span>${s.specific_date?'One date only':'Repeats weekly'} · ${s.slot_duration}-minute slots</span></div><div class="wf-hours-actions"><button class="account-text-button" data-edit-hours="${s.id}">Edit</button><button class="account-text-button danger" data-remove-hours="${s.id}">Remove</button></div></article>`).join(''):empty('Your calendar is a blank canvas','Add consultation hours so students can find a time with you.')}</section>
      <section class="card wf-availability-section"><div class="wf-section-title"><div><span class="account-eyebrow">TIME SET ASIDE</span><h2>Blocked availability</h2></div></div><p class="wf-section-intro">Block a full day or a specific time period. Existing bookings must be resolved before a conflicting block is saved.</p>${blocks.length?blocks.map(b=>`<article class="wf-block-card ${b.date<today()?'past':''}"><div><strong>${e(formatDate(b.date))}</strong><span class="account-pill">${b.start_time?b.start_time+'–'+b.end_time:'All day'}</span></div><p>${e(b.reason||'Unavailable for consultations')}</p><button class="account-text-button" data-remove-block="${b.id}">Remove block</button></article>`).join(''):empty('No time blocked','Make space for meetings, leave, or other commitments.')}</section></div>`;
      function hoursDialog(s) {
        openModal(s?'Edit consultation hours':'Add consultation hours',`<form id="wf-dialog-form" class="account-form"><div class="field"><label for="wf-hours-type">Availability type</label><select id="wf-hours-type"><option value="weekly" ${s?.specific_date?'':'selected'}>Repeats weekly</option><option value="date" ${s?.specific_date?'selected':''}>One specific date</option></select></div><div class="field" id="wf-hours-day-field"><label for="wf-hours-day">Day of the week</label><select id="wf-hours-day" name="day_of_week">${DAYS.map((d,i)=>`<option value="${i}" ${(s?.day_of_week??1)===i?'selected':''}>${d}</option>`).join('')}</select></div><div class="field" id="wf-hours-date-field"><label for="wf-hours-date">Date</label><input type="date" id="wf-hours-date" name="specific_date" min="${today()}" value="${s?.specific_date||today()}"></div><div class="account-form-grid"><div class="field"><label for="wf-hours-start">Start time</label><input type="time" step="900" id="wf-hours-start" name="start_time" value="${s?.start_time||'08:00'}" required></div><div class="field"><label for="wf-hours-end">End time</label><input type="time" step="900" id="wf-hours-end" name="end_time" value="${s?.end_time||'10:00'}" required></div></div><div class="field"><label for="wf-hours-duration">Consultation slot duration</label><select id="wf-hours-duration" name="slot_duration">${[15,30,45,60].map(n=>`<option value="${n}" ${(s?.slot_duration??15)===n?'selected':''}>${n} minutes per appointment</option>`).join('')}</select></div><div class="wf-soft-note">Changes that affect existing appointments will be shown for review. Bookings are never silently cancelled.</div>${dialogError}</form>`,footer(s?'Save changes':'Add hours'));
        const changeType=()=>{const dated=$('#wf-hours-type').value==='date';$('#wf-hours-day-field').classList.toggle('hidden',dated);$('#wf-hours-date-field').classList.toggle('hidden',!dated);$('#wf-hours-date').required=dated;};$('#wf-hours-type').onchange=changeType;changeType();
        wireForm(async form=>{await api('/api/schedule'+(s?'/'+s.id:''),{method:s?'PUT':'POST',body:{day_of_week:Number(form.get('day_of_week')),specific_date:$('#wf-hours-type').value==='date'?form.get('specific_date'):null,start_time:form.get('start_time'),end_time:form.get('end_time'),slot_duration:Number(form.get('slot_duration'))}});toast('Consultation hours saved.','success');await refresh();});
      }
      $('#wf-add-hours').onclick=()=>hoursDialog(null);
      $('#wf-block-time').onclick=()=>{
        openModal('Block availability',`<form id="wf-dialog-form" class="account-form"><div class="field"><label for="wf-block-date">Date</label><input type="date" id="wf-block-date" name="date" min="${today()}" value="${today()}" required></div><div class="wf-segmented wf-block-choice"><label><input type="radio" name="block_type" value="day" checked> All day</label><label><input type="radio" name="block_type" value="hours"> Specific hours</label></div><div id="wf-block-range" class="account-form-grid hidden"><div class="field"><label for="wf-block-start">Start time</label><input type="time" id="wf-block-start" name="start_time" step="900" value="10:00"></div><div class="field"><label for="wf-block-end">End time</label><input type="time" id="wf-block-end" name="end_time" step="900" value="11:00"></div></div><div class="field"><label for="wf-block-reason">Reason (optional)</label><textarea id="wf-block-reason" name="reason" rows="2" maxlength="500" placeholder="e.g. Department meeting"></textarea></div><div class="wf-soft-note">Only the selected period is blocked. Consultations outside that period remain available.</div>${dialogError}</form>`,footer('Save availability block'));
        document.querySelectorAll('[name="block_type"]').forEach(r=>r.onchange=()=>{const hours=$('[name="block_type"]:checked').value==='hours';$('#wf-block-range').classList.toggle('hidden',!hours);$('#wf-block-start').required=hours;$('#wf-block-end').required=hours;});
        wireForm(async form=>{const hours=form.get('block_type')==='hours';await api('/api/blocked-dates',{method:'POST',body:{date:form.get('date'),start_time:hours?form.get('start_time'):null,end_time:hours?form.get('end_time'):null,reason:form.get('reason')}});toast('Availability block saved.','success');await refresh();});
      };
      const remove=(url,title,message)=>{openModal(title,`<form id="wf-dialog-form" class="account-form"><p class="account-form-intro">${message}</p>${dialogError}</form>`,footer('Remove'));wireForm(async()=>{await api(url,{method:'DELETE'});toast('Availability updated.','success');await refresh();});};
      el.querySelectorAll('[data-edit-hours]').forEach(b=>b.onclick=()=>hoursDialog(schedules.find(s=>s.id===Number(b.dataset.editHours))));
      el.querySelectorAll('[data-remove-hours]').forEach(b=>b.onclick=()=>remove('/api/schedule/'+b.dataset.removeHours,'Remove consultation hours','Existing appointments must be resolved before removing the hours that cover them.'));
      el.querySelectorAll('[data-remove-block]').forEach(b=>b.onclick=()=>remove('/api/blocked-dates/'+b.dataset.removeBlock,'Remove availability block','This period will become bookable again if it falls within your consultation hours.'));
    }catch(err){error(el,err,()=>renderAvailability(el));}
  }
  async function renderCalendar(el) {
    loading(el);let view='week',anchor=today();
    try{
      let [appointments,schedules,blocks]=await Promise.all([api('/api/appointments'),api('/api/schedule'),api('/api/blocked-dates')]);
      const refresh=async()=>{[appointments,schedules,blocks]=await Promise.all([api('/api/appointments'),api('/api/schedule'),api('/api/blocked-dates')]);render();};
      const onDate=d=>appointments.filter(a=>a.date===d).sort((a,b)=>a.time_slot.localeCompare(b.time_slot));
      const availableOn=d=>schedules.filter(s=>s.specific_date?s.specific_date===d:s.day_of_week===dateObject(d).getUTCDay());
      const availabilityNotes=d=>availableOn(d).map(s=>`<span class="wf-calendar-hours">${s.start_time}–${s.end_time} · ${s.slot_duration}m slots</span>`).join('')+blocks.filter(b=>b.date===d).map(b=>`<span class="wf-calendar-block">${b.start_time?b.start_time+'–'+b.end_time:'All day'} blocked${b.reason?' · '+e(b.reason):''}</span>`).join('');
      const appointmentCard=(a,compact=false)=>`<button class="wf-calendar-event ${e(a.status)} ${compact?'compact':''}" data-calendar-appointment="${a.id}"><span>${e(a.time_slot)}${compact?'':'–'+e(a.end_time)}</span><strong>${e(a.student_name)}</strong>${compact?'':`<small>${e(a.purpose)}</small><em>${labels[a.status]}</em>`}</button>`;
      function render(){
        const start=view==='day'?anchor:view==='week'?startOfWeek(anchor):anchor.slice(0,7)+'-01';
        const nextMonth=new Date(Date.UTC(dateObject(start).getUTCFullYear(),dateObject(start).getUTCMonth()+1,1)).toISOString().slice(0,10);
        const end=view==='day'?anchor:view==='week'?addDays(start,6):addDays(nextMonth,-1);
        const count=appointments.filter(a=>a.date>=start&&a.date<=end).length;
        const range=view==='month'?formatDate(anchor,{month:'long',year:'numeric'}):view==='day'?formatDate(anchor,{weekday:'long',month:'long',day:'numeric',year:'numeric'}):formatDate(start,{month:'short',day:'numeric'})+' – '+formatDate(end);
        el.innerHTML=header('YOUR CONSULTATION CALENDAR','A little clarity for your day.','Every appointment, at its actual date and time.',`<button class="btn btn-outline" id="wf-calendar-availability">Manage availability</button>`)+`
        <section class="card wf-calendar-card"><div class="wf-calendar-toolbar"><div class="wf-calendar-navigation"><button class="btn btn-outline btn-sm" id="wf-calendar-prev" aria-label="Previous ${view}">←</button><button class="btn btn-outline btn-sm" id="wf-calendar-today">Today</button><button class="btn btn-outline btn-sm" id="wf-calendar-next" aria-label="Next ${view}">→</button></div><div class="wf-segmented">${['day','week','month'].map(v=>`<button class="${v===view?'active':''}" data-calendar-view="${v}" aria-pressed="${v===view}">${v[0].toUpperCase()+v.slice(1)}</button>`).join('')}</div><input type="date" id="wf-calendar-jump" value="${anchor}" aria-label="Jump to calendar date"></div><div class="wf-calendar-title"><h2>${e(range)}</h2><span>${count} appointment${count===1?'':'s'} · Philippine time</span></div><div id="wf-calendar-body"></div><div class="wf-calendar-legend"><span><i class="pending"></i>Pending</span><span><i class="approved"></i>Approved</span><span><i class="completed"></i>Completed</span><span><i class="cancelled"></i>Cancelled / missed</span></div></section>`;
        const body=$('#wf-calendar-body');
        if(view==='day')body.innerHTML=`<div class="wf-day-availability">${availabilityNotes(anchor)||'<span class="account-muted">No consultation hours set for this date.</span>'}</div><div class="wf-day-agenda">${onDate(anchor).length?onDate(anchor).map(a=>`<div class="wf-agenda-row"><div>${a.time_slot}<small>${a.end_time}</small></div>${appointmentCard(a)}</div>`).join(''):empty('A clear day ahead','No appointments are scheduled for this date.')}</div>`;
        if(view==='week')body.innerHTML=`<div class="wf-week-scroll"><div class="wf-week-grid">${Array.from({length:7},(_,i)=>addDays(start,i)).map(d=>`<div class="wf-week-day ${d===today()?'today':''}"><button class="wf-week-date" data-calendar-date="${d}"><span>${formatDate(d,{weekday:'short'})}</span><strong>${dateObject(d).getUTCDate()}</strong></button><div class="wf-week-events">${availabilityNotes(d)}${onDate(d).map(a=>appointmentCard(a)).join('')}${!onDate(d).length?'<p class="wf-calendar-empty">No appointments</p>':''}</div></div>`).join('')}</div></div>`;
        if(view==='month'){
          const gridStart=startOfWeek(start),days=Array.from({length:42},(_,i)=>addDays(gridStart,i));
          body.innerHTML=`<div class="wf-month-scroll"><div class="wf-month-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<div class="wf-month-label">${d}</div>`).join('')}${days.map(d=>{const rows=onDate(d);return `<div class="wf-month-day ${d.slice(0,7)!==anchor.slice(0,7)?'outside':''} ${d===today()?'today':''}"><button class="wf-month-date" data-calendar-date="${d}">${dateObject(d).getUTCDate()}</button>${blocks.some(b=>b.date===d)?'<span class="wf-month-block-marker" title="Availability block on this date">Blocked period</span>':''}${rows.slice(0,3).map(a=>appointmentCard(a,true)).join('')}${rows.length>3?`<button class="account-text-button" data-calendar-date="${d}">+${rows.length-3} more</button>`:''}</div>`;}).join('')}</div></div>`;
        }
        const move=n=>{if(view==='month'){const x=dateObject(anchor);anchor=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+n,1)).toISOString().slice(0,10);}else anchor=addDays(anchor,n*(view==='week'?7:1));render();};
        $('#wf-calendar-prev').onclick=()=>move(-1);$('#wf-calendar-next').onclick=()=>move(1);$('#wf-calendar-today').onclick=()=>{anchor=today();render();};$('#wf-calendar-jump').onchange=event=>{if(event.target.value){anchor=event.target.value;render();}};
        el.querySelectorAll('[data-calendar-view]').forEach(b=>b.onclick=()=>{view=b.dataset.calendarView;render();});
        el.querySelectorAll('[data-calendar-date]').forEach(b=>b.onclick=()=>{anchor=b.dataset.calendarDate;view='day';render();});
        el.querySelectorAll('[data-calendar-appointment]').forEach(b=>b.onclick=()=>showDetails(appointments.find(a=>a.id===Number(b.dataset.calendarAppointment)),refresh));
        $('#wf-calendar-availability').onclick=()=>navigate('fac-availability');
      }
      render();
    }catch(err){error(el,err,()=>renderCalendar(el));}
  }
  async function renderRecords(el) {
    loading(el);
    try{
      const faculty=(await api('/api/admin/users')).filter(u=>u.role==='faculty');let page=1,version=0;
      el.innerHTML=header('CAMPUS-WIDE MONITORING','Appointment records','One searchable record of every consultation, including cancellations and missed appointments.',`<button class="btn btn-outline" id="wf-records-analytics">View analytics</button><button class="btn btn-primary" id="wf-records-export">↓ Export CSV</button>`)+`
      <section class="card wf-table-card"><form id="wf-record-filters"><div class="account-toolbar"><label class="account-search"><span aria-hidden="true">⌕</span><input id="wf-record-search" aria-label="Search appointment records" placeholder="Search student, student number, faculty, or purpose…" maxlength="100"></label><select id="wf-record-faculty" aria-label="Filter records by faculty"><option value="all">All faculty</option>${faculty.map(f=>`<option value="${f.id}">${e(f.name)}${f.is_active?'':' (deactivated)'}</option>`).join('')}</select><select id="wf-record-status" aria-label="Filter records by status">${options()}</select></div><div class="wf-record-date-bar"><label>From <input type="date" id="wf-record-from"></label><label>To <input type="date" id="wf-record-to"></label><button type="submit" class="btn btn-outline btn-sm">Apply filters</button><button type="button" id="wf-record-reset" class="account-text-button">Reset</button></div></form><div class="account-table-meta"><span id="wf-record-count">Loading records…</span><span>All appointment statuses included</span></div><div id="wf-record-table"></div><div class="wf-pagination"><button id="wf-record-prev" class="btn btn-outline btn-sm">← Previous</button><span id="wf-record-page"></span><button id="wf-record-next" class="btn btn-outline btn-sm">Next →</button></div></section>`;
      const params=()=>new URLSearchParams({q:$('#wf-record-search').value.trim(),faculty_id:$('#wf-record-faculty').value,status:$('#wf-record-status').value,start_date:$('#wf-record-from').value,end_date:$('#wf-record-to').value});
      const load=async()=>{
        const current=++version,p=params();p.set('page',page);$('#wf-record-table').setAttribute('aria-busy','true');
        try{
          const data=await api('/api/admin/appointments?'+p);if(current!==version)return;
          $('#wf-record-count').textContent=data.total+' matching appointment'+(data.total===1?'':'s');$('#wf-record-page').textContent=`Page ${data.page} of ${Math.max(1,Math.ceil(data.total/data.page_size))}`;$('#wf-record-prev').disabled=page<=1;$('#wf-record-next').disabled=page*data.page_size>=data.total;
          $('#wf-record-table').innerHTML=data.appointments.length?`<div class="table-wrapper"><table class="data-table wf-table"><thead><tr><th>Reference</th><th>Student</th><th>Faculty</th><th>Date & time</th><th>Purpose</th><th>Status</th><th></th></tr></thead><tbody>${data.appointments.map(a=>`<tr><td class="account-muted">#${a.id}</td><td><strong>${e(a.student_name)}</strong><small>${e(a.sid||'')} · ${e(a.student_course||'')}</small></td><td><strong>${e(a.faculty_name)}</strong><small>${e(a.faculty_dept||'')}</small></td><td><strong>${e(formatDate(a.date))}</strong><small>${a.time_slot}–${a.end_time}</small></td><td class="wf-purpose">${e(a.purpose)}</td><td>${badge(a.status)}</td><td><button class="btn btn-outline btn-sm" data-wf-view="${a.id}">Details</button></td></tr>`).join('')}</tbody></table></div>`:empty('No matching records','Try a different date range, faculty member, or status.');bindActions($('#wf-record-table'),data.appointments,load);
        }catch(err){if(current===version)$('#wf-record-table').innerHTML=`<div class="wf-empty" role="alert"><p>${e(err.message)}</p></div>`;}finally{$('#wf-record-table')?.removeAttribute('aria-busy');}
      };
      $('#wf-record-filters').onsubmit=event=>{event.preventDefault();page=1;load();};
      for(const id of ['faculty','status','from','to'])$('#wf-record-'+id).onchange=()=>{page=1;load();};
      let searchTimer;$('#wf-record-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if($('#wf-record-table')){page=1;load();}},250);};
      $('#wf-record-prev').onclick=()=>{page--;load();};$('#wf-record-next').onclick=()=>{page++;load();};
      $('#wf-record-reset').onclick=()=>{$('#wf-record-filters').reset();page=1;load();};
      $('#wf-records-export').onclick=()=>{window.location.href='/api/analytics/export?'+params();};$('#wf-records-analytics').onclick=()=>navigate('analytics');await load();
    }catch(err){error(el,err,()=>renderRecords(el));}
  }
  return {renderAppointments,renderAvailability,renderCalendar,renderRecords,showDetails,rescheduleDialog};
};
