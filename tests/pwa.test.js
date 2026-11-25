const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'public',name),'utf8');
function browser({standalone=false,secure=true}={}) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://portal.example',runScripts:'outside-only'});
  Object.defineProperty(dom.window,'isSecureContext',{value:secure});
  dom.window.matchMedia=()=>({matches:standalone,addEventListener(){}});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  dom.window.eval(read('js/pwa.js'));
  return dom;
}
test('manifest has real correctly sized PNG icons and a same-origin standalone launch',()=>{
  const manifest=JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');
  for(const size of [192,512]) {
    const icon=manifest.icons.find(i=>i.sizes===`${size}x${size}`);assert.ok(icon);
    const png=fs.readFileSync(path.join(root,'public',icon.src));
    assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
  }
});
test('installation instructions open on user action and installed/insecure contexts hide the button',()=>{
  for(const options of [{},{standalone:true},{secure:false}]) {
    const dom=browser(options),document=dom.window.document;
    const button=document.querySelector('.install-app-launcher');
    assert.equal(button.hidden,!!options.standalone||options.secure===false);
    if(!button.hidden){assert.equal(document.querySelector('dialog').open,false);button.click();assert.equal(document.querySelector('dialog').open,true);assert.match(document.querySelector('dialog').textContent,/Add to Home Screen/);document.querySelector('#install-app-close').click();assert.equal(document.querySelector('dialog').open,false);}
    dom.window.close();
  }
});
test('native installation waits for the user and hides after acceptance',async()=>{
  const dom=browser();let calls=0;
  const event=new dom.window.Event('beforeinstallprompt',{cancelable:true});
  event.prompt=async()=>{calls++;};event.userChoice=Promise.resolve({outcome:'accepted'});
  dom.window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(calls,0);
  dom.window.document.querySelector('.install-app-launcher').click();
  dom.window.document.querySelector('#install-app-confirm').click();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  assert.equal(dom.window.document.querySelector('.install-app-launcher').hidden,true);
  dom.window.close();
});
test('service worker bypasses APIs and posts; offline navigation shows only the public fallback',async()=>{
  const listeners={},lookups=[];let cached;
  const context={URL,self:{location:{origin:'https://portal.example'},addEventListener:(name,handler)=>listeners[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>({addAll:async files=>{cached=files;}}),keys:async()=>[],match:async key=>{lookups.push(key);return 'PUBLIC OFFLINE PAGE';}},fetch:async()=>{throw Error('offline');}};
  vm.runInNewContext(read('sw.js'),context);
  let installing;listeners.install({waitUntil:p=>installing=p});await installing;
  assert.ok(cached.every(file=>!file.startsWith('/api/') && file!=='/' && !file.endsWith('.js')));
  for(const [url,method,mode] of [['https://portal.example/api/appointments/16/pass','GET','navigate'],['https://portal.example/api/appointments','POST','cors'],['https://other.example/','GET','navigate']]) {
    let intercepted=false;listeners.fetch({request:{url,method,mode},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
  }
  let result;listeners.fetch({request:{url:'https://portal.example/',method:'GET',mode:'navigate'},respondWith:p=>result=p});
  assert.equal(await result,'PUBLIC OFFLINE PAGE');assert.deepEqual(lookups,['/offline.html']);
});
