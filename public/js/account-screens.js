/* Account screens share the portal's design tokens and application helpers. */
window.createAccountScreens = function ({api,escapeHtml:e,openModal,closeModal,toast,navigate,currentUser,onRegistered}) {
  const $ = s=>document.querySelector(s);
  const icon = (path,size=22)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  const icons={users:'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 3a4 4 0 100 8 4 4 0 000-8M22 21v-2a4 4 0 00-3-3.87',faculty:'M4 4h16v12H4zM8 20h8m-4-4v4M8 8h8m-8 4h4',building:'M3 21h18M5 21V7l7-4 7 4v14M9 10h1m4 0h1m-6 4h1m4 0h1',calendar:'M8 3v4m8-4v4M3 10h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2',search:'M21 21l-5-5M10 3a7 7 0 100 14 7 7 0 000-14',plus:'M12 5v14m-7-7h14',arrow:'M5 12h14m-5-5l5 5-5 5',check:'M5 12l4 4L19 6'};
  const heading=(eyebrow,title,subtitle,action='')=>`<div class="account-page-header"><div><span class="account-eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
  const empty=(title,message)=>`<div class="account-empty">${icon(icons.users,36)}<h3>${title}</h3><p>${message}</p></div>`;
  const error=(el,err)=>{el.innerHTML=`<div class="card account-empty"><h3>Unable to load this page</h3><p role="alert">${e(err.message)}</p><button class="btn btn-outline" id="account-retry">Try again</button></div>`;};
  const departmentOptions=(list,selected='')=>`<option value="">No department selected</option>${list.map(d=>`<option value="${e(d.name)}" ${d.name===selected?'selected':''}>${e(d.name)}</option>`).join('')}${selected&&!list.some(d=>d.name===selected)?`<option selected value="${e(selected)}">${e(selected)}</option>`:''}`;
  const footer=(label='Save changes')=>`<button type="button" class="btn btn-outline" id="account-cancel">Cancel</button><button type="submit" form="account-dialog-form" class="btn btn-primary" id="account-save">${label}</button>`;
  const wireForm=(handler)=>{
    $('#account-cancel').onclick=closeModal;
    $('#account-dialog-form').onsubmit=async event=>{
      event.preventDefault(); const button=$('#account-save');button.disabled=true;$('#account-dialog-error').classList.add('hidden');
      try {await handler(new FormData(event.currentTarget));closeModal();}
      catch(err){$('#account-dialog-error').textContent=err.message;$('#account-dialog-error').classList.remove('hidden');}
      finally {button.disabled=false;}
    };
  };
  const dialogError='<p class="login-error hidden" id="account-dialog-error" role="alert"></p>';

  function showSignIn() {
    $('#register-form').classList.add('hidden');$('#login-form').classList.remove('hidden');$('#role-tabs').classList.remove('hidden');
    $('.form-panel-header h3').textContent='Welcome Back';$('.form-panel-header p').textContent='Sign in to your consultation portal';
    $('#signup-invite').classList.toggle('hidden',!$('.role-tab[data-role="student"]').classList.contains('active'));
    $('.login-card').classList.remove('registration-mode');
  }
  $('#show-signin').onclick=showSignIn;
  $('#show-register').onclick=async()=>{
    $('#register-form').classList.remove('hidden');$('#login-form').classList.add('hidden');$('#role-tabs').classList.add('hidden');$('#signup-invite').classList.add('hidden');
    $('.form-panel-header h3').textContent='Create your account';$('.form-panel-header p').textContent='Use your student number to get started.';
    $('.login-card').classList.add('registration-mode');$('#register-error').classList.add('hidden');$('#reg-number').focus();
    try {const list=await api('/api/departments');$('#reg-department').innerHTML=departmentOptions(list);}catch { /* department is optional */ }
  };
  $('#register-form').onsubmit=async event=>{
    event.preventDefault();const err=$('#register-error');err.classList.add('hidden');
    if ($('#reg-password').value!==$('#reg-confirm').value){err.textContent='Your passwords do not match.';err.classList.remove('hidden');return;}
    const button=$('#register-btn');button.disabled=true;button.textContent='Creating your account…';
    try {const body=Object.fromEntries(new FormData(event.currentTarget));const result=await api('/api/register',{method:'POST',body});onRegistered(result);}
    catch(error){err.textContent=error.message;err.classList.remove('hidden');}
    finally {button.disabled=false;button.textContent='Create Student Account →';}
  };

  async function renderOverview(el) {
    el.innerHTML='<div class="account-loading">Loading your administration overview…</div>';
    try {
      const data=await api('/api/admin/overview');
      const count=role=>data.counts.filter(x=>x.role===role).reduce((a,x)=>a+x.count,0);
      const active=data.counts.filter(x=>x.is_active).reduce((a,x)=>a+x.count,0);
      const total=data.appointments.reduce((a,x)=>a+x.count,0);
      const pending=data.appointments.find(x=>x.status==='pending')?.count||0;
      const stats=[['Registered students',count('student'),'Self-service registration',icons.users],['Faculty members',count('faculty'),'Accounts managed by you',icons.faculty],['Consultations',total,`${pending} awaiting faculty response`,icons.calendar],['Active accounts',active,'IT department portal',icons.check]];
      const labels={'student.registered':'Created a student account','account.created':'Created an account','account.updated':'Updated an account','account.password_reset':'Reset an account password','admin.initialized':'Set up the administrator account','department.created':'Added a department','department.renamed':'Renamed a department','department.removed':'Removed a department'};
      el.innerHTML=heading('ADMINISTRATION','A clear view of your IT department.','Manage IT faculty and students, and keep consultations moving.',`<button class="btn btn-primary" id="overview-accounts">${icon(icons.plus,18)} Create Faculty Account</button></div>`)+`
        <div class="account-stat-grid">${stats.map(([label,value,note,path])=>`<div class="account-stat card"><div class="account-stat-top"><span>${label}</span><span class="account-icon">${icon(path)}</span></div><strong>${value}</strong><p>${note}</p></div>`).join('')}</div>
        <div class="admin-overview-grid"><section class="card account-section"><div class="account-section-title"><div><h2>Make it happen</h2><p>Your everyday administration tools.</p></div></div><div class="admin-quick-links">${[['User Accounts','Create faculty accounts and manage student access.','admin-accounts',icons.users],['Appointment Records','Search every consultation and its history.','admin-records',icons.calendar],['IT Department Reports','Explore consultations across all faculty.','analytics',icons.calendar]].map(([title,desc,page,path])=>`<button class="admin-quick-link" data-admin-page="${page}"><span class="account-icon">${icon(path)}</span><span><strong>${title}</strong><small>${desc}</small></span>${icon(icons.arrow,18)}</button>`).join('')}</div><div class="admin-registration-note">${icon(icons.check,18)}<div><strong>Student signup is open</strong><p>Students create their own accounts using a student number. No approval queue to manage.</p></div></div></section>
        <section class="card account-section"><div class="account-section-title"><div><h2>Recent activity</h2><p>Account activity and access changes.</p></div><span class="account-pill">Audit trail</span></div><div class="account-activity">${data.recent.length?data.recent.map(a=>`<div class="activity-row"><span class="activity-dot"></span><div><strong>${e(labels[a.action]||'Account activity')}</strong><p>${e(a.actor_name||'System')}${a.target_id?' · Record #'+a.target_id:''}</p><time>${e(new Date(a.created_at.replace(' ','T')+'+08:00').toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}))}</time></div></div>`).join(''):'<p class="account-muted">Activity will appear here as the portal is used.</p>'}</div></section></div>`;
      const tools=document.createElement('section');tools.className='card admin-backup-tools';tools.innerHTML='<div><h3>Database backups</h3><p id="backup-latest">Checking the latest verified backup?</p><p>Restoring is performed offline with explicit confirmation. See the deployment guide.</p></div><button class="btn btn-outline" id="backup-create">Create backup</button><a class="btn btn-outline hidden" id="backup-download">Download latest</a>';el.append(tools);
      const displayBackup=backup=>{tools.querySelector('#backup-latest').textContent=backup?'Latest verified backup: '+new Date(backup.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'No portal-created backup yet.';const link=tools.querySelector('#backup-download');link.classList.toggle('hidden',!backup);if(backup)link.href='/api/admin/backups/'+encodeURIComponent(backup.file)+'/download';};
      api('/api/admin/backups').then(result=>{if(tools.isConnected)displayBackup(result.latest);}).catch(()=>{if(tools.isConnected)tools.querySelector('#backup-latest').textContent='Unable to check backup status.';});
      tools.querySelector('#backup-create').onclick=async()=>{const button=tools.querySelector('#backup-create');button.disabled=true;try{displayBackup(await api('/api/admin/backups',{method:'POST'}));toast('Verified database backup created.','success');}catch(err){toast(err.message,'error');}finally{button.disabled=false;}};
      $('#overview-accounts').onclick=()=>navigate('admin-accounts');el.querySelectorAll('[data-admin-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.adminPage));
    }catch(err){error(el,err);$('#account-retry').onclick=()=>renderOverview(el);}
  }

  async function renderAccounts(el) {
    el.innerHTML='<div class="account-loading">Loading user accounts…</div>';
    try {
      const [users,departments]=await Promise.all([api('/api/admin/users'),api('/api/departments')]);
      el.innerHTML=heading('PEOPLE & ACCESS','User accounts','A home for every student and faculty member.',`<div class="wf-header-actions"><button id="admin-create-student" class="btn btn-outline">Create Student Account</button><button id="admin-create-faculty" class="btn btn-primary">${icon(icons.plus,18)} Create Faculty Account</button></div>`)+`
      <div class="card account-directory"><div class="account-toolbar"><label class="account-search">${icon(icons.search,18)}<input id="account-search" aria-label="Search accounts" placeholder="Search name, ID, or department…"></label><select id="account-role" aria-label="Filter by role"><option value="">All roles</option><option value="student">Students</option><option value="faculty">Faculty</option><option value="admin">Administrators</option></select><select id="account-status" aria-label="Filter by status"><option value="">All statuses</option><option value="1">Active</option><option value="0">Deactivated</option></select></div><div class="account-table-meta"><span id="account-result-count"></span><span>Student registration is self-service</span></div><div id="account-table"></div></div>`;
      const refresh=()=>renderAccounts(el);
      const createAccount=role=>{
        const student=role==='student';
        openModal(student?'Create student account':'Create faculty account',`<form id="account-dialog-form" class="account-form"><p class="account-form-intro">${student?'Create an account when a student needs assistance. Self-registration remains available without approval.':'Give a faculty member access to schedules and consultation requests.'}</p><div class="account-form-grid"><div class="field"><label for="create-name">Full name</label><input id="create-name" name="name" maxlength="200" required placeholder="${student?'Juan Dela Cruz':'Prof. Juan Dela Cruz'}"></div><div class="field"><label for="create-id">${student?'Student number':'Faculty ID'}</label><input id="create-id" name="${student?'student_id':'faculty_id'}" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9\\-]{2,29}" required placeholder="${student?'2026-00123':'FAC-014'}"></div><div class="field"><label for="create-dept">Department</label><select id="create-dept" name="department">${departmentOptions(departments)}</select></div><div class="field"><label for="create-specialization">${student?'Course / section':'Specialization'}</label><input id="create-specialization" name="${student?'course':'specialization'}" maxlength="100" ${student?'required':''} placeholder="${student?'e.g. BSIT-1A':'e.g. Software Engineering'}"></div></div><div class="field"><label for="create-password">Initial password</label><input id="create-password" type="password" name="password" minlength="8" maxlength="72" autocomplete="new-password" required><small class="account-muted">At least 8 characters. Share the initial credentials privately.</small></div>${dialogError}</form>`,footer('Create account'));
        wireForm(async form=>{await api('/api/admin/users',{method:'POST',body:{...Object.fromEntries(form),role}});toast((student?'Student':'Faculty')+' account created.','success');await refresh();});
      };
      $('#admin-create-faculty').onclick=()=>createAccount('faculty');
      $('#admin-create-student').onclick=()=>createAccount('student');
      function edit(user) {
        openModal('Edit account',`<form id="account-dialog-form" class="account-form"><div class="account-person-note"><span class="account-avatar">${e(user.name.charAt(0))}</span><div><strong>${e(user.name)}</strong><p>${e(user.student_id||user.faculty_id||'Administrator')} · ${e(user.role)}</p></div></div><div class="field"><label for="edit-name">Full name</label><input id="edit-name" name="name" maxlength="200" value="${e(user.name)}" required></div><div class="field"><label for="edit-dept">Department</label><select id="edit-dept" name="department">${departmentOptions(departments,user.department)}</select></div><div class="field"><label for="edit-detail">${user.role==='student'?'Course / section':'Specialization'}</label><input id="edit-detail" name="${user.role==='student'?'course':'specialization'}" maxlength="200" value="${e((user.role==='student'?user.course:user.specialization)||'')}"></div>${dialogError}</form>`,footer());
        wireForm(async form=>{await api('/api/admin/users/'+user.id,{method:'PUT',body:Object.fromEntries(form)});toast('Account updated.','success');await refresh();});
      }
      function toggle(user) {
        const verb=user.is_active?'Deactivate':'Reactivate';
        openModal(verb+' account',`<form id="account-dialog-form" class="account-form"><p>${verb} <strong>${e(user.name)}</strong>?</p><p class="account-form-intro">${user.is_active?'They will be signed out and unable to sign in. Their consultation records will be preserved.':'They will be able to sign in again using their existing password.'}</p>${dialogError}</form>`,footer(verb+' account'));
        wireForm(async()=>{await api('/api/admin/users/'+user.id,{method:'PUT',body:{is_active:!user.is_active}});toast('Account '+(user.is_active?'deactivated':'reactivated')+'.','success');await refresh();});
      }
      function reset(user) {
        openModal('Reset password',`<form id="account-dialog-form" class="account-form"><p class="account-form-intro">Set a new password for <strong>${e(user.name)}</strong>. Their existing sessions will be signed out.</p><div class="field"><label for="reset-password">New password</label><input id="reset-password" name="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></div><div class="field"><label for="reset-confirm">Confirm password</label><input id="reset-confirm" name="confirm" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></div>${dialogError}</form>`,footer('Reset password'));
        wireForm(async form=>{if(form.get('password')!==form.get('confirm'))throw Error('Your passwords do not match.');await api('/api/admin/users/'+user.id+'/password',{method:'POST',body:{password:form.get('password')}});toast('Password reset. Share it privately with the account owner.','success');});
      }
      function table() {
        const search=$('#account-search').value.toLowerCase().trim(),role=$('#account-role').value,status=$('#account-status').value;
        const filtered=users.filter(u=>(!role||u.role===role)&&(status===''||String(u.is_active)===status)&&[u.name,u.student_id,u.faculty_id,u.department,u.course].some(v=>String(v||'').toLowerCase().includes(search)));
        $('#account-result-count').textContent=filtered.length+' account'+(filtered.length===1?'':'s');
        $('#account-table').innerHTML=filtered.length?`<div class="table-wrapper"><table class="data-table account-user-table"><thead><tr><th>Person</th><th>Role / ID</th><th>Department</th><th>Status</th><th>Manage</th></tr></thead><tbody>${filtered.map(u=>`<tr><td><div class="account-person"><span class="account-avatar ${u.role==='faculty'?'faculty':''}">${e(u.name.charAt(0))}</span><div><strong>${e(u.name)}</strong><small>${e(u.course||u.specialization||'Portal administrator')}</small></div></div></td><td><span class="account-role-badge ${u.role}">${e(u.role)}</span><small class="account-table-id">${e(u.student_id||u.faculty_id||'—')}</small></td><td>${e(u.department||'—')}</td><td><span class="account-status ${u.is_active?'active':'inactive'}"><i></i>${u.is_active?'Active':'Deactivated'}</span></td><td>${u.role==='admin'?`<span class="account-muted">${u.id===currentUser().id?'Your account':'Administrator'}</span>`:`<div class="account-row-actions"><button class="btn btn-outline btn-sm" data-user-edit="${u.id}">Edit</button><button class="account-text-button" data-user-reset="${u.id}">Reset password</button><button class="account-text-button ${u.is_active?'danger':''}" data-user-toggle="${u.id}">${u.is_active?'Deactivate':'Reactivate'}</button></div>`}</td></tr>`).join('')}</tbody></table></div>`:empty('No accounts found','Try another name, student number, or filter.');
        for(const [attribute,handler] of [['userEdit',edit],['userReset',reset],['userToggle',toggle]]){const selector=attribute.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());el.querySelectorAll('[data-'+selector+']').forEach(b=>b.onclick=()=>handler(users.find(u=>u.id===Number(b.dataset[attribute]))));}
      }
      $('#account-search').oninput=table;$('#account-role').onchange=table;$('#account-status').onchange=table;table();
    }catch(err){error(el,err);$('#account-retry').onclick=()=>renderAccounts(el);}
  }

  return {showSignIn,renderOverview,renderAccounts};
};
