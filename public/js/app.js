// ================================================================
//  DLL Faculty Consultation Hour Scheduler – Frontend Application
// ================================================================

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  let currentUser = null;
  let currentPage = '';
  let unreadNotifs = 0;
  let queueTimer = null;

  // ── Helpers ────────────────────────────────────────────────
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatQueueTime(ts) {
    if (!ts) return '—';
    try {
      const d = new Date(typeof ts === 'string' ? ts.replace(' ', 'T') : ts);
      if (isNaN(d.getTime())) return ts;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch(e) {
      return ts;
    }
  }

  function getDefaultAvatar(role = 'student') {
    return '/images/default-avatar.png';
  }

  function getUserAvatarSrc(avatarUrl, role = 'student') {
    if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.trim() !== '') {
      return avatarUrl;
    }
    return '/images/default-avatar.png';
  }

  function renderAvatarImg(avatarUrl, name = 'User', role = 'student', extraClasses = '', extraStyle = '') {
    const defaultSrc = '/images/default-avatar.png';
    const src = (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.trim() !== '') ? avatarUrl : defaultSrc;
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" class="${extraClasses}" style="${extraStyle}" onerror="this.onerror=null;this.src='${defaultSrc}';">`;
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const error=new Error(data.error || 'Request failed'); error.details=data; throw error; }
    return data;
  }

  const accountScreens = window.createAccountScreens({api,escapeHtml,openModal,closeModal,toast,navigate,currentUser:()=>currentUser,onRegistered:result=>{ if(result.sign_in_required) {accountScreens.showSignIn();$('#login-email').value=result.user.student_id;toast('Account created. Sign in with your new password.','success');} else {currentUser=result.user;$('#register-form').reset();accountScreens.showSignIn();enterApp();toast('Welcome! Your student account is ready.','success');}}});

  const workflowScreens=window.createWorkflowScreens({api,escapeHtml,openModal,closeModal,toast,navigate,currentUser:()=>currentUser,showQRPassModal});
  const portalHeader=window.createPortalHeader({api,escapeHtml,navigate,currentUser:()=>currentUser});
  const consultationOverview=window.createConsultationOverview({escapeHtml,navigate,showPass:showQRPassModal,showDetails:(a,refresh)=>workflowScreens.showDetails(a,refresh)});
  let notificationTimer=null;

  // ── Toast ──────────────────────────────────────────────────
  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
      type === 'success' ? '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' :
      type === 'error'   ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' :
      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
    }</svg><span>${escapeHtml(message)}</span>`;
    $('#toast-container').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3000);
  }

  // ── Modal ──────────────────────────────────────────────────
  let modalCleanup=null;
  function openModal(title, bodyHtml, footerHtml = '') {
    if(modalCleanup){const cleanup=modalCleanup;modalCleanup=null;cleanup();}
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-footer').innerHTML = footerHtml;
    $('#modal-overlay').classList.remove('hidden');
  }
  function closeModal() { if(modalCleanup){const cleanup=modalCleanup;modalCleanup=null;cleanup();} $('#modal-overlay').classList.add('hidden'); }
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) closeModal(); });

  // ── QR Pass Modal (Student) ────────────────────────────────
  const consultationPass=window.createConsultationPass({api,escapeHtml,openModal,closeModal,toast,onCleanup:fn=>{modalCleanup=fn;},loadNotifCount});
  function showQRPassModal(appt){return consultationPass.show(appt);}
  function showFacultyCheckInModal(onSuccess){consultationPass.scan(onSuccess);}

  // ── Login ──────────────────────────────────────────────────
  let loginRole = 'student';

  function updateLoginLabels() {
    $('#signup-invite')?.classList.toggle('hidden',loginRole !== 'student');
    const label = $('#login-id-label');
    const input = $('#login-email');
    if (label && input) {
      if (loginRole === 'student') {
        label.textContent = 'Student Number';
        input.placeholder = 'Enter your student number';
      } else if (loginRole === 'admin') {
        label.textContent = 'Administrator Username';
        input.placeholder = 'Enter your admin username';
      } else {
        label.textContent = 'Faculty ID / Email Address';
        input.placeholder = 'Enter your Faculty ID or institutional email';
      }
    }
  }

  $$('.role-tab').forEach(btn => btn.addEventListener('click', () => {
    loginRole = btn.dataset.role;
    $$('.role-tab').forEach(b => b.classList.toggle('active', b === btn));
    updateLoginLabels();
    $('#login-error')?.classList.add('hidden');
  }));

  // Show/hide password
  $('#toggle-pwd').addEventListener('click', () => {
    const inp = $('#login-password');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('#toggle-pwd .eye-open').classList.toggle('hidden', show);
    $('#toggle-pwd .eye-closed').classList.toggle('hidden', !show);
  });

  // Submit login
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errBox = $('#login-error');
    errBox.classList.add('hidden');

    const emailVal = ($('#login-email')?.value || '').trim();
    const pwdVal = $('#login-password')?.value || '';

    if (!emailVal || !pwdVal) {
      errBox.textContent = loginRole === 'student'
        ? 'Please enter your Student ID/email and password.'
        : 'Please enter your Faculty ID/email and password.';
      errBox.classList.remove('hidden');
      return;
    }

    const btn = $('#login-btn');
    btn.disabled = true;
    btn.querySelector('.btn-text').classList.add('hidden');
    btn.querySelector('.btn-loader').classList.remove('hidden');

    try {
      const { user } = await api('/api/login', { method: 'POST', body: {
        email: emailVal,
        password: pwdVal,
        role: loginRole,
      }});

      if (!user || user.role !== loginRole) {
        throw new Error(loginRole === 'student'
          ? 'Invalid student credentials. Please check your Student ID/email and password.'
          : 'Invalid faculty credentials. Please check your Faculty ID/email and password.');
      }

      currentUser = user;
      enterApp();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.querySelector('.btn-text').classList.remove('hidden');
      btn.querySelector('.btn-loader').classList.add('hidden');
    }
  });

  function enterApp() {
    clearInterval(notificationTimer);notificationTimer=setInterval(()=>{if(currentUser)loadNotifCount();},30000);
    $('#landing-page').classList.add('hidden');
    $('#login-page').classList.add('hidden');
    $('#app').classList.remove('hidden');
    buildSidebar();
    navigate(currentUser.role === 'admin' ? 'admin-dashboard' : currentUser.role === 'student' ? 'dashboard' : 'faculty-dashboard');
    loadNotifCount();
  }

  async function logout() {
    clearInterval(notificationTimer);notificationTimer=null;
    portalHeader.destroy();closeModal();
    if (queueTimer) { clearInterval(queueTimer); queueTimer = null; }
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    if (currentUser) { localStorage.removeItem('dll_student_queue_'+currentUser.id); localStorage.removeItem('dll_faculty_queue_'+currentUser.id); }
    currentUser = null;
    $('#app').classList.add('hidden');
    $('#login-page').classList.add('hidden');
    $('#landing-page').classList.remove('hidden');
    $('#login-email').value = '';
    $('#login-password').value = '';
  }

  // ── Page Navigation Helpers ────────────────────────────────
  function showLoginPage() {
    accountScreens.showSignIn();
    $('#landing-page')?.classList.add('hidden');
    $('#login-page')?.classList.remove('hidden');
    $('#app')?.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => $('#login-email')?.focus(), 60);
  }

  function showLandingPage() {
    $('#login-page')?.classList.add('hidden');
    $('#landing-page')?.classList.remove('hidden');
    $('#app')?.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Delegated click listeners for Sign In / Back buttons (desktop & mobile)
  document.addEventListener('click', (e) => {
    const loginTrigger = e.target.closest('.goto-login-btn, #landing-signin-btn, a[href="#login"]');
    if (loginTrigger) {
      e.preventDefault();
      showLoginPage();
      return;
    }
    const backTrigger = e.target.closest('#back-to-landing');
    if (backTrigger) {
      e.preventDefault();
      showLandingPage();
      return;
    }
  });

  // URL hash navigation support
  if (window.location.hash === '#login') {
    showLoginPage();
  }
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#login') {
      showLoginPage();
    } else if (window.location.hash === '' || window.location.hash === '#') {
      if (!currentUser) showLandingPage();
    }
  });

  // Check session on load
  (async () => {
    try {
      const { user } = await api('/api/me');
      currentUser = user;
      enterApp();
    } catch { 
      // A late session check must not interrupt signup or a completed sign-in.
      if (!currentUser && window.location.hash === '#login' && $('#register-form').classList.contains('hidden')) {
        showLoginPage();
      }
    }
  })();

  // ── Sidebar ────────────────────────────────────────────────
  const NAV = {
    student: [
      { id: 'dashboard',       label: 'Dashboard',          icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
      { id: 'book',            label: 'Book Consultation',   icon: 'M12 4v16m8-8H4' },
      { id: 'appointments',    label: 'My Appointments',     icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
      { id: 'queue',           label: 'Consultation Queue',  icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
      { id: 'directory',       label: 'Faculty Members',    icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
      { id: 'analytics',       label: 'Analytics Dashboard', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { id: 'notifications',   label: 'Notifications',       icon: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0', badge: true },
      { id: 'profile',         label: 'Profile',             icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4-4v2M12 3a4 4 0 100 8 4 4 0 000-8' },
    ],
    faculty: [
      { id: 'faculty-dashboard', label: 'Dashboard',            icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
      { id: 'fac-requests',     label: 'Appointment Requests',  icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', badge: true },
      { id: 'fac-queue',        label: 'Virtual Queue & QR',    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { id: 'fac-schedule',     label: 'My Schedule',           icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
      { id: 'fac-availability', label: 'Availability',          icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
      { id: 'fac-students',     label: 'My Students',           icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
      { id: 'analytics',        label: 'Analytics Dashboard',   icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { id: 'notifications',    label: 'Notifications',         icon: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0', badge: true },
      { id: 'profile',          label: 'Profile',               icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4-4v2M12 3a4 4 0 100 8 4 4 0 000-8' },
    ]
  };

  NAV.admin = [
    {id:'admin-dashboard',label:'Overview',icon:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'},
    {id:'admin-accounts',label:'User Accounts',icon:'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 3a4 4 0 100 8 4 4 0 000-8M23 21v-2a4 4 0 00-3-3.87'},
    {id:'admin-records',label:'Appointment Records',icon:NAV.faculty.find(x=>x.id==='fac-requests').icon},
    {id:'analytics',label:'IT Department Reports',icon:NAV.faculty.find(x=>x.id==='analytics').icon},
    {id:'notifications',label:'Notifications',icon:NAV.faculty.find(x=>x.id==='notifications').icon,badge:true},
    {id:'profile',label:'My Profile',icon:NAV.faculty.find(x=>x.id==='profile').icon}
  ];

  for (const role of ['faculty','admin']) NAV[role].splice(2,0,{...NAV.student.find(x=>x.id==='directory')});

  function buildSidebar() {
    const avatarHtml = renderAvatarImg(currentUser.avatar, currentUser.name, currentUser.role);

    $('#sidebar-user').innerHTML = `
      <div class="user-avatar">${avatarHtml}</div>
      <div class="user-info">
        <div class="user-name">${escapeHtml(currentUser.name)}</div>
        <div class="user-role">${currentUser.role}</div>
      </div>`;

    const links = NAV[currentUser.role];
    $('#sidebar-nav').innerHTML = links.map(l => `
      <button class="sidebar-link${l.id===currentPage?' active':''}" data-page="${l.id}" ${l.id===currentPage?'aria-current="page"':''}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${l.icon}"/></svg>
        <span>${l.label}</span>
        ${l.badge ? '<span class="badge-count hidden" id="badge-' + l.id + '"></span>' : ''}
      </button>
    `).join('');

    $$('.sidebar-link[data-page]').forEach(a => a.addEventListener('click', () => navigate(a.dataset.page)));
    $('#btn-logout').onclick=logout;

    portalHeader.mount();
    if(currentPage)portalHeader.setPage(NAV[currentUser.role].find(x=>x.id===currentPage)?.label||'My Profile');
  }

  function closeSidebar() { portalHeader.closeSidebar(); }

  // ── Router ─────────────────────────────────────────────────
  function navigate(page) {
    if (queueTimer && page !== 'queue' && page !== 'fac-queue') {
      clearInterval(queueTimer);
      queueTimer = null;
    }
    if (!NAV[currentUser.role]?.some(x=>x.id===page)) return;
    currentPage = page;
    portalHeader.setPage(NAV[currentUser.role].find(x=>x.id===page)?.label||page);
    closeSidebar();
    $$('.sidebar-link[data-page]').forEach(a => {const active=a.dataset.page===page;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    renderPage(page);
  }

  function renderPage(page) {
    const el = $('#page-content');
    el.style.opacity = '0';
    setTimeout(() => {
      if (!currentUser || currentPage!==page || !el.isConnected) return;
      switch (page) {
        case 'admin-dashboard': accountScreens.renderOverview(el); break;
        case 'admin-accounts': accountScreens.renderAccounts(el); break;
        case 'admin-records': workflowScreens.renderRecords(el); break;
        case 'dashboard':          renderStudentDashboard(el); break;
        case 'book':               renderBookConsultation(el); break;
        case 'appointments':       renderMyAppointments(el);   break;
        case 'queue':              renderStudentQueue(el);     break;
        case 'directory':          renderFacultyDirectory(el); break;
        case 'notifications':      renderNotifications(el);    break;
        case 'profile':            renderProfile(el);          break;
        case 'faculty-dashboard':  renderFacultyDashboard(el); break;
        case 'fac-requests':       renderFacRequests(el);      break;
        case 'fac-queue':          renderFacultyQueue(el);     break;
        case 'fac-schedule':       renderFacSchedule(el);      break;
        case 'fac-availability':   renderFacAvailability(el);  break;
        case 'fac-students':       renderFacStudents(el);      break;
        case 'analytics':          renderAnalytics(el);        break;
        default: el.innerHTML = '<p>Page not found.</p>';
      }
      el.style.transition = 'opacity .25s ease';
      el.style.opacity = '1';
    }, 50);
  }

  // ── Notification helpers ───────────────────────────────────
  async function loadNotifCount() {
    try {
      const owner=currentUser?.id;
      const notificationData = await api('/api/notifications');
      const {unread}=notificationData;
      if (!currentUser) return;
      if(currentUser.id!==owner)return;
      portalHeader.update(notificationData);
      unreadNotifs = unread;
      const badge = $(`#badge-notifications`);
      if (badge) { badge.textContent = unread; badge.classList.toggle('hidden', unread === 0); }
      const dot = $('#mobile-notif-dot');
      if (dot) dot.classList.toggle('hidden', unread === 0);
      if (currentUser.role === 'faculty') {
        const [stats,reschedules] = await Promise.all([api('/api/stats'),api('/api/reschedules')]);
        if (!currentUser) return;
        const pendingTotal=stats.pending+reschedules.filter(r=>r.status==='pending'&&r.requested_by!==currentUser.id).length;
        const fb = $('#badge-fac-requests');
        if (fb) { fb.textContent = pendingTotal; fb.classList.toggle('hidden', pendingTotal === 0); }
      }
    } catch {}
  }

  // ══════════════════════════════════════════════════════════
  //  STUDENT PAGES
  // ══════════════════════════════════════════════════════════

  // ── Student Dashboard ──────────────────────────────────────
  async function renderStudentDashboard(el) {
    el.innerHTML = '<p style="color:var(--text-light)">Loading…</p>';
    try {
      const stats = await api('/api/stats');
      const appts = await api('/api/appointments');
      if (!currentUser || currentPage!=='dashboard' || !el.isConnected) return;
      const upcoming = appts.filter(a => (a.status === 'approved' || a.status === 'checked-in') && a.date >= new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})).slice(0,5);

      el.innerHTML = `
        <div class="page-header">
          <div>
            <h1>Welcome back, ${escapeHtml(currentUser.name.split(' ')[0])}!</h1>
            <p>${new Date().toLocaleDateString('en-US', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            <button class="btn btn-outline" id="goto-student-queue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              Live Queue & QR
            </button>
            <button class="btn btn-primary" id="quick-book">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Book Consultation
            </button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card"><div class="stat-icon blue"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div><div class="stat-value">${stats.upcoming}</div><div class="stat-label">Upcoming</div></div></div>
          <div class="stat-card"><div class="stat-icon yellow"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div><div class="stat-value">${stats.pending}</div><div class="stat-label">Pending</div></div></div>
          <div class="stat-card"><div class="stat-icon green"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><div><div class="stat-value">${stats.approved}</div><div class="stat-label">Approved</div></div></div>
          <div class="stat-card"><div class="stat-icon purple"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><div><div class="stat-value">${stats.completed}</div><div class="stat-label">Completed</div></div></div>
        </div>

        <div class="card">
          <div class="card-header"><h2>Upcoming Appointments</h2></div>
          ${upcoming.length === 0
            ? '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><p>No upcoming appointments</p></div>'
            : `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Faculty</th><th>Date</th><th>Time</th><th>Purpose</th><th>Status</th><th>Pass</th></tr></thead><tbody>${
                upcoming.map(a => `<tr>
                  <td>
                    <div class="user-avatar-cell">
                      ${renderAvatarImg(a.faculty_avatar, a.faculty_name, 'faculty', 'table-avatar')}
                      <div>
                        <strong>${escapeHtml(a.faculty_name)}</strong><br>
                        <small style="color:var(--text-muted)">${escapeHtml(a.faculty_dept || '')}</small>
                      </div>
                    </div>
                  </td>
                  <td>${a.date}</td>
                  <td>${a.time_slot} – ${a.end_time}</td>
                  <td>${escapeHtml(a.purpose)}</td>
                  <td><span class="badge ${a.status}">${a.status}</span></td>
                  <td><button class="btn btn-outline btn-sm quick-view-qr" data-id="${a.id}">QR Pass</button></td>
                </tr>`).join('')
              }</tbody></table></div>`
          }
        </div>
      `;
      consultationOverview.mount(el,appts,false,()=>renderStudentDashboard(el));
      $('#quick-book')?.addEventListener('click', () => navigate('book'));
      $('#goto-student-queue')?.addEventListener('click', () => navigate('queue'));
      $$('.quick-view-qr').forEach(b => b.addEventListener('click', () => {
        const match = upcoming.find(x => x.id === Number(b.dataset.id));
        if (match) showQRPassModal(match);
      }));
    } catch (err) { el.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`; }
  }

  // ── Book Consultation (With Smart Time-Slot Recommendation) ──
  async function renderBookConsultation(el) {
    el.innerHTML = '<p style="color:var(--text-light)">Loading faculty…</p>';
    const faculty = await api('/api/faculty');

    const seed=directoryBookingSeed; directoryBookingSeed=null;
    let selectedFac = seed ? faculty.find(f=>f.id===seed.faculty.id) || null : null;
    let selectedDate = selectedFac ? seed.date : '';
    let selectedSlot = selectedFac ? seed.slot : null;
    let calMonth = new Date().getMonth();
    let calYear = new Date().getFullYear();
    let cachedRec = null;

    function currentStep() {
      if (!selectedFac) return 1;
      if (!selectedDate) return 2;
      if (!selectedSlot) return 3;
      return 4;
    }

    function renderSteps() {
      const s = currentStep();
      return `<div class="steps">${
        [['Faculty',1],['Date',2],['Time',3],['Details',4]].map(([lbl,n],i) =>
          `${i > 0 ? '<div class="step-line"></div>' : ''}<div class="step ${n < s ? 'done' : n === s ? 'active' : ''}"><span class="step-num">${n}</span>${lbl}</div>`
        ).join('')
      }</div>`;
    }

    function render() {
      const step = currentStep();
      el.innerHTML = `
        <div class="page-header"><div><h1>Book Consultation</h1><p>Schedule a meeting with your faculty adviser</p></div></div>
        ${renderSteps()}
        <div class="card" id="booking-area"></div>
      `;
      const area = $('#booking-area');
      if (step === 1) renderFacultyPicker(area);
      else if (step === 2) renderDatePicker(area);
      else if (step === 3) renderTimePicker(area);
      else renderDetailsForm(area);
    }

    function renderFacultyPicker(area) {
      area.innerHTML = `
        <div class="card-header"><h2>Select Faculty</h2></div>
        <div style="margin-bottom:1.25rem">
          <div class="search-box-wrapper search-medium">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search faculty by name, department, or specialization…" id="book-fac-search" class="search-input" autocomplete="off">
          </div>
        </div>
        <div id="book-fac-grid" class="grid-3"></div>
      `;

      function updatePickerGrid(searchVal = '') {
        const q = searchVal.trim().toLowerCase();
        const list = faculty.filter(f => 
          !q || 
          f.name.toLowerCase().includes(q) || 
          (f.department && f.department.toLowerCase().includes(q)) || 
          (f.specialization && f.specialization.toLowerCase().includes(q))
        );

        const grid = $('#book-fac-grid');
        if (!grid) return;

        if (list.length === 0) {
          grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>No faculty members match "${escapeHtml(searchVal)}".</p></div>`;
          return;
        }

        grid.innerHTML = list.map(f => {
          const schedTxt = f.schedules.map(s => `${s.specific_date || DAYS_SHORT[s.day_of_week]} ${s.start_time}–${s.end_time} (${s.slot_duration || 15} min)`).join(', ') || 'No schedule set';
          return `
            <div class="faculty-card">
              <div class="faculty-avatar">
                ${renderAvatarImg(f.avatar, f.name, 'faculty')}
              </div>
              <h3>${escapeHtml(f.name)}</h3>
              <div class="dept">${escapeHtml(f.department)}</div>
              <div class="spec">${escapeHtml(f.specialization)}</div>
              <div class="schedule-preview">${schedTxt}</div>
              <button class="btn btn-primary pick-fac" data-id="${f.id}">Select</button>
            </div>
          `;
        }).join('');

        $$('.pick-fac').forEach(b => b.addEventListener('click', async () => {
          selectedFac = faculty.find(f => f.id === Number(b.dataset.id));
          cachedRec = null;
          render();
        }));
      }

      updatePickerGrid('');
      $('#book-fac-search')?.addEventListener('input', e => updatePickerGrid(e.target.value));
    }

    let timePickerInterval = null;

    async function renderDatePicker(area) {
      if (timePickerInterval) { clearInterval(timePickerInterval); timePickerInterval = null; }

      const today = new Date();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth();

      // Guard: strictly disallow viewing months prior to current month
      if (calYear < currentYear || (calYear === currentYear && calMonth < currentMonth)) {
        calYear = currentYear;
        calMonth = currentMonth;
      }

      const isCurrentMonth = (calYear === currentYear && calMonth === currentMonth);
      const first = new Date(calYear, calMonth, 1);
      const startDay = first.getDay();
      const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
      const monthName = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      let cells = DAYS_SHORT.map(d => `<div class="cal-head">${d}</div>`).join('');
      for (let i = 0; i < startDay; i++) cells += '<div class="cal-day empty"></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dt = new Date(calYear, calMonth, d);
        const past = dt < todayDateOnly;
        const weekend = dt.getDay() === 0 || dt.getDay() === 6;
        const isToday = (calYear === currentYear && calMonth === currentMonth && d === today.getDate());
        const sel = dateStr === selectedDate;
        const disabled = past;
        cells += `<div class="cal-day${disabled?' disabled':''}${isToday?' today':''}${sel?' selected':''}" data-date="${dateStr}" ${disabled ? 'aria-disabled="true" style="pointer-events:none;opacity:0.35;cursor:not-allowed"' : ''}>${d}</div>`;
      }

      area.innerHTML = `
        <div class="card-header">
          <h2>Select Date</h2>
          <button class="btn btn-outline btn-sm" id="back-step1">← Back</button>
        </div>
        <p style="margin-bottom:1rem;font-size:.88rem;color:var(--text-muted)">Faculty: <strong>${escapeHtml(selectedFac.name)}</strong> (${escapeHtml(selectedFac.department)})</p>

        <!-- Smart Recommendation Card -->
        <div id="smart-rec-placeholder">
          <div style="padding:1rem;background:var(--accent-light);border-radius:var(--radius);font-size:0.85rem;color:var(--accent-hover);margin-bottom:1.25rem">
            Analyzing available consultation hours & finding earliest conflict-free slot…
          </div>
        </div>

        <div class="calendar-nav">
          <button id="cal-prev" ${isCurrentMonth ? 'disabled class="disabled"' : ''} title="${isCurrentMonth ? 'Past months cannot be selected' : 'Previous month'}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h3>${monthName}</h3>
          <button id="cal-next" title="Next month">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="cal-grid">${cells}</div>`;

      $('#back-step1').addEventListener('click', () => { selectedFac = null; cachedRec = null; render(); });

      $('#cal-prev').addEventListener('click', () => {
        if (calYear < currentYear || (calYear === currentYear && calMonth <= currentMonth)) {
          return; // Prevent navigating to past months
        }
        calMonth--;
        if (calMonth < 0) {
          calMonth = 11;
          calYear--;
        }
        renderDatePicker(area);
      });

      $('#cal-next').addEventListener('click', () => {
        calMonth++;
        if (calMonth > 11) {
          calMonth = 0;
          calYear++;
        }
        renderDatePicker(area);
      });

      $$('.cal-day:not(.disabled):not(.empty)').forEach(d => d.addEventListener('click', () => {
        selectedDate = d.dataset.date;
        selectedSlot = null;
        render();
      }));

      // Fetch and mount Smart Recommendation (always fetch fresh)
      try {
        const recData = await api(`/api/faculty/${selectedFac.id}/recommendation`);
        cachedRec = recData;
        const recHolder = $('#smart-rec-placeholder');
        if (recHolder && recData) {
          const rec = recData.recommendation || recData.recommended;
          const alts = recData.alternatives || [];

          if (rec) {
            recHolder.innerHTML = `
              <div class="smart-recommendation-card">
                <div style="flex:1">
                  <div class="smart-rec-header">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    <span>Smart Recommendation</span>
                    <span class="smart-rec-badge">Earliest Available</span>
                  </div>
                  <div class="smart-rec-slot">${rec.day_name}, ${rec.date} · ${rec.time_slot} – ${rec.end_time}</div>
                  <div class="smart-rec-reason">${rec.reason || 'Earliest available time slot with zero double bookings or schedule conflicts.'}</div>
                </div>
                <div class="smart-rec-actions">
                  <button class="btn btn-primary" id="btn-book-rec">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    Book Recommended Slot
                  </button>
                </div>
                ${alts.length > 0 ? `
                  <div class="alternatives-container">
                    <div class="alt-title">Alternative Available Schedules:</div>
                    <div class="alt-chips">
                      ${alts.map(a => `
                        <button class="alt-chip pick-alt-btn" data-date="${a.date}" data-start="${a.time_slot}" data-end="${a.end_time}">
                          ${a.day_name.slice(0,3)}, ${a.date.slice(5)} · ${a.time_slot} – ${a.end_time}
                        </button>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            `;

            $('#btn-book-rec')?.addEventListener('click', () => {
              selectedDate = rec.date;
              selectedSlot = { start: rec.time_slot, end: rec.end_time };
              render();
            });

            $$('.pick-alt-btn').forEach(btn => btn.addEventListener('click', () => {
              selectedDate = btn.dataset.date;
              selectedSlot = { start: btn.dataset.start, end: btn.dataset.end };
              render();
            }));
          } else {
            recHolder.innerHTML = `
              <div style="padding:0.75rem 1rem;background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius);font-size:0.83rem;color:var(--text-muted);margin-bottom:1.25rem">
                ℹ️ No available consultation slots for this faculty member within the upcoming schedule.
              </div>
            `;
          }
        }
      } catch (err) {
        $('#smart-rec-placeholder').innerHTML = '';
      }
    }

    async function renderTimePicker(area) {
      if (timePickerInterval) { clearInterval(timePickerInterval); timePickerInterval = null; }

      area.innerHTML = `
        <div class="card-header">
          <h2>Select Time Slot</h2>
          <button class="btn btn-outline btn-sm" id="back-step2">← Back to Calendar</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
          <p style="margin:0;font-size:.88rem;color:var(--text-muted)">Faculty: <strong>${escapeHtml(selectedFac.name)}</strong> · Selected Date: <strong>${selectedDate}</strong></p>
          <button class="btn btn-outline btn-sm" id="btn-refresh-slots" style="padding:0.25rem 0.65rem;font-size:0.78rem;display:inline-flex;align-items:center;gap:4px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Refresh Availability
          </button>
        </div>
        <div id="slots-view-area">
          <p style="color:var(--text-light);font-size:0.88rem" id="slot-loader">Loading genuinely available slots…</p>
        </div>
        <div id="slot-alt-box" style="margin-top:1.25rem"></div>`;

      $('#back-step2').addEventListener('click', () => {
        if (timePickerInterval) { clearInterval(timePickerInterval); timePickerInterval = null; }
        selectedDate = '';
        render();
      });

      $('#btn-refresh-slots')?.addEventListener('click', () => {
        loadAvailableSlots(true);
      });

      async function loadAvailableSlots(manualRefresh = false) {
        try {
          const slots = await api(`/api/faculty/${selectedFac.id}/slots?date=${selectedDate}`);
          const viewArea = $('#slots-view-area');
          if (!viewArea) return;

          $('#slot-loader')?.remove();

          // Check if previously selected slot was taken in the meantime
          if (selectedSlot && !slots.some(s => s.start === selectedSlot.start)) {
            selectedSlot = null;
            toast('The previously selected slot has just been reserved. Please pick another available time.', 'info');
          }

          if (slots.length === 0) {
            viewArea.innerHTML = `
              <div class="empty-state" style="padding:1.5rem;background:#f8fafc;border:1px dashed var(--border);border-radius:var(--radius)">
                <p style="font-weight:600;color:var(--text);margin-bottom:0.35rem">No available consultation slots for this date.</p>
                <p style="font-size:0.83rem;color:var(--text-muted);margin-bottom:1rem">All consultation hours on this date are either fully booked, blocked, or have already passed.</p>
                <div style="text-align:left">
                  <div style="font-size:0.85rem;font-weight:600;color:var(--text);margin-bottom:0.5rem">Alternative available consultation dates & times:</div>
                  <div class="alt-chips" id="timepicker-alts">Loading alternatives…</div>
                </div>
              </div>
            `;

            try {
              const freshRec = await api(`/api/faculty/${selectedFac.id}/recommendation`);
              cachedRec = freshRec;
              const alts = [freshRec.recommendation || freshRec.recommended, ...(freshRec.alternatives || [])].filter(Boolean);
              const altCont = $('#timepicker-alts');
              if (altCont) {
                if (alts.length > 0) {
                  altCont.innerHTML = alts.map(a => `
                    <button class="alt-chip pick-alt-from-time" data-date="${a.date}" data-start="${a.time_slot}" data-end="${a.end_time}">
                      ${a.day_name.slice(0,3)}, ${a.date} · ${a.time_slot} – ${a.end_time}
                    </button>
                  `).join('');
                  $$('.pick-alt-from-time').forEach(b => b.addEventListener('click', () => {
                    if (timePickerInterval) { clearInterval(timePickerInterval); timePickerInterval = null; }
                    selectedDate = b.dataset.date;
                    selectedSlot = { start: b.dataset.start, end: b.dataset.end };
                    render();
                  }));
                } else {
                  altCont.innerHTML = '<span style="font-size:0.82rem;color:var(--text-muted)">No alternative slots found within the next 2 weeks.</span>';
                }
              }
            } catch (e) {
              const altCont = $('#timepicker-alts');
              if (altCont) altCont.innerHTML = '<span style="font-size:0.82rem;color:var(--text-muted)">Please return to the calendar to select another date.</span>';
            }
            return;
          }

          viewArea.innerHTML = `
            <div class="slots-grid">
              ${slots.map(s => {
                const isSelected = selectedSlot && selectedSlot.start === s.start;
                return `<button class="slot-btn${isSelected ? ' selected' : ''}" data-start="${s.start}" data-end="${s.end}">${s.start} – ${s.end}</button>`;
              }).join('')}
            </div>
            <div id="continue-btn-holder" style="margin-top:1.25rem">
              ${selectedSlot ? '<button class="btn btn-primary" id="goto-step4">Continue to Details →</button>' : ''}
            </div>
          `;

          $$('.slot-btn').forEach(b => b.addEventListener('click', () => {
            $$('.slot-btn').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            selectedSlot = { start: b.dataset.start, end: b.dataset.end };

            const holder = $('#continue-btn-holder');
            if (holder) {
              holder.innerHTML = '<button class="btn btn-primary" id="goto-step4">Continue to Details →</button>';
              $('#goto-step4').onclick = () => {
                if (timePickerInterval) { clearInterval(timePickerInterval); timePickerInterval = null; }
                render();
              };
            }
          }));

          $('#goto-step4')?.addEventListener('click', () => {
            if (timePickerInterval) { clearInterval(timePickerInterval); timePickerInterval = null; }
            render();
          });

          if (manualRefresh) {
            toast('Availability updated', 'info');
          }
        } catch (err) {
          const viewArea = $('#slots-view-area');
          if (viewArea) viewArea.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
        }
      }

      await loadAvailableSlots();

      // Real-time polling: refresh available slots every 6 seconds while on time picker
      timePickerInterval = setInterval(() => {
        if (currentStep() === 3 && selectedDate) {
          loadAvailableSlots(false);
        } else {
          clearInterval(timePickerInterval);
          timePickerInterval = null;
        }
      }, 6000);
    }

    function renderDetailsForm(area) {
      if (timePickerInterval) { clearInterval(timePickerInterval); timePickerInterval = null; }

      const PREDEFINED_PURPOSES = [
        'Capstone / Project Consultation',
        'Thesis / Research Consultation',
        'Programming / Coding Assistance',
        'Database / System Development Assistance',
        'Subject / Course Consultation',
        'Academic Advising',
        'Requirements / Task Clarification',
        'Career / Internship Guidance',
        'Other'
      ];

      area.innerHTML = `
        <div class="card-header"><h2>Consultation Details</h2><button class="btn btn-outline btn-sm" id="back-step3">← Back</button></div>
        <div class="detail-row"><span class="detail-label">Faculty</span><span class="detail-value">${escapeHtml(selectedFac.name)}</span></div>
        <div class="detail-row"><span class="detail-label">Department</span><span class="detail-value">${escapeHtml(selectedFac.department)}</span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${selectedDate}</span></div>
        <div class="detail-row"><span class="detail-label">Time Slot</span><span class="detail-value">${selectedSlot.start} – ${selectedSlot.end}</span></div>

        <!-- Searchable Combobox for Purpose -->
        <div class="field" style="margin-top:1.25rem">
          <label for="b-purpose">Purpose of Consultation <span style="color:var(--danger)">*</span></label>
          <div class="combobox-wrapper" id="purpose-combobox">
            <div class="combobox-input-wrapper">
              <input type="text" id="b-purpose" class="combobox-input" placeholder="Select or type consultation purpose…" autocomplete="off" required>
              <button type="button" class="combobox-arrow-btn" id="combobox-toggle" tabindex="-1" aria-label="Toggle purpose options">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            </div>
            <div class="combobox-dropdown" id="combobox-dropdown" role="listbox" style="display:none"></div>
          </div>
          <small style="color:var(--text-muted);font-size:0.78rem;margin-top:0.35rem;display:block">
            Choose from the predefined options or type your own custom purpose.
          </small>
        </div>

        <div class="field"><label for="b-remarks">Remarks (optional)</label><textarea id="b-remarks" placeholder="Additional notes or topics to discuss…"></textarea></div>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem">
          <button class="btn btn-outline" id="back-step3b">Back</button>
          <button class="btn btn-primary" id="submit-booking">Submit Request</button>
        </div>`;

      // ── Combobox Component Implementation ──
      const comboboxWrapper = $('#purpose-combobox');
      const purposeInput = $('#b-purpose');
      const comboboxToggle = $('#combobox-toggle');
      const comboboxDropdown = $('#combobox-dropdown');
      let activeIndex = -1;
      let isOpen = false;

      function renderComboboxOptions(filterText = '') {
        const q = filterText.trim().toLowerCase();
        const matches = PREDEFINED_PURPOSES.filter(p => !q || p.toLowerCase().includes(q));

        let html = '';
        if (matches.length > 0) {
          matches.forEach((p, idx) => {
            const isExact = (p.toLowerCase() === purposeInput.value.trim().toLowerCase());
            html += `
              <div class="combobox-option${isExact ? ' selected' : ''}" data-value="${p}" data-index="${idx}" role="option">
                <span>${p}</span>
                <svg class="option-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              </div>`;
          });
        }

        // Custom purpose option if typed text doesn't exactly match any predefined option
        const hasExactMatch = PREDEFINED_PURPOSES.some(p => p.toLowerCase() === q);
        if (q && !hasExactMatch) {
          html += `
            <div class="combobox-option combobox-custom-option" data-value="${escapeHtml(purposeInput.value.trim())}" data-index="${matches.length}" role="option">
              <span>Use custom: "<strong>${escapeHtml(purposeInput.value.trim())}</strong>"</span>
              <svg class="option-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            </div>`;
        }

        if (!html) {
          html = '<div class="combobox-empty-message">No matching purpose. Keep typing to use your custom purpose.</div>';
        }

        comboboxDropdown.innerHTML = html;
        activeIndex = -1;
      }

      function openCombobox() {
        if (isOpen) return;
        isOpen = true;
        comboboxWrapper.classList.add('open');
        comboboxDropdown.style.display = 'block';
        renderComboboxOptions(purposeInput.value);
      }

      function closeCombobox() {
        if (!isOpen) return;
        isOpen = false;
        comboboxWrapper.classList.remove('open');
        comboboxDropdown.style.display = 'none';
        activeIndex = -1;
      }

      function toggleCombobox() {
        if (isOpen) {
          closeCombobox();
        } else {
          purposeInput.focus();
          openCombobox();
        }
      }

      purposeInput.addEventListener('focus', () => {
        openCombobox();
      });

      purposeInput.addEventListener('input', () => {
        if (!isOpen) openCombobox();
        else renderComboboxOptions(purposeInput.value);
      });

      comboboxToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCombobox();
      });

      comboboxDropdown.addEventListener('mousedown', (e) => {
        const option = e.target.closest('.combobox-option');
        if (!option) return;
        e.preventDefault();
        const value = option.dataset.value;
        purposeInput.value = value;
        closeCombobox();
      });

      purposeInput.addEventListener('keydown', (e) => {
        const options = comboboxDropdown.querySelectorAll('.combobox-option');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (!isOpen) {
            openCombobox();
            return;
          }
          if (options.length === 0) return;
          activeIndex = (activeIndex + 1) % options.length;
          updateOptionHighlight(options);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (!isOpen) {
            openCombobox();
            return;
          }
          if (options.length === 0) return;
          activeIndex = (activeIndex - 1 + options.length) % options.length;
          updateOptionHighlight(options);
        } else if (e.key === 'Enter') {
          if (isOpen && activeIndex >= 0 && options[activeIndex]) {
            e.preventDefault();
            purposeInput.value = options[activeIndex].dataset.value;
            closeCombobox();
          }
        } else if (e.key === 'Escape') {
          closeCombobox();
        }
      });

      function updateOptionHighlight(options) {
        options.forEach((opt, idx) => {
          if (idx === activeIndex) {
            opt.classList.add('highlighted');
            opt.scrollIntoView({ block: 'nearest' });
          } else {
            opt.classList.remove('highlighted');
          }
        });
      }

      const onDocClick = (e) => {
        if (!comboboxWrapper.contains(e.target)) {
          closeCombobox();
        }
      };
      document.addEventListener('click', onDocClick);

      function cleanupListeners() {
        document.removeEventListener('click', onDocClick);
      }

      $('#back-step3').addEventListener('click', () => {
        cleanupListeners();
        selectedSlot = null;
        render();
      });
      $('#back-step3b').addEventListener('click', () => {
        cleanupListeners();
        selectedSlot = null;
        render();
      });

      $('#submit-booking').addEventListener('click', async () => {
        const purpose = $('#b-purpose').value.trim();
        if (!purpose) {
          toast('Purpose of consultation is required', 'error');
          $('#b-purpose').focus();
          return;
        }

        openModal('Confirm Booking', `
          <div class="detail-row"><span class="detail-label">Faculty</span><span class="detail-value">${escapeHtml(selectedFac.name)}</span></div>
          <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${selectedDate}</span></div>
          <div class="detail-row"><span class="detail-label">Time</span><span class="detail-value">${selectedSlot.start} – ${selectedSlot.end}</span></div>
          <div class="detail-row"><span class="detail-label">Purpose</span><span class="detail-value">${escapeHtml(purpose)}</span></div>
        `, `<button class="btn btn-outline" onclick="document.querySelector('#modal-overlay').classList.add('hidden')">Cancel</button>
            <button class="btn btn-primary" id="confirm-book">Confirm</button>`);

        document.getElementById('confirm-book').addEventListener('click', async () => {
          const btn = document.getElementById('confirm-book');
          if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
          try {
            const receipt=await api('/api/appointments', { method: 'POST', body: {
              faculty_id: selectedFac.id,
              date: selectedDate,
              time_slot: selectedSlot.start,
              end_time: selectedSlot.end,
              purpose,
              remarks: $('#b-remarks').value.trim(),
            }});
            cleanupListeners();
            closeModal();
            cachedRec = null;
            navigate('appointments');
            openModal('Request submitted',`<div class="booking-receipt"><span class="account-eyebrow">REQUEST #${receipt.id}</span><h3>Awaiting faculty approval</h3><p><strong>${escapeHtml(selectedFac.name)}</strong><br>${selectedDate} &middot; ${selectedSlot.start}&ndash;${selectedSlot.end} &middot; Philippine Time</p><p>Your time is requested. Wait for faculty approval before attending.</p></div>${window.consultationVenue(selectedFac,escapeHtml)}`, '<button class="btn btn-primary" id="booking-receipt-view">View my appointment</button>');
            $('#booking-receipt-view').onclick=()=>{closeModal();navigate('appointments');};
            loadNotifCount();
          } catch (err) {
            closeModal();
            cachedRec = null;
            toast(err.message || 'This time slot is no longer available. Please select another time.', 'error');
            cleanupListeners();
            // Return to step 3 and refresh available slots
            selectedSlot = null;
            render();
          }
        });
      });
    }

    render();
  }

  // ── My Appointments ────────────────────────────────────────
  async function renderMyAppointments(el) { return workflowScreens.renderAppointments(el); }

  async function renderStudentQueue(el) {
    el.innerHTML = '<p style="color:var(--text-light)">Loading live consultation queue…</p>';
    if (queueTimer) { clearInterval(queueTimer); queueTimer = null; }

    const cacheKey = 'dll_student_queue_' + (currentUser ? currentUser.id : 'default');
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) renderStudentUI(JSON.parse(cached));
    } catch(e) {}

    async function loadData() {
      try {
        const q = await api('/api/queue');
        try { localStorage.setItem(cacheKey, JSON.stringify(q)); } catch(e) {}
        renderStudentUI(q);
      } catch (err) {
        if (!el.querySelector('.queue-spotlight-card') && !el.querySelector('.card')) {
          el.innerHTML = `<div class="empty-state"><p class="error">${escapeHtml(err.message)}</p></div>`;
        }
      }
    }

    function renderStudentUI(q) {
      const item = q.my_turn;
      const history = q.history || [];

      let statusBadge = '';
      let statusDesc = '';
      if (item) {
        if (item.queue_status === 'serving') {
          statusBadge = '<span class="badge serving" style="font-size:0.9rem">● Currently Being Served</span>';
          statusDesc = 'Your consultation is now active! Please proceed to the faculty desk.';
        } else if (item.queue_status === 'next') {
          statusBadge = '<span class="badge next" style="font-size:0.9rem">● Next in Line</span>';
          statusDesc = 'You are next in line! Please prepare your questions and standby.';
        } else if (item.queue_status === 'skipped') {
          statusBadge = '<span class="badge skipped" style="font-size:0.9rem">Turn Skipped</span>';
          statusDesc = 'Please approach your faculty member to return to the queue.';
        } else if (item.status === 'approved') {
          statusBadge = '<span class="badge approved" style="font-size:0.9rem">Awaiting Check-In</span>';
          statusDesc = 'Check in on your appointment date to join the consultation queue.';
        } else if (item.queue_status === 'completed' || item.status === 'completed') {
          statusBadge = '<span class="badge completed" style="font-size:0.9rem">✓ Completed</span>';
          statusDesc = 'Your consultation for today has concluded.';
        } else {
          statusBadge = '<span class="badge waiting" style="font-size:0.9rem">Waiting in Queue</span>';
          statusDesc = item.students_ahead === 0
            ? 'You are next in queue! Waiting for faculty to call.'
            : `Estimated waiting time: ~${item.estimated_wait_minutes} minutes. ${item.students_ahead} student(s) ahead of you.`;
        }
      }

      el.innerHTML = `
        <div class="page-header">
          <div>
            <h1>Virtual Consultation Queue</h1>
            <p>Real-time queue tracking and attendance status</p>
          </div>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-outline" id="refresh-queue-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Refresh
            </button>
          </div>
        </div>

        ${item ? `
          <div class="queue-spotlight-card ${item.queue_status === 'serving' ? 'serving' : item.queue_status === 'next' ? 'next' : ''}" style="margin-bottom:1.5rem">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem">
              <div style="display:flex;gap:1rem;align-items:center">
                ${renderAvatarImg(item.faculty_avatar, item.faculty_name, 'faculty', 'spotlight-avatar')}
                <div>
                  <div class="queue-tag ${item.queue_status === 'serving' ? 'serving' : item.queue_status === 'next' ? 'next' : 'waiting'}">
                    ● Live Consultation Status
                  </div>
                  <div class="queue-large-num">Queue #${item.queue_number || '—'}</div>
                  <div class="queue-user-name">${escapeHtml(item.faculty_name)} (${escapeHtml(item.faculty_dept || '')})</div>
                  <div class="queue-meta-text">Scheduled: ${item.date} · ${item.time_slot} – ${item.end_time}</div>
                  <div class="queue-meta-text" style="margin-top:0.25rem">Purpose: <strong>${escapeHtml(item.purpose)}</strong></div>
                </div>
              </div>
              <div style="text-align:right">
                ${statusBadge}
                <div style="margin-top:0.75rem;font-size:0.85rem;color:var(--text-muted)">
                  ${item.checkin_time ? `Checked In: <strong>${formatQueueTime(item.checkin_time)}</strong>` : '<em>Not checked in yet</em>'}
                </div>
              </div>
            </div>

            <div class="queue-wait-estimate">
              <div style="display:flex;align-items:center;gap:0.6rem">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <div>
                  <strong>${item.students_ahead} student(s) ahead</strong> · Estimated wait: <strong>~${item.estimated_wait_minutes} mins</strong>
                  <div style="color:var(--text-muted);font-size:0.78rem">${statusDesc}</div>
                </div>
              </div>
            </div>

            <div class="queue-actions-bar">
              <button class="btn btn-primary" id="btn-show-my-qr">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><rect x="7" y="14" width="3" height="3"/></svg>
                View Check-In QR Pass
              </button>
            </div>
          </div>
        ` : `
          <div class="card" style="margin-bottom:1.5rem;text-align:center;padding:2.5rem 1.5rem">
            <div style="width:64px;height:64px;margin:0 auto 1rem;background:var(--accent-light);border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--accent)">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <h2 style="margin-bottom:0.4rem">No Active Consultation Queue Today</h2>
            <p style="color:var(--text-muted);max-width:480px;margin:0 auto 1.5rem;font-size:0.9rem">
              You do not have any approved consultation scheduled for today. Book a consultation or check your upcoming appointments below.
            </p>
            <button class="btn btn-primary" id="btn-book-from-queue">Book Consultation</button>
          </div>
        `}

        <div class="card">
          <div class="card-header">
            <h2>Upcoming Approved Consultations</h2>
          </div>
          ${history.length === 0 ? '<div class="empty-state"><p>No upcoming approved consultations.</p></div>' : `
            <div class="table-wrapper">
              <table class="data-table">
                <thead><tr><th>Faculty</th><th>Date</th><th>Time</th><th>Purpose</th><th>Check-In Status</th><th>Action</th></tr></thead>
                <tbody>
                  ${history.map(h => `
                    <tr>
                      <td><strong>${escapeHtml(h.faculty_name)}</strong><br><small>${escapeHtml(h.faculty_dept || '')}</small></td>
                      <td>${h.date}</td>
                      <td>${h.time_slot} – ${h.end_time}</td>
                      <td>${escapeHtml(h.purpose)}</td>
                      <td>
                        ${h.checkin_time ? `<span class="badge checked-in">Checked In (#${h.queue_number})</span>` : `<span class="badge approved">Ready for Check-In</span>`}
                      </td>
                      <td>
                        <button class="btn btn-outline btn-sm show-pass-btn" data-id="${h.id}">QR Pass</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `;

      $('#refresh-queue-btn')?.addEventListener('click', () => {
        toast('Refreshing queue...', 'info');
        loadData();
      });
      $('#btn-book-from-queue')?.addEventListener('click', () => navigate('book'));
      $('#btn-show-my-qr')?.addEventListener('click', () => {
        if (item) showQRPassModal(item);
      });
      $$('.show-pass-btn').forEach(b => b.addEventListener('click', () => {
        const match = history.find(x => x.id === Number(b.dataset.id));
        if (match) showQRPassModal(match);
      }));
    }

    loadData();
    queueTimer = setInterval(loadData, 8000);
  }

  // ── Interactive Faculty Members Directory ───────────────────
  let directoryBookingSeed = null;
  async function renderFacultyDirectory(el) {
    return window.createFacultyDirectory({api,escapeHtml,renderAvatarImg,currentUser:()=>currentUser,onBook:seed=>{directoryBookingSeed=seed;navigate('book');}})(el);
  }

  // ── Notifications ──────────────────────────────────────────
  async function renderNotifications(el) {
    el.innerHTML = '<p style="color:var(--text-light)">Loading…</p>';
    const { notifications } = await api('/api/notifications');

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Notifications</h1><p>${notifications.length} notifications</p></div>
        <button class="btn btn-outline" id="mark-all-read">Mark All Read</button>
      </div>
      <div class="card" style="padding:0">
        ${notifications.length === 0
          ? '<div class="empty-state" style="padding:2rem"><p>No notifications</p></div>'
          : notifications.map(n => `
            <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
              <div class="notif-icon ${n.type}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
              </div>
              <div class="notif-content">
                <div class="notif-title">${escapeHtml(n.title)}</div>
                <div class="notif-msg">${escapeHtml(n.message)}</div>
                <div class="notif-time">${new Date(n.created_at).toLocaleString()}</div>
              </div>
            </div>`).join('')
        }
      </div>`;

    $$('.notif-item.unread').forEach(item => item.addEventListener('click', async () => {
      await api(`/api/notifications/${item.dataset.id}/read`, { method: 'PUT' });
      item.classList.remove('unread');
      loadNotifCount();
    }));

    $('#mark-all-read').addEventListener('click', async () => {
      await api('/api/notifications/read-all', { method: 'PUT' });
      $$('.notif-item.unread').forEach(i => i.classList.remove('unread'));
      loadNotifCount();
      toast('All notifications marked as read', 'success');
    });
  }

  // ── Profile ────────────────────────────────────────────────
  async function renderProfile(el) {
    return window.createProfileScreen({api,escapeHtml,openModal,closeModal,toast,onCleanup:fn=>{modalCleanup=fn;},onSaved:user=>{currentUser=user;buildSidebar();loadNotifCount();}})(el);
  }

  // ── Faculty Dashboard ──────────────────────────────────────
  async function renderFacultyDashboard(el) {
    el.innerHTML = '<p style="color:var(--text-light)">Loading…</p>';
    const stats = await api('/api/stats');
    const appts = await api('/api/appointments');
    if (!currentUser || currentPage!=='faculty-dashboard' || !el.isConnected) return;
    const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
    const todayAppts = appts.filter(a => a.date === today && (a.status === 'approved' || a.status === 'checked-in'));
    const pending = appts.filter(a => a.status === 'pending').slice(0,5);

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Faculty Dashboard</h1>
          <p>${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn btn-outline" id="fac-dash-goto-analytics">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
            Analytics
          </button>
          <button class="btn btn-primary" id="fac-dash-goto-queue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            Live Queue & Scanner
          </button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon blue"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div><div class="stat-value">${stats.today}</div><div class="stat-label">Today</div></div></div>
        <div class="stat-card"><div class="stat-icon yellow"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div><div class="stat-value">${stats.pending}</div><div class="stat-label">Pending</div></div></div>
        <div class="stat-card"><div class="stat-icon green"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><div><div class="stat-value">${stats.upcoming}</div><div class="stat-label">Upcoming</div></div></div>
        <div class="stat-card"><div class="stat-icon purple"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div><div class="stat-value">${stats.students}</div><div class="stat-label">Students</div></div></div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h2>Today's Consultations</h2><button class="btn btn-outline btn-sm" id="goto-fac-queue-link">View Queue</button></div>
          ${todayAppts.length === 0
            ? '<div class="empty-state"><p>No appointments today</p></div>'
            : todayAppts.map(a => `
                <div class="sched-row" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem">
                  <div class="user-avatar-cell">
                    ${renderAvatarImg(a.student_avatar, a.student_name, 'student', 'table-avatar')}
                    <div>
                      <strong>${escapeHtml(a.student_name)}</strong><br>
                      <small style="color:var(--text-muted)">${a.time_slot} – ${a.end_time} · ${escapeHtml(a.purpose)}</small>
                    </div>
                  </div>
                  <span class="badge ${a.status}">${a.status}</span>
                </div>
              `).join('')
          }
        </div>
        <div class="card">
          <div class="card-header"><h2>Pending Requests</h2><button class="btn btn-outline btn-sm" id="goto-requests">View All</button></div>
          ${pending.length === 0
            ? '<div class="empty-state"><p>No pending requests</p></div>'
            : pending.map(a => `
                <div class="sched-row" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem">
                  <div class="user-avatar-cell">
                    ${renderAvatarImg(a.student_avatar, a.student_name, 'student', 'table-avatar')}
                    <div>
                      <strong>${escapeHtml(a.student_name)}</strong><br>
                      <small style="color:var(--text-muted)">${a.date} · ${a.time_slot} · ${escapeHtml(a.purpose)}</small>
                    </div>
                  </div>
                  <span class="badge pending">pending</span>
                </div>
              `).join('')
          }
        </div>
      </div>`;

    consultationOverview.mount(el,appts,true,()=>renderFacultyDashboard(el));
    $('#goto-requests')?.addEventListener('click', () => navigate('fac-requests'));
    $('#fac-dash-goto-queue')?.addEventListener('click', () => navigate('fac-queue'));
    $('#goto-fac-queue-link')?.addEventListener('click', () => navigate('fac-queue'));
    $('#fac-dash-goto-analytics')?.addEventListener('click', () => navigate('analytics'));
  }

  // ── Faculty Appointment Requests ───────────────────────────
  async function renderFacRequests(el) { return workflowScreens.renderAppointments(el); }

  async function renderFacultyQueue(el) {
    el.innerHTML = '<p style="color:var(--text-light)">Loading live consultation queue…</p>';
    if (queueTimer) { clearInterval(queueTimer); queueTimer = null; }

    const cacheKey = 'dll_fac_queue_' + (currentUser ? currentUser.id : 'default');
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) renderUI(JSON.parse(cached));
    } catch(e) {}

    async function loadData() {
      try {
        const q = await api('/api/queue');
        try { localStorage.setItem(cacheKey, JSON.stringify(q)); } catch(e) {}
        renderUI(q);
      } catch (err) {
        if (!el.querySelector('.queue-spotlight-card') && !el.querySelector('.card')) {
          el.innerHTML = `<div class="empty-state"><p class="error">${escapeHtml(err.message)}</p></div>`;
        }
      }
    }

    function renderQueueRows(items, serving, next) {
      if (!items || items.length === 0) {
        return '<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--text-muted)">No matching students found in queue.</td></tr>';
      }
      return items.map(item => {
        const isServing = serving && serving.id === item.id;
        const isNext = !isServing && next && next.id === item.id;
        let displayBadge = '';
        if (isServing) {
          displayBadge = '<span class="badge serving">● Currently Serving</span>';
        } else if (isNext) {
          displayBadge = '<span class="badge next">● Next in Line</span>';
        } else if (item.queue_status === 'completed' || item.status === 'completed') {
          displayBadge = '<span class="badge completed">✓ Completed</span>';
        } else if (item.queue_status === 'skipped') {
          displayBadge = '<span class="badge skipped">Skipped</span>';
        } else {
          displayBadge = '<span class="badge waiting">Waiting</span>';
        }

        return `
          <tr class="${isServing ? 'row-serving' : ''}">
            <td><strong style="font-size:1.15rem;color:var(--primary)">#${item.queue_number || '—'}</strong></td>
            <td>
              <div class="user-avatar-cell">
                ${renderAvatarImg(item.student_avatar, item.student_name, 'student', 'table-avatar')}
                <div>
                  <strong>${escapeHtml(item.student_name)}</strong><br>
                  <small style="color:var(--text-muted)">${escapeHtml(item.student_course || '')} · ${escapeHtml(item.sid || '')}</small>
                </div>
              </div>
            </td>
            <td>${item.time_slot} – ${item.end_time}</td>
            <td style="max-width:180px">${escapeHtml(item.purpose)}</td>
            <td>${formatQueueTime(item.checkin_time)}</td>
            <td>${displayBadge}</td>
            <td class="action-cell">
              ${isServing ? `
                <button class="btn btn-success btn-sm btn-queue-action" data-id="${item.id}" data-action="complete">Complete Consultation</button>
                <button class="btn btn-outline btn-sm btn-queue-action" data-id="${item.id}" data-action="skip">Skip</button>
              ` : ''}
              ${(!isServing && item.queue_status !== 'completed' && item.status !== 'completed' && item.queue_status !== 'skipped') ? `
                <button class="btn btn-primary btn-sm btn-queue-action" data-id="${item.id}" data-action="start">Start Serving</button>
                <button class="btn btn-outline btn-sm btn-queue-action" data-id="${item.id}" data-action="skip">Skip</button>
              ` : ''}
              ${item.queue_status === 'skipped' ? `
                <button class="btn btn-outline btn-sm btn-queue-action" data-id="${item.id}" data-action="recall">Recall to Queue</button>
              ` : ''}
              ${(item.queue_status === 'completed' || item.status === 'completed') ? `
                <span style="color:var(--success);font-size:0.82rem;font-weight:600">✓ Completed</span>
              ` : ''}
            </td>
          </tr>
        `;
      }).join('');
    }

    function renderUI(q) {
      const serving = q.serving || q.currently_serving || null;
      const next = q.next || q.next_in_line || null;
      const queue = q.queue || [];
      const summary = q.summary || {
        serving: serving ? 1 : 0,
        waiting: queue.filter(x => x.queue_status === 'waiting' || x.queue_status === 'next').length,
        completed: queue.filter(x => x.queue_status === 'completed' || x.status === 'completed').length,
        total: queue.length
      };

      el.innerHTML = `
        <div class="page-header">
          <div>
            <h1>Virtual Consultation Queue</h1>
            <p>Live student queue management & QR attendance</p>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            <button class="btn btn-primary" id="btn-open-scanner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Scan QR / Check-In
            </button>
            <button class="btn btn-outline" id="refresh-fac-queue-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Refresh
            </button>
          </div>
        </div>

        <!-- Live Queue Summary Counters -->
        <div class="stats-grid" style="margin-bottom:1.5rem">
          <div class="stat-card">
            <div class="stat-icon green">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div>
              <div class="stat-val">${summary.serving}</div>
              <div class="stat-lbl">Currently Serving</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon blue">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div>
              <div class="stat-val">${summary.waiting}</div>
              <div class="stat-lbl">Waiting in Queue</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon purple">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div>
              <div class="stat-val">${summary.completed}</div>
              <div class="stat-lbl">Completed Today</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon orange">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div>
              <div class="stat-val">${summary.total}</div>
              <div class="stat-lbl">Total Checked In</div>
            </div>
          </div>
        </div>

        <!-- Spotlight Cards Grid -->
        <div class="queue-overview-grid">
          <!-- Currently Serving -->
          <div class="queue-spotlight-card serving">
            <div class="queue-tag serving">● Currently Being Served</div>
            ${serving ? `
              <div style="display:flex;align-items:center;gap:1rem;margin:0.5rem 0 0.8rem">
                ${renderAvatarImg(serving.student_avatar, serving.student_name, 'student', 'spotlight-avatar')}
                <div>
                  <div class="queue-large-num">Queue #${serving.queue_number}</div>
                  <div class="queue-user-name">${escapeHtml(serving.student_name)}</div>
                  <div class="queue-meta-text">${escapeHtml(serving.student_course || '')} · ${escapeHtml(serving.sid || '')}</div>
                </div>
              </div>
              <div class="queue-meta-text" style="margin-top:0.4rem">Consultation Slot: <strong>${serving.time_slot} – ${serving.end_time}</strong></div>
              <div class="queue-meta-text">Purpose: <strong>${escapeHtml(serving.purpose)}</strong></div>
              <div class="queue-meta-text">Checked In: <strong>${formatQueueTime(serving.checkin_time)}</strong></div>
              <div class="queue-actions-bar">
                <button class="btn btn-success btn-sm btn-queue-action" data-id="${serving.id}" data-action="complete">
                  ✓ Complete Consultation
                </button>
                <button class="btn btn-outline btn-sm btn-queue-action" data-id="${serving.id}" data-action="skip">
                  Skip Student
                </button>
              </div>
            ` : `
              <div style="padding:1.5rem 0;color:var(--text-muted);font-size:0.9rem">
                <em>No student currently being served.</em>
              </div>
              ${next ? `
                <button class="btn btn-primary btn-sm btn-queue-action" data-id="${next.id}" data-action="start">
                  ▶ Start Serving (Queue #${next.queue_number})
                </button>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.5rem">
                  Next student is ready. Click Start Serving to call them.
                </div>
              ` : `
                <div style="font-size:0.8rem;color:var(--text-muted)">
                  Queue is waiting for students to check in.
                </div>
              `}
            `}
          </div>

          <!-- Next in Line -->
          <div class="queue-spotlight-card next">
            <div class="queue-tag next">● Next in Line</div>
            ${next ? `
              <div style="display:flex;align-items:center;gap:1rem;margin:0.5rem 0 0.8rem">
                ${renderAvatarImg(next.student_avatar, next.student_name, 'student', 'spotlight-avatar')}
                <div>
                  <div class="queue-large-num">Queue #${next.queue_number}</div>
                  <div class="queue-user-name">${escapeHtml(next.student_name)}</div>
                  <div class="queue-meta-text">${escapeHtml(next.student_course || '')} · ${escapeHtml(next.sid || '')}</div>
                </div>
              </div>
              <div class="queue-meta-text" style="margin-top:0.4rem">Scheduled Slot: <strong>${next.time_slot} – ${next.end_time}</strong></div>
              <div class="queue-meta-text">Purpose: <strong>${escapeHtml(next.purpose)}</strong></div>
              <div class="queue-meta-text">Checked In: <strong>${formatQueueTime(next.checkin_time)}</strong></div>
              <div class="queue-actions-bar">
                <button class="btn btn-primary btn-sm btn-queue-action" data-id="${next.id}" data-action="start">
                  ▶ Start Serving
                </button>
                <button class="btn btn-outline btn-sm btn-queue-action" data-id="${next.id}" data-action="skip">
                  Skip
                </button>
              </div>
            ` : `
              <div style="padding:1.5rem 0;color:var(--text-muted);font-size:0.9rem">
                <em>No students waiting next in line.</em>
              </div>
              <div style="font-size:0.8rem;color:var(--text-muted)">
                Checked-in students will automatically appear here.
              </div>
            `}
          </div>
        </div>

        <!-- Full Queue Table for Today -->
        <div class="card">
          <div class="card-header">
            <h2>Today's Consultation Queue (${queue.length} student${queue.length === 1 ? '' : 's'})</h2>
            <div style="font-size:0.85rem;color:var(--text-muted)">
              Serving: <strong>${summary.serving}</strong> · Waiting: <strong>${summary.waiting}</strong> · Completed: <strong>${summary.completed}</strong>
            </div>
          </div>
          ${queue.length === 0 ? `
            <div class="empty-state" style="padding:2.5rem 1rem">
              <div style="width:60px;height:60px;margin:0 auto 1rem;background:var(--accent-light);border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--accent)">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </div>
              <h3 style="margin-bottom:0.4rem">No Checked-In Students in Queue Today</h3>
              <p style="color:var(--text-muted);max-width:480px;margin:0 auto 1.25rem;font-size:0.9rem">
                Students with approved consultation appointments can present their QR code at your desk. Click the button below to verify their attendance.
              </p>
              <button class="btn btn-primary" id="btn-empty-scan">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Scan QR / Verify Check-In
              </button>
            </div>
          ` : `
            <div style="margin-bottom:1rem">
              <div class="search-box-wrapper search-compact">
                <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" placeholder="Search queue by student name, ID, or purpose…" id="queue-search-input" class="search-input" autocomplete="off">
              </div>
            </div>
            <div class="table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Queue #</th>
                    <th>Student Details</th>
                    <th>Scheduled Slot</th>
                    <th>Purpose</th>
                    <th>Check-In Time</th>
                    <th>Queue Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="fac-queue-tbody">
                  ${renderQueueRows(queue, serving, next)}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `;

      $('#btn-open-scanner')?.addEventListener('click', () => showFacultyCheckInModal(() => loadData()));
      $('#btn-empty-scan')?.addEventListener('click', () => showFacultyCheckInModal(() => loadData()));
      $('#refresh-fac-queue-btn')?.addEventListener('click', () => {
        toast('Refreshing queue...', 'info');
        loadData();
      });

      function bindQueueActions() {
        $$('.btn-queue-action').forEach(btn => btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const action = btn.dataset.action;
          btn.disabled = true;
          try {
            await api(`/api/queue/${id}`, { method: 'PUT', body: { action } });
            const actionMsg = action === 'start' ? 'Started serving student' :
                              action === 'complete' ? 'Consultation completed' :
                              action === 'skip' ? 'Student skipped' :
                              action === 'recall' ? 'Student recalled to queue' : 'Queue updated';
            toast(actionMsg, 'success');
            await loadData();
            loadNotifCount();
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        }));
      }

      bindQueueActions();

      $('#queue-search-input')?.addEventListener('input', e => {
        const qVal = e.target.value.trim().toLowerCase();
        const filtered = queue.filter(item => 
          !qVal ||
          (item.student_name && item.student_name.toLowerCase().includes(qVal)) ||
          (item.sid && item.sid.toLowerCase().includes(qVal)) ||
          (item.student_course && item.student_course.toLowerCase().includes(qVal)) ||
          (item.purpose && item.purpose.toLowerCase().includes(qVal)) ||
          (String(item.queue_number).includes(qVal))
        );
        const tbody = $('#fac-queue-tbody');
        if (tbody) {
          tbody.innerHTML = renderQueueRows(filtered, serving, next);
          bindQueueActions();
        }
      });
    }

    loadData();
    queueTimer = setInterval(loadData, 8000);
  }

  // ── Consultation Analytics Dashboard ───────────────────────
  async function renderAnalytics(el) {
    el.innerHTML = '<p style="color:var(--text-light)">Loading consultation analytics…</p>';

    let startDate = '';
    let endDate = '';
    let statusFilter = '';
    let facultyFilter = currentUser.role === 'faculty' ? String(currentUser.id) : 'all';

    async function loadData() {
      try {
        const qParams = new URLSearchParams();
        if (startDate) qParams.set('startDate', startDate);
        if (endDate) qParams.set('endDate', endDate);
        if (statusFilter) qParams.set('status', statusFilter);
        if (facultyFilter) qParams.set('facultyId', facultyFilter);

        const data = await api(`/api/analytics?${qParams.toString()}`);
        renderUI(data);
      } catch (err) {
        console.error('Analytics load error:', err);
        el.innerHTML = `<div class="card" style="padding:2rem"><p class="error">${escapeHtml(err.message)}</p></div>`;
      }
    }

    function renderUI(data) {
      const kpis = data.kpis || data.summary || {};

      let statuses = data.status_distribution || [];
      if (!Array.isArray(statuses) && typeof statuses === 'object') {
        const tot = kpis.total || 1;
        statuses = Object.entries(statuses)
          .filter(([,count]) => count >= 0)
          .map(([st, count]) => ({
            status: st,
            count,
            percentage: tot > 0 ? Math.round((count / tot) * 100) : 0
          }));
      } else {
        statuses = statuses.filter(s => s && s.status);
      }

      let popularSlots = data.popular_slots || data.popular_time_slots || [];
      if (!Array.isArray(popularSlots) && typeof popularSlots === 'object') {
        popularSlots = Object.entries(popularSlots).map(([slot, count]) => ({ time_slot: slot, slot, count }));
      }
      popularSlots = popularSlots.map(s => ({
        time_slot: s.time_slot || s.slot,
        count: s.count
      }));

      let weeklyStats = data.weekly_stats || data.weekly_distribution || [];
      if (!Array.isArray(weeklyStats) && typeof weeklyStats === 'object') {
        weeklyStats = Object.entries(weeklyStats).map(([day_name, count]) => ({ day_name, count }));
      }

      let monthlyStats = data.monthly_stats || data.monthly_statistics || [];
      if (!Array.isArray(monthlyStats) && typeof monthlyStats === 'object') {
        monthlyStats = Object.entries(monthlyStats).map(([month, count]) => ({ month, label: month, count }));
      }
      monthlyStats = monthlyStats.map(m => ({
        month: m.month,
        label: m.label || m.month,
        count: m.count
      }));

      const facultyList = data.faculty_list || [];

      const maxSlotCount = popularSlots.length ? Math.max(...popularSlots.map(s => s.count || 0), 1) : 1;
      const maxWeeklyCount = weeklyStats.length ? Math.max(...weeklyStats.map(w => w.count || 0), 1) : 1;

      const exportUrl = `/api/analytics/export?${new URLSearchParams({
        startDate: startDate || '',
        endDate: endDate || '',
        status: statusFilter || '',
        facultyId: facultyFilter || ''
      }).toString()}`;

      el.innerHTML = `
        <div class="page-header">
          <div>
            <h1>Consultation Analytics Dashboard</h1>
            <p>Comprehensive consultation statistics, trends, and reports</p>
          </div>
          <div class="export-bar">
            <a href="${exportUrl}" class="btn btn-outline" download>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export Report (CSV)
            </a>
          </div>
        </div>

        <!-- Filters Bar -->
        <div class="analytics-filters-card">
          <div class="analytics-filters-form">
            <div class="analytics-filter-item">
              <label for="an-start-date">From Date</label>
              <input type="date" id="an-start-date" class="analytics-filter-control" value="${startDate}">
            </div>
            <div class="analytics-filter-item">
              <label for="an-end-date">To Date</label>
              <input type="date" id="an-end-date" class="analytics-filter-control" value="${endDate}">
            </div>
            <div class="analytics-filter-item">
              <label for="an-status">Status</label>
              <select id="an-status" class="analytics-filter-control">
                <option value="">All Statuses</option>
                <option value="completed" ${statusFilter==='completed'?'selected':''}>Completed</option>
                <option value="approved" ${statusFilter==='approved'?'selected':''}>Approved</option>
                <option value="checked-in" ${statusFilter==='checked-in'?'selected':''}>Checked In</option>
                <option value="pending" ${statusFilter==='pending'?'selected':''}>Pending</option>
                <option value="rejected" ${statusFilter==='rejected'?'selected':''}>Rejected</option>
                <option value="no-show" ${statusFilter==='no-show'?'selected':''}>Missed</option><option value="cancelled" ${statusFilter==='cancelled'?'selected':''}>Cancelled</option>
              </select>
            </div>
            ${facultyList.length > 0 ? `
              <div class="analytics-filter-item" style="flex:1.5 1 220px">
                <label for="an-faculty">Faculty Member</label>
                <select id="an-faculty" class="analytics-filter-control">
                  <option value="all" ${(!facultyFilter || facultyFilter==='all') ? 'selected' : ''}>${currentUser.role === 'admin' ? 'All Faculty' : currentUser.role === 'faculty' ? 'My Consultations' : 'All My Faculty'}</option>
                  ${facultyList.map(f => `<option value="${f.id}" ${facultyFilter==String(f.id)?'selected':''}>${escapeHtml(f.name)}</option>`).join('')}
                </select>
              </div>
            ` : ''}
            <div class="analytics-filter-actions">
              <button class="btn btn-primary" id="btn-apply-analytics">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px"><polyline points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                Filter
              </button>
              <button class="btn btn-outline" id="btn-reset-analytics">Reset</button>
            </div>
          </div>
          ${(startDate || endDate || statusFilter || (facultyFilter && facultyFilter !== 'all')) ? `
            <div class="analytics-filter-feedback">
              <span>● Active filters:</span>
              ${startDate ? `<span>From <strong>${startDate}</strong></span> · ` : ''}
              ${endDate ? `<span>To <strong>${endDate}</strong></span> · ` : ''}
              ${statusFilter ? `<span>Status: <strong>${statusFilter}</strong></span> · ` : ''}
              ${facultyFilter && facultyFilter !== 'all' ? `<span>Faculty: <strong>${escapeHtml(facultyList.find(f => String(f.id) === String(facultyFilter))?.name || facultyFilter)}</strong></span> · ` : ''}
              <span><strong>${kpis.total || 0}</strong> consultation(s) found</span>
            </div>
          ` : ''}
        </div>

        <!-- KPI Summary Cards -->
        <div class="stats-grid" style="margin-bottom:1.5rem">
          <div class="stat-card">
            <div class="stat-icon blue"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
            <div><div class="stat-value">${kpis.total || 0}</div><div class="stat-label">Total Consultations</div></div>
          </div>
          <div class="stat-card">
            <div class="stat-icon green"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
            <div><div class="stat-value">${kpis.completed || 0} <small style="font-size:0.75rem;font-weight:500;color:var(--success)">(${kpis.completion_rate || 0}%)</small></div><div class="stat-label">Completed</div></div>
          </div>
          <div class="stat-card">
            <div class="stat-icon yellow"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
            <div><div class="stat-value">${kpis.pending || 0}</div><div class="stat-label">Pending Requests</div></div>
          </div>
          <div class="stat-card">
            <div class="stat-icon purple"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
            <div><div class="stat-value">${(kpis.approved || 0) + (kpis.checked_in || 0)}</div><div class="stat-label">Approved & In-Queue</div></div>
          </div>
          <div class="stat-card">
            <div class="stat-icon red"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
            <div><div class="stat-value">${kpis.rejected || 0}</div><div class="stat-label">Rejected</div></div>
          </div>
          <div class="stat-card">
            <div class="stat-icon yellow"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
            <div><div class="stat-value">${kpis.no_show || 0}</div><div class="stat-label">No-Show Consultations</div></div>
          </div>
        </div>

        <!-- Charts Section -->
        <div class="grid-2">
          <!-- Status Distribution Chart -->
          <div class="analytics-chart-card">
            <div class="analytics-chart-header">
              <h3>Appointment Status Distribution</h3>
              <span style="font-size:0.8rem;color:var(--text-muted)">Breakdown</span>
            </div>
            ${statuses.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem">No status data.</p>' : `
              <div>
                ${statuses.map(st => {
                  const colorClass = st.status === 'completed' ? 'success' : (st.status === 'pending' || st.status === 'no-show') ? 'warning' : (st.status === 'rejected') ? 'danger' : '';
                  return `
                    <div class="bar-chart-row">
                      <div class="bar-label">${st.status.toUpperCase()}</div>
                      <div class="bar-track">
                        <div class="bar-fill ${colorClass}" style="width:${Math.max(st.percentage, 2)}%"></div>
                      </div>
                      <div class="bar-value">${st.count} <small style="color:var(--text-muted);font-size:0.75rem">(${st.percentage}%)</small></div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- Most Popular Time Slots -->
          <div class="analytics-chart-card">
            <div class="analytics-chart-header">
              <h3>Most Popular Consultation Time Slots</h3>
              <span style="font-size:0.8rem;color:var(--text-muted)">Peak Hours</span>
            </div>
            ${popularSlots.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem">No slot data.</p>' : `
              <div>
                ${popularSlots.map(ps => {
                  const pct = Math.round((ps.count / maxSlotCount) * 100);
                  return `
                    <div class="bar-chart-row">
                      <div class="bar-label"><strong>${ps.time_slot}</strong></div>
                      <div class="bar-track">
                        <div class="bar-fill" style="width:${Math.max(pct, 4)}%"></div>
                      </div>
                      <div class="bar-value">${ps.count} appts</div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- Weekly Distribution -->
          <div class="analytics-chart-card">
            <div class="analytics-chart-header">
              <h3>Weekly Consultation Statistics</h3>
              <span style="font-size:0.8rem;color:var(--text-muted)">Monday – Friday</span>
            </div>
            ${weeklyStats.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem">No weekly data.</p>' : `
              <div>
                ${weeklyStats.map(ws => {
                  const pct = Math.round((ws.count / maxWeeklyCount) * 100);
                  return `
                    <div class="bar-chart-row">
                      <div class="bar-label">${ws.day_name}</div>
                      <div class="bar-track">
                        <div class="bar-fill success" style="width:${Math.max(pct, 4)}%"></div>
                      </div>
                      <div class="bar-value">${ws.count}</div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- Monthly Consultation Statistics -->
          <div class="analytics-chart-card">
            <div class="analytics-chart-header">
              <h3>Monthly Consultation Trends</h3>
              <span style="font-size:0.8rem;color:var(--text-muted)">Monthly Overview</span>
            </div>
            ${monthlyStats.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem">No monthly data.</p>' : `
              <div class="donut-summary-grid">
                ${monthlyStats.map(ms => `
                  <div class="donut-stat-item">
                    <div class="donut-stat-val">${ms.count}</div>
                    <div class="donut-stat-lbl">${ms.label}</div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      `;

      $('#btn-apply-analytics')?.addEventListener('click', () => {
        startDate = $('#an-start-date').value;
        endDate = $('#an-end-date').value;
        statusFilter = $('#an-status').value;
        facultyFilter = $('#an-faculty')?.value || 'all';
        loadData();
      });

      $('#btn-reset-analytics')?.addEventListener('click', () => {
        startDate = '';
        endDate = '';
        statusFilter = '';
        facultyFilter = 'all';
        loadData();
      });

      $('#an-status')?.addEventListener('change', () => {
        statusFilter = $('#an-status').value;
        startDate = $('#an-start-date')?.value || '';
        endDate = $('#an-end-date')?.value || '';
        facultyFilter = $('#an-faculty')?.value || 'all';
        loadData();
      });

      $('#an-faculty')?.addEventListener('change', () => {
        facultyFilter = $('#an-faculty').value;
        startDate = $('#an-start-date')?.value || '';
        endDate = $('#an-end-date')?.value || '';
        statusFilter = $('#an-status')?.value || '';
        loadData();
      });

      $('#an-start-date')?.addEventListener('change', () => {
        startDate = $('#an-start-date').value;
        endDate = $('#an-end-date')?.value || '';
        statusFilter = $('#an-status')?.value || '';
        facultyFilter = $('#an-faculty')?.value || 'all';
        loadData();
      });

      $('#an-end-date')?.addEventListener('change', () => {
        endDate = $('#an-end-date').value;
        startDate = $('#an-start-date')?.value || '';
        statusFilter = $('#an-status')?.value || '';
        facultyFilter = $('#an-faculty')?.value || 'all';
        loadData();
      });
    }

    loadData();
  }

  // ── Faculty Schedule ───────────────────────────────────────
  async function renderFacSchedule(el) { return workflowScreens.renderCalendar(el); }

  async function renderFacAvailability(el) { return workflowScreens.renderAvailability(el); }

  async function renderFacStudents(el) {
    let allStudents = [];
    let searchTerm = '';
    let statusFilter = 'all';

    async function loadData() {
      el.innerHTML = '<p style="color:var(--text-light)">Loading student records…</p>';
      try {
        allStudents = await api('/api/students');
        renderUI();
      } catch (err) {
        el.innerHTML = `
          <div class="empty-state" style="padding:2.5rem 1rem">
            <div style="color:var(--danger);margin-bottom:0.75rem">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h3 style="margin-bottom:0.4rem">Failed to Load Students</h3>
            <p style="color:var(--text-muted);margin-bottom:1.25rem;max-width:440px;margin-left:auto;margin-right:auto">${escapeHtml(err.message)}</p>
            <button class="btn btn-primary" id="btn-retry-students">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Retry
            </button>
          </div>
        `;
        $('#btn-retry-students')?.addEventListener('click', loadData);
      }
    }

    function showStudentHistoryModal(s) {
      let modalFilter = 'all';

      function renderModalContent() {
        const appts = s.appointments || [];
        const filteredAppts = appts.filter(a => {
          if (modalFilter === 'all') return true;
          if (modalFilter === 'upcoming') return a.status === 'approved' || a.status === 'checked-in';
          if (modalFilter === 'completed') return a.status === 'completed';
          if (modalFilter === 'pending') return a.status === 'pending';
          if (modalFilter === 'cancelled') return a.status === 'cancelled' || a.status === 'rejected';
          return true;
        });

        const upcomingCount = appts.filter(a => a.status === 'approved' || a.status === 'checked-in').length;
        const completedCount = appts.filter(a => a.status === 'completed').length;
        const pendingCount = appts.filter(a => a.status === 'pending').length;
        const cancelledCount = appts.filter(a => a.status === 'cancelled' || a.status === 'rejected').length;

        $('#modal-body').innerHTML = `
          <!-- Student Profile Summary -->
          <div style="display:flex;align-items:center;gap:1rem;padding:1rem;background:var(--surface, #f8fafc);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:1.25rem">
            ${renderAvatarImg(s.avatar, s.name, 'student', 'spotlight-avatar')}
            <div style="flex:1;min-width:0">
              <div style="font-size:1.15rem;font-weight:700;color:var(--text);margin-bottom:0.15rem">${escapeHtml(s.name)}</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">
                <strong>${escapeHtml(s.sid || 'No ID')}</strong> · ${escapeHtml(s.course || 'Unassigned Course')} · ${escapeHtml(s.department || '')}
              </div>
              <div style="font-size:0.82rem;color:var(--accent);margin-top:0.1rem">${escapeHtml(s.email)}</div>
            </div>
          </div>

          <!-- Quick Stats Pills -->
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;font-size:0.8rem">
            <span class="badge" style="background:#f1f5f9;color:#334155;padding:0.35rem 0.65rem">Total Consultations: <strong>${appts.length}</strong></span>
            <span class="badge approved" style="padding:0.35rem 0.65rem">Upcoming: <strong>${upcomingCount}</strong></span>
            <span class="badge completed" style="padding:0.35rem 0.65rem">Completed: <strong>${completedCount}</strong></span>
            <span class="badge pending" style="padding:0.35rem 0.65rem">Pending: <strong>${pendingCount}</strong></span>
            ${cancelledCount > 0 ? `<span class="badge cancelled" style="padding:0.35rem 0.65rem">Cancelled: <strong>${cancelledCount}</strong></span>` : ''}
          </div>

          <!-- History Filter Tabs -->
          <div class="tabs" id="modal-history-tabs" style="margin-bottom:1rem">
            <button class="tab-btn ${modalFilter === 'all' ? 'active' : ''}" data-f="all">All (${appts.length})</button>
            <button class="tab-btn ${modalFilter === 'upcoming' ? 'active' : ''}" data-f="upcoming">Upcoming (${upcomingCount})</button>
            <button class="tab-btn ${modalFilter === 'completed' ? 'active' : ''}" data-f="completed">Completed (${completedCount})</button>
            <button class="tab-btn ${modalFilter === 'pending' ? 'active' : ''}" data-f="pending">Pending (${pendingCount})</button>
            <button class="tab-btn ${modalFilter === 'cancelled' ? 'active' : ''}" data-f="cancelled">Cancelled (${cancelledCount})</button>
          </div>

          <!-- Consultations List -->
          ${filteredAppts.length === 0 ? `
            <div class="empty-state" style="padding:2rem 1rem">
              <p style="color:var(--text-muted)">No consultations found matching this filter.</p>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:0.75rem;max-height:360px;overflow-y:auto;padding-right:0.25rem">
              ${filteredAppts.map(a => `
                <div style="border:1px solid var(--border);border-radius:var(--radius);padding:0.85rem;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.35rem">
                    <div>
                      <strong style="color:var(--primary);font-size:0.95rem">${a.date}</strong>
                      <span style="color:var(--text-muted);font-size:0.85rem"> · ${a.time_slot} – ${a.end_time}</span>
                    </div>
                    <span class="badge ${a.status}">${a.status}</span>
                  </div>
                  <div style="font-size:0.88rem;color:var(--text);margin-bottom:0.25rem">
                    <strong>Purpose:</strong> ${escapeHtml(a.purpose)}
                  </div>
                  ${a.remarks ? `<div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.25rem"><em>Student Note:</em> ${escapeHtml(a.remarks)}</div>` : ''}
                  ${a.faculty_remarks ? `<div style="font-size:0.82rem;color:var(--primary);margin-bottom:0.25rem"><em>Faculty Remarks:</em> ${escapeHtml(a.faculty_remarks)}</div>` : ''}
                  ${a.checkin_time ? `
                    <div style="font-size:0.78rem;color:var(--success);display:flex;align-items:center;gap:0.4rem;margin-top:0.35rem;padding-top:0.35rem;border-top:1px dashed var(--border)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                      Checked in at ${formatQueueTime(a.checkin_time)} ${a.queue_number ? `(Queue #${a.queue_number})` : ''} · Code: <code style="font-family:monospace">${a.checkin_code}</code>
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          `}
        `;

        $$('#modal-history-tabs .tab-btn').forEach(btn => btn.addEventListener('click', () => {
          modalFilter = btn.dataset.f;
          renderModalContent();
        }));
      }

      openModal(`Consultation History – ${escapeHtml(s.name)}`, '', `<button class="btn btn-primary" onclick="document.querySelector('#modal-overlay').classList.add('hidden')">Close</button>`);
      renderModalContent();
    }

    function renderUI() {
      // Overall stats
      const totalConsultations = allStudents.reduce((sum, s) => sum + (s.total_consultations || 0), 0);
      const totalUpcoming = allStudents.reduce((sum, s) => sum + (s.upcoming_count || 0), 0);
      const totalCompleted = allStudents.reduce((sum, s) => sum + (s.completed_count || 0), 0);
      const totalPending = allStudents.reduce((sum, s) => sum + (s.pending_count || 0), 0);

      el.innerHTML = `
        <div class="page-header">
          <div>
            <h1>My Students</h1>
            <p>Students who have booked academic consultations with you (${allStudents.length} total students)</p>
          </div>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-outline" id="refresh-students-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Refresh
            </button>
          </div>
        </div>

        <!-- Summary Stat Cards -->
        <div class="stats-grid" style="margin-bottom:1.5rem">
          <div class="stat-card">
            <div class="stat-icon blue">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div>
              <div class="stat-val">${allStudents.length}</div>
              <div class="stat-lbl">Consulted Students</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon green">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div>
              <div class="stat-val">${totalUpcoming}</div>
              <div class="stat-lbl">Upcoming Consultations</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon purple">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div>
              <div class="stat-val">${totalCompleted}</div>
              <div class="stat-lbl">Completed Sessions</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon orange">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div>
              <div class="stat-val">${totalPending}</div>
              <div class="stat-lbl">Pending Requests</div>
            </div>
          </div>
        </div>

        <!-- Search and Filter Controls -->
        <div class="card" style="margin-bottom:1.5rem;padding:1.1rem 1.25rem">
          <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;justify-content:space-between">
            <div class="search-box-wrapper search-medium">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="students-search-input" class="search-input" placeholder="Search by name, Student ID (e.g. 023A-11286), or course…" autocomplete="off">
            </div>

            <div class="tabs" id="students-status-tabs" style="margin:0">
              <button class="tab-btn active" data-s="all">All (${allStudents.length})</button>
              <button class="tab-btn" data-s="upcoming">Upcoming</button>
              <button class="tab-btn" data-s="completed">Completed</button>
              <button class="tab-btn" data-s="pending">Pending</button>
            </div>
          </div>
        </div>

        <!-- Students Table Container -->
        <div class="card" id="students-table-container"></div>
      `;

      function updateStudentsTable() {
        const q = ($('#students-search-input')?.value || '').toLowerCase().trim();

        const filtered = allStudents.filter(s => {
          const matchesSearch = !q ||
            s.name.toLowerCase().includes(q) ||
            (s.sid && s.sid.toLowerCase().includes(q)) ||
            (s.course && s.course.toLowerCase().includes(q)) ||
            (s.email && s.email.toLowerCase().includes(q));

          if (!matchesSearch) return false;

          if (statusFilter === 'all') return true;
          if (statusFilter === 'upcoming') return s.upcoming_count > 0;
          if (statusFilter === 'completed') return s.completed_count > 0;
          if (statusFilter === 'pending') return s.pending_count > 0;
          if (statusFilter === 'cancelled') return s.cancelled_count > 0;
          return true;
        });

        const container = $('#students-table-container');
        if (!container) return;

        container.innerHTML = `
          <div class="card-header">
            <h2>Student Roster (${filtered.length})</h2>
            <div style="font-size:0.85rem;color:var(--text-muted)">
              Showing verified students associated with your consultation schedule
            </div>
          </div>

          ${filtered.length === 0 ? `
            <div class="empty-state" style="padding:3rem 1.5rem">
              <div style="width:60px;height:60px;margin:0 auto 1rem;background:var(--accent-light);border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--accent)">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <h3 style="margin-bottom:0.4rem">${allStudents.length === 0 ? 'No Student Consultations Yet' : 'No Students Found'}</h3>
              <p style="color:var(--text-muted);max-width:460px;margin:0 auto 1.25rem;font-size:0.9rem">
                ${allStudents.length === 0
                  ? 'When students book a consultation hour with you, their academic profile and consultation history will automatically be tracked here.'
                  : `No students match your current filter or search "${escapeHtml(q)}". Try adjusting your search query.`
                }
              </p>
              ${allStudents.length > 0 ? `<button class="btn btn-outline btn-sm" id="btn-clear-student-search">Clear Search & Filters</button>` : ''}
            </div>
          ` : `
            <div class="table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Student ID</th>
                    <th>Course & Year</th>
                    <th>Total Sessions</th>
                    <th>Latest Consultation</th>
                    <th>Latest Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.map(s => `
                    <tr class="student-row" data-id="${s.id}" style="cursor:pointer">
                      <td>
                        <div class="user-avatar-cell">
                          ${renderAvatarImg(s.avatar, s.name, 'student', 'table-avatar')}
                          <div>
                            <strong style="color:var(--text);font-size:0.95rem">${escapeHtml(s.name)}</strong>
                            <div style="color:var(--text-muted);font-size:0.78rem">${escapeHtml(s.email)}</div>
                          </div>
                        </div>
                      </td>
                      <td><code style="font-family:monospace;font-weight:600;color:var(--primary);background:rgba(0,0,0,0.04);padding:2px 6px;border-radius:4px">${escapeHtml(s.sid || '—')}</code></td>
                      <td>
                        <strong>${escapeHtml(s.course || '—')}</strong>
                        <div style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(s.department || '')}</div>
                      </td>
                      <td>
                        <span class="badge" style="background:#e0e7ff;color:#3730a3;font-weight:700;font-size:0.85rem">
                          ${s.total_consultations} session${s.total_consultations === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td>
                        ${s.last_consultation_date ? `
                          <strong style="font-size:0.9rem">${s.last_consultation_date}</strong>
                          <div style="font-size:0.78rem;color:var(--text-muted);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                            ${escapeHtml(s.last_purpose || 'Consultation')}
                          </div>
                        ` : '<span style="color:var(--text-muted)">—</span>'}
                      </td>
                      <td>
                        <span class="badge ${s.last_status || 'none'}">${s.last_status || 'none'}</span>
                      </td>
                      <td>
                        <button class="btn btn-outline btn-sm btn-view-history" data-id="${s.id}">
                          Consultation History
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        `;

        // Attach listeners
        $('#btn-clear-student-search')?.addEventListener('click', () => {
          const inp = $('#students-search-input');
          if (inp) inp.value = '';
          statusFilter = 'all';
          $$('#students-status-tabs .tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.s === 'all'));
          updateStudentsTable();
        });

        $$('.btn-view-history').forEach(btn => btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = Number(btn.dataset.id);
          const match = allStudents.find(s => s.id === id);
          if (match) showStudentHistoryModal(match);
        }));

        $$('.student-row').forEach(row => row.addEventListener('click', () => {
          const id = Number(row.dataset.id);
          const match = allStudents.find(s => s.id === id);
          if (match) showStudentHistoryModal(match);
        }));
      }

      // Event handlers attached once
      $('#students-search-input')?.addEventListener('input', updateStudentsTable);

      $$('#students-status-tabs .tab-btn').forEach(btn => btn.addEventListener('click', () => {
        statusFilter = btn.dataset.s;
        $$('#students-status-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        updateStudentsTable();
      }));

      $('#refresh-students-btn')?.addEventListener('click', () => {
        toast('Refreshing student records…', 'info');
        loadData();
      });

      updateStudentsTable();
    }

    loadData();
  }

})();
