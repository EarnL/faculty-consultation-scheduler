window.createPortalHeader=function({api,escapeHtml:e,navigate,currentUser}){
 const $=s=>document.querySelector(s);let data={notifications:[],unread:0},generation=0;
 function identity(){const u=currentUser(),photo=u.avatar&&u.avatar!=='/images/default-avatar.png';return `<span class="header-avatar">${photo?`<img src="${e(u.avatar)}" alt="Your profile photo" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`:''}<span class="header-initials" ${photo?'hidden':''}>${e(u.name.split(' ').filter(Boolean).map(x=>x[0]).slice(0,2).join(''))}</span></span><div class="header-identity"><strong>${e(u.name)}</strong><small>${e(u.role)}</small></div>`;}
 const small=()=>window.innerWidth<=900;
 function sidebarState(){
  const open=small()?$('#sidebar').classList.contains('open'):!$('#app').classList.contains('sidebar-collapsed');
  const toggle=$('#menu-toggle');if(toggle){toggle.hidden=open;toggle.setAttribute('aria-expanded',String(open));}
  $('#sidebar-dismiss')?.setAttribute('aria-expanded',String(open));
  $('#sidebar').inert=!open;
  const drawer=small()&&open;$('#main-content').inert=drawer;$('#mobile-header').inert=drawer;
  document.body.classList.toggle('navigation-drawer-open',drawer);
 }
 function closeSidebar(){ $('#sidebar').classList.remove('open');$('#sidebar-overlay').classList.remove('show');sidebarState();}
 function closePopup(focus=false){const popup=$('#header-notifications');if(popup)popup.hidden=true;$('#mobile-notif-btn')?.setAttribute('aria-expanded','false');if(focus)$('#mobile-notif-btn')?.focus();}
 function outside(event){if(!event.target.closest('.header-notification-wrap'))closePopup();}
 function keys(event){
  if(small()&&$('#sidebar').classList.contains('open')){
   if(event.key==='Escape'){event.preventDefault();closeSidebar();$('#menu-toggle').focus();return;}
   if(event.key==='Tab'){const buttons=[...$('#sidebar').querySelectorAll('button:not([disabled])')],first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}return;
  }
  if(event.key==='Escape'&&!$('#header-notifications')?.hidden)closePopup(true);
 }
 function update(value){data=value;const count=$('#header-notif-count');if(!count)return;count.textContent=value.unread>99?'99+':String(value.unread);count.hidden=value.unread===0;$('#mobile-notif-btn').setAttribute('aria-label',`Notifications, ${value.unread} unread`);if(!$('#header-notifications').hidden)draw();}
 function draw(){
  const list=$('#header-notification-list');if(!list)return;
  $('#header-unread-label').textContent=`${data.unread} unread`;
  list.innerHTML=data.notifications.length?data.notifications.slice(0,6).map(n=>`<button class="header-notification ${n.is_read?'':'is-unread'}" data-notification="${n.id}"><span class="header-notification-dot" aria-hidden="true"></span><span><strong>${e(n.title)}</strong><span>${e(n.message)}</span></span></button>`).join(''):'<p class="header-empty">You are all caught up. New appointment updates will appear here.</p>';
  list.querySelectorAll('[data-notification]').forEach(button=>button.onclick=async()=>{
   const id=generation;
   try{await api(`/api/notifications/${button.dataset.notification}/read`,{method:'PUT'});if(id!==generation||!currentUser())return;closePopup();navigate('notifications');const fresh=await api('/api/notifications');if(id!==generation||!currentUser())return;update(fresh);setTimeout(()=>{if(id!==generation)return;const target=document.querySelector(`.notif-item[data-id="${button.dataset.notification}"]`);if(target){target.setAttribute('tabindex','-1');target.focus();target.scrollIntoView?.({block:'center'});}},250);}catch(err){if(id===generation)list.innerHTML=`<p class="header-empty" role="alert">${e(err.message)}</p>`;}
  });
 }
 function mount(){
  generation++;document.removeEventListener('click',outside);document.removeEventListener('keydown',keys);window.removeEventListener('resize',closeSidebar);
  $('#mobile-header').innerHTML=`<div class="portal-header-left"><button id="menu-toggle" aria-label="Toggle sidebar" aria-controls="sidebar" aria-expanded="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button><div class="header-context"><span>IT CONSULTATION PORTAL</span><strong id="header-page-title">Dashboard</strong></div></div><div class="portal-header-right"><span class="header-today">${e(new Date().toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric'}))} · PHT</span><div class="header-notification-wrap"><button id="mobile-notif-btn" aria-label="Notifications" aria-expanded="false" aria-controls="header-notifications"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M10 21h4"/></svg><span id="header-notif-count" hidden></span></button><section id="header-notifications" aria-label="Recent notifications" hidden><div class="header-notification-heading"><strong>Notifications</strong><span id="header-unread-label"></span></div><div id="header-notification-list"></div><button id="header-view-all">View all notifications →</button></section></div><button id="header-profile" class="header-profile" aria-label="Open your profile">${identity()}</button></div>`;
  $('#menu-toggle').setAttribute('aria-label','Open navigation');$('#menu-toggle').title='Open navigation';
  $('#menu-toggle').onclick=()=>{if(small()){$('#sidebar').classList.add('open');$('#sidebar-overlay').classList.add('show');}else{$('#app').classList.remove('sidebar-collapsed');try{localStorage.setItem('dll_sidebar_collapsed','false');}catch{}}closePopup();sidebarState();($('#sidebar-nav [aria-current="page"]')||$('#sidebar-dismiss')).focus();};
  try{$('#app').classList.toggle('sidebar-collapsed',localStorage.getItem('dll_sidebar_collapsed')==='true');}catch{}
  $('#sidebar-overlay').onclick=()=>{closeSidebar();$('#menu-toggle').focus();};
  let dismiss=$('#sidebar-dismiss');if(!dismiss){dismiss=document.createElement('button');dismiss.id='sidebar-dismiss';$('#sidebar .sidebar-brand').append(dismiss);}
  dismiss.setAttribute('aria-label','Collapse navigation');dismiss.setAttribute('aria-controls','sidebar');dismiss.title='Collapse navigation';dismiss.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
  dismiss.onclick=()=>{if(small())closeSidebar();else{$('#app').classList.add('sidebar-collapsed');try{localStorage.setItem('dll_sidebar_collapsed','true');}catch{}sidebarState();}closePopup();$('#menu-toggle').focus();};
  $('#mobile-notif-btn').onclick=async()=>{const popup=$('#header-notifications');if(!popup.hidden){closePopup();return;}popup.hidden=false;$('#mobile-notif-btn').setAttribute('aria-expanded','true');draw();const id=generation;try{const fresh=await api('/api/notifications');if(id===generation&&currentUser())update(fresh);}catch(err){if(id===generation)$('#header-notification-list').innerHTML=`<p class="header-empty" role="alert">${e(err.message)}. Close and reopen to retry.</p>`;}};
  $('#header-view-all').onclick=()=>{closePopup();navigate('notifications');};$('#header-profile').onclick=()=>navigate('profile');
  document.addEventListener('click',outside);document.addEventListener('keydown',keys);window.addEventListener('resize',closeSidebar);sidebarState();update(data);
 }
 function setPage(title){$('#header-page-title').textContent=title;closePopup();closeSidebar();}
 function destroy(){generation++;data={notifications:[],unread:0};closePopup();closeSidebar();$('#main-content').inert=false;$('#mobile-header').inert=false;document.body.classList.remove('navigation-drawer-open');document.removeEventListener('click',outside);document.removeEventListener('keydown',keys);window.removeEventListener('resize',closeSidebar);}
 return {mount,update,setPage,closeSidebar,destroy};
};
