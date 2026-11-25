(() => {
  let installPrompt = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const secure = window.isSecureContext;
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'install-app-launcher';
  launcher.textContent = 'Install app';
  launcher.setAttribute('aria-label', 'Install IT Consultation Portal on your device');
  launcher.hidden = standalone() || !secure;
  document.body.append(launcher);
  const dialog = document.createElement('dialog');
  dialog.className = 'install-app-dialog';
  dialog.setAttribute('aria-labelledby', 'install-app-title');
  dialog.innerHTML = `<img src="/images/app-icon-192.png" alt="" width="64" height="64"><h2 id="install-app-title">Your consultations, a tap away</h2><p>Add IT Consult to your home screen for quick access to schedules, appointments, and your consultation pass.</p><div id="install-native" hidden><button type="button" class="btn btn-primary" id="install-app-confirm">Install app</button></div><div id="install-manual"><strong>Android · Chrome</strong><p>Open the browser menu (⋮), then choose <b>Install app</b> or <b>Add to Home screen</b>.</p><strong>iPhone · Safari</strong><p>Tap <b>Share</b>, then <b>Add to Home Screen</b> and <b>Add</b>. If available, enable <b>Open as Web App</b>.</p><small>On a computer, use your browser's install icon or app menu. Installation options depend on your browser.</small></div><p class="install-online-note">An internet connection is needed to book and check in.</p><button type="button" class="btn btn-outline" id="install-app-close">Close</button>`;
  document.body.append(dialog);
  const native = dialog.querySelector('#install-native');
  const manual = dialog.querySelector('#install-manual');
  const hideLauncher = () => { launcher.hidden = true; if(dialog.open) dialog.close(); };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
    launcher.hidden = standalone(); native.hidden = false; manual.hidden = true;
  });
  window.addEventListener('appinstalled', () => {installPrompt = null; hideLauncher();});
  window.matchMedia('(display-mode: standalone)').addEventListener('change', event => {launcher.hidden = event.matches || !secure;});
  launcher.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('#install-app-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {if(event.target === dialog) {const r=dialog.getBoundingClientRect(); if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) dialog.close();}});
  dialog.querySelector('#install-app-confirm').addEventListener('click', async () => {
    if(!installPrompt) return;
    const prompt = installPrompt; installPrompt = null;
    native.hidden = true; manual.hidden = false;
    try {await prompt.prompt(); const choice = await prompt.userChoice; if(choice.outcome === 'accepted') hideLauncher();} catch { /* Keep manual installation instructions available. */ }
  });
  // Do not issue a browser install prompt automatically.
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
