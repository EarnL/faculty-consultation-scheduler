const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {build,origin}=require('../scripts/build-netlify');
test('Netlify build requires real HTTPS origins before publishing and keeps API routing before the page fallback',t=>{
  for(const value of ['', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/api', 'https://example.com/?key=secret', 'https://example.com/#fragment']) assert.throws(()=>origin(value,'Host'));
  assert.throws(()=>build({}),/RENDER_API_URL is required/);
  assert.throws(()=>build({RENDER_API_URL:'https://backend.example',PUBLIC_URL:'http://frontend.example'}),/HTTPS/);
  const result=build({RENDER_API_URL:'https://backend.example',PUBLIC_URL:'https://frontend.example'});
  t.after(()=>{
    const target=path.resolve(result.output),workspace=path.resolve(__dirname,'..');
    if(path.dirname(target)!==workspace || path.basename(target)!=='netlify-dist') throw new Error('Refusing cleanup outside the generated frontend directory.');
    fs.rmSync(target,{recursive:true,force:true});
  });
  const redirects=fs.readFileSync(path.join(result.output,'_redirects'),'utf8').split('\n');
  assert.equal(redirects[0],'/api/* https://backend.example/api/:splat 200!');
  assert.equal(redirects[1],'/* /index.html 200');
  assert.match(fs.readFileSync(path.join(result.output,'robots.txt'),'utf8'),/Sitemap: https:\/\/frontend.example\/sitemap.xml/);
  assert.match(fs.readFileSync(path.join(result.output,'index.html'),'utf8'),/rel="canonical" href="https:\/\/frontend.example\/"/);
  for(const privateFile of ['scheduler.db','sessions.db','.session-secret','.env','server.js','backups','node_modules']) assert.equal(fs.existsSync(path.join(result.output,privateFile)),false,privateFile);
  assert.ok(fs.existsSync(path.join(result.output,'manifest.webmanifest')));
});
