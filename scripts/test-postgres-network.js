// Runs integration tests against a NEW disposable loopback PostgreSQL cluster.
// Never connects to or changes an existing PostgreSQL service/database.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
async function main(){
 const bin=process.env.POSTGRES_BIN||(process.platform==='win32'?'C:\\Program Files\\PostgreSQL\\18\\bin':'/usr/lib/postgresql/18/bin');
 const extension=process.platform==='win32'?'.exe':'';
 if(!fs.existsSync(path.join(bin,'initdb'+extension)))throw Error('Set POSTGRES_BIN to an installed PostgreSQL binary directory.');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'portal-pg-network-'));
 const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
 let server;
 try{
  const initialized=spawnSync(path.join(bin,'initdb'+extension),['-D',directory,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8'],{encoding:'utf8',windowsHide:true});
  if(initialized.status!==0)throw Error('Disposable PostgreSQL initialization failed: '+initialized.stderr);
  server=spawn(path.join(bin,'postgres'+extension),['-D',directory,'-h','127.0.0.1','-p',String(port)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let logs='';server.stderr.on('data',buffer=>logs+=buffer);
  const {Client}=require('pg');let ready=false;
  for(let i=0;i<100;i++){
   const client=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});
   try{await client.connect();ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}finally{await client.end();}
  }
  if(!ready)throw Error('Disposable PostgreSQL did not start: '+logs);
  const tests=spawn(process.execPath,['--test','tests/postgres.test.js'],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',windowsHide:true,env:{...process.env,TEST_POSTGRES_DISPOSABLE:'true',TEST_POSTGRES_URL:`postgresql://postgres@127.0.0.1:${port}/postgres`}});
  process.exitCode=await new Promise(resolve=>tests.once('exit',code=>resolve(code||0)));
 }finally{
  if(server&&server.exitCode===null){spawnSync(path.join(bin,'pg_ctl'+extension),['-D',directory,'stop','-m','fast','-w'],{windowsHide:true,stdio:'ignore'});if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));}
  const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('portal-pg-network-'))throw Error('Unsafe disposable cluster cleanup');fs.rmSync(target,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
