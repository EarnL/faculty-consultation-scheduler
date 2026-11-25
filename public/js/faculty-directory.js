/* Interactive directory. Availability always comes from the shared scheduling API. */
window.createFacultyDirectory = function ({api, escapeHtml:e, renderAvatarImg, currentUser, onBook}) {
  const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
  const dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'});
  const time=t=>new Date('2000-01-01T'+t).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'});
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const message=(text)=>`<p class="fd-message" role="status">${e(text)}</p>`;
  return async function render(el) {
    el.innerHTML=message('Loading faculty members…');
    const loadingNode=el.firstElementChild;
    let faculty;
    try {faculty=await api('/api/faculty');} catch(err) {
      if(!el.contains(loadingNode))return;
      el.innerHTML=message(err.message)+'<button class="btn btn-outline" id="fd-retry">Try again</button>';
      el.querySelector('#fd-retry').onclick=()=>render(el);return;
    }
    if(!el.isConnected||!el.contains(loadingNode))return;
    el.innerHTML=`<section class="fd-hero"><div class="fd-logo-wrap"><img class="fd-logo" src="/images/it-department-logo.png" alt="DLL Information Technology department logo" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="fd-monogram" hidden>IT</span></div><div><span class="fd-eyebrow">DLL · INFORMATION TECHNOLOGY</span><h1>Meet your faculty.</h1><p>Find the right professor, explore their hours, and plan your next consultation.</p></div></section>
      <div class="fd-toolbar"><label class="fd-search"><span>Search faculty</span><input type="search" id="dir-search" placeholder="Name or specialization…"></label><label><span>Availability</span><select id="fd-filter"><option value="all">All faculty</option><option value="available">Available in the next 14 days</option></select></label></div>
      <p id="fd-count" class="fd-count" aria-live="polite"></p><div id="dir-results-container" class="fd-grid"></div>`;
    const recs=new Map();
    const grid=el.querySelector('#dir-results-container'),search=el.querySelector('#dir-search'),filter=el.querySelector('#fd-filter');
    function draw() {
      if(!search.isConnected)return;
      const q=search.value.trim().toLowerCase(), available=filter.value==='available';
      const list=faculty.filter(f=>(!q||[f.name,f.specialization].some(v=>(v||'').toLowerCase().includes(q)))&&(!available||recs.get(f.id)?.recommended));
      el.querySelector('#fd-count').textContent=`${list.length} faculty member${list.length===1?'':'s'}${recs.size<faculty.length?' · Checking upcoming availability…':''}`;
      grid.innerHTML=list.length?list.map(f=>{
        const r=recs.get(f.id),next=r?.recommended;
        return `<button class="fd-card" data-faculty="${f.id}" aria-label="View profile and availability for ${e(f.name)}"><span class="fd-card-top"><span class="faculty-avatar">${renderAvatarImg(f.avatar,f.name,'faculty')}</span><span class="fd-arrow" aria-hidden="true">↗</span></span><h2>${e(f.name)}</h2><p class="fd-dept">Information Technology</p><p class="fd-specialization">${e(f.specialization||'Specialization not provided')}</p><span class="fd-next ${next?'fd-has-slots':''}"><span>${next?'NEXT AVAILABLE':r?.error?'AVAILABILITY':r?'UPCOMING SCHEDULE':'CHECKING AVAILABILITY'}</span><strong>${next?`${e(dateLabel(next.date))} · ${e(time(next.time_slot))}`:r?.error?'Open profile to retry':r?'No open slots in the next 14 days':'Please wait…'}</strong></span><span class="fd-card-link">View profile & availability <span aria-hidden="true">→</span></span></button>`;
      }).join(''):message(available&&recs.size<faculty.length?'Checking faculty schedules…':'No faculty match these filters. Try another search or view all faculty.');
      grid.querySelectorAll('[data-faculty]').forEach(b=>b.onclick=()=>openProfile(faculty.find(f=>f.id===Number(b.dataset.faculty)),b));
    }
    el.querySelector('#dir-search').oninput=draw;el.querySelector('#fd-filter').onchange=draw;draw();
    // A small worker pool avoids sending one burst of requests for the whole directory.
    let index=0;
    async function loadRecommendations() {
      await Promise.all(Array.from({length:Math.min(3,faculty.length)},async()=>{
        while(index<faculty.length&&search.isConnected){const f=faculty[index++];try{recs.set(f.id,await api(`/api/faculty/${f.id}/recommendation`));}catch{recs.set(f.id,{error:true});}if(search.isConnected)draw();}
      }));
    }
    await loadRecommendations();

    async function openProfile(summary,opener) {
      const directory=document.createDocumentFragment();
      while(el.firstChild)directory.append(el.firstChild);
      const dialog=document.createElement('section');dialog.className='fd-profile-page';dialog.setAttribute('aria-labelledby','fd-profile-title');
      dialog.innerHTML=`<div class="fd-panel-header"><button class="btn btn-outline fd-close" aria-label="Back to faculty members">&larr; Back to faculty members</button><span class="fd-eyebrow">IT FACULTY PROFILE</span></div><div class="fd-panel-body"><div class="fd-profile-heading"><div><span class="fd-eyebrow">INFORMATION TECHNOLOGY</span><h1 id="fd-profile-title" tabindex="-1">${e(summary.name)}</h1><p>Consultation profile and availability</p></div><img src="/images/it-department-logo.png" alt="DLL Information Technology department logo"></div><div id="fd-profile-content">${message('Loading profile and availability...')}</div></div>`;
      el.append(dialog);
      const close=()=>{
        if(!dialog.isConnected)return;
        dialog.remove();el.append(directory);draw();
        const restored=grid.querySelector(`[data-faculty="${summary.id}"]`);
        if(restored)restored.focus();else search.focus();
        void loadRecommendations();
      };
      dialog.querySelector('.fd-close').onclick=close;
      dialog.querySelector('#fd-profile-title').focus();
      const content=dialog.querySelector('#fd-profile-content');
      async function loadProfile(){
        content.innerHTML=message('Loading profile and availability…');
        try {
          const [f,recommendations]=await Promise.all([api(`/api/faculty/${summary.id}`),api(`/api/faculty/${summary.id}/recommendation`)]);
          if(!dialog.isConnected)return;
          let selected=null,requestVersion=0;
          const next=recommendations.recommended;
          content.innerHTML=`<div class="fd-profile-identity"><span class="faculty-avatar">${renderAvatarImg(f.avatar,f.name,'faculty')}</span><div><p class="fd-dept">Information Technology</p><p>${e(f.specialization||'Specialization not provided')}</p>${f.faculty_id?`<p class="fd-profile-meta">Faculty ID: ${e(f.faculty_id)}</p>`:''}${f.email?`<p class="fd-profile-meta">${e(f.email)}</p>`:''}</div></div>
            <section class="fd-section"><h3>Location and instructions</h3>${window.consultationVenue(f,e)}<h3>Consultation hours</h3>${f.schedules.length?`<ul class="fd-hours">${f.schedules.map(s=>`<li><span>${e(s.specific_date?dateLabel(s.specific_date):days[s.day_of_week])}</span><strong>${e(time(s.start_time))} – ${e(time(s.end_time))}<small>${s.slot_duration||15}-minute consultations</small></strong></li>`).join('')}</ul>`:message('No consultation hours have been published yet.')}</section>
            <section class="fd-section"><h3>Choose a consultation</h3><p class="fd-help">Times are in Philippine Time. Only open slots are shown.</p><label class="fd-date-label" for="fd-date">Consultation date</label><input id="fd-date" type="date" min="${today()}" value="${next?.date||today()}">${next?`<button class="fd-next-button" id="fd-next-date">Next available: ${e(dateLabel(next.date))} · ${e(time(next.time_slot))}</button>`:message('No open slots found in the next 14 days. You can check another date.')}
            <div id="fd-slots" class="fd-slots" aria-live="polite"></div><p id="fd-selection" class="fd-selection" aria-live="polite">Select an available time to continue.</p></section>
            <div class="fd-booking-footer">${currentUser().role==='student'?'<button class="btn btn-primary" id="fd-book" disabled>Request Consultation →</button><p>Your request will be sent to the faculty member for approval.</p>':'<p>Students can request consultations from this profile.</p>'}</div>`;
          const dateInput=content.querySelector('#fd-date'),slotsEl=content.querySelector('#fd-slots'),button=content.querySelector('#fd-book'),selection=content.querySelector('#fd-selection');
          async function loadSlots(){
            const version=++requestVersion,date=dateInput.value;selected=null;if(button)button.disabled=true;
            selection.textContent='Select an available time to continue.';
            if(!date||date<today()){slotsEl.innerHTML=message('Choose today or a future date.');return;}
            slotsEl.innerHTML=message('Checking available times…');
            try{
              const slots=await api(`/api/faculty/${f.id}/slots?date=${encodeURIComponent(date)}`);
              if(version!==requestVersion||!dialog.isConnected)return;
              slotsEl.innerHTML=slots.length?slots.map((s,i)=>`<button class="fd-slot" data-index="${i}" data-start="${s.start}" aria-pressed="false">${e(time(s.start))}<small>${e(time(s.end))} · ${s.duration||15} min</small></button>`).join(''):message('No open slots on this date. Times may be booked, blocked, or outside published hours. Try another date.');
              slotsEl.querySelectorAll('[data-index]').forEach(b=>b.onclick=()=>{selected={...slots[Number(b.dataset.index)],date};slotsEl.querySelectorAll('[data-index]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));selection.textContent=`${dateLabel(date)} · ${time(selected.start)} – ${time(selected.end)}`;if(button)button.disabled=false;});
            }catch(err){if(version!==requestVersion||!dialog.isConnected)return;slotsEl.innerHTML=message(err.message)+'<button class="btn btn-outline" id="fd-slot-retry">Retry availability</button>';slotsEl.querySelector('button').onclick=loadSlots;}
          }
          dateInput.onchange=loadSlots;
          content.querySelector('#fd-next-date')?.addEventListener('click',()=>{dateInput.value=next.date;loadSlots();});
          if(button)button.onclick=async()=>{
            if(!selected||button.disabled)return;
            const target={...selected},version=requestVersion;button.disabled=true;button.textContent='Checking your selection…';
            try{const slots=await api(`/api/faculty/${f.id}/slots?date=${target.date}`);if(!dialog.isConnected||version!==requestVersion)return;if(!slots.some(s=>s.start===target.start&&s.end===target.end)){await loadSlots();selection.textContent='That time is no longer available. Please select another slot.';return;}const seed={faculty:f,date:target.date,slot:{start:target.start,end:target.end}};close();onBook(seed);}
            catch(err){if(dialog.isConnected&&version===requestVersion){selection.textContent=err.message;button.disabled=false;}}
            finally{if(dialog.isConnected)button.textContent='Request Consultation →';}
          };
          await loadSlots();
        }catch(err){if(dialog.isConnected){content.innerHTML=message(err.message)+'<button class="btn btn-outline" id="fd-profile-retry">Try again</button>';content.querySelector('button').onclick=loadProfile;}}
      }
      await loadProfile();
    }
  };
};
