// Run only while the scheduler is stopped. Never invoked from a web request.
const fs=require('fs'),path=require('path'),net=require('net'),Database=require('better-sqlite3');
async function main(){
 const args=process.argv.slice(2),sourceArg=args[args.indexOf('--file')+1];
 if(!args.includes('--file')||!sourceArg||!args.includes('--confirm-replace'))throw Error('Usage: npm run restore:backup -- --file "backup.db" --confirm-replace. Stop the server first.');
 const source=path.resolve(sourceArg),target=path.resolve(process.env.DB_PATH||path.join(__dirname,'../scheduler.db'));
 const sessionPath=path.resolve(process.env.SESSION_DB_PATH||path.join(__dirname,'../sessions.db'));
 if(sessionPath===source||sessionPath===target)throw Error('The session database must be separate from the application database.');
 if(source===target||!fs.existsSync(source)||!fs.existsSync(target))throw Error('Choose an existing backup and a different existing target database.');
 const listening=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:Number(process.env.PORT)||3000});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.setTimeout(1500,()=>{socket.destroy();resolve(true);});});
 if(listening)throw Error('The application port is in use. Stop the server before restoring.');
 if(fs.existsSync(sessionPath)){const sessions=new Database(sessionPath,{readonly:true});try{if(!sessions.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get())throw Error('SESSION_DB_PATH is not a scheduler session database.');}finally{sessions.close();}}
 const backup=new Database(source,{readonly:true});
 const temporary=target+'.restore-'+Date.now(),preserved=target+'.before-restore-'+Date.now()+'.db';
 try{
  if(backup.pragma('integrity_check',{simple:true})!=='ok'||backup.pragma('foreign_key_check').length)throw Error('The backup failed database validation.');
  for(const table of ['users','appointments','faculty_schedules','notifications'])if(!backup.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))throw Error('This is not a scheduler backup.');
  const current=new Database(target,{timeout:1000});try{current.prepare('BEGIN EXCLUSIVE').run();current.prepare('COMMIT').run();const result=current.pragma('wal_checkpoint(TRUNCATE)');if(result.some(r=>r.busy))throw Error('The database is still in use. Stop all application instances.');}finally{current.close();}
  await backup.backup(temporary);
 }finally{backup.close();}
 fs.renameSync(target,preserved);
 try{fs.renameSync(temporary,target);}catch(err){fs.renameSync(preserved,target);throw err;}
 if(fs.existsSync(sessionPath)){const sessions=new Database(sessionPath);try{sessions.prepare('DELETE FROM sessions').run();}finally{sessions.close();}}
 console.log('Restore completed. Previous database preserved at: '+preserved+'\nExisting login sessions cleared. Restart the scheduler to apply compatible schema updates.');
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
