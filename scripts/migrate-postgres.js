// Import a consistent read-only SQLite snapshot into an EMPTY PostgreSQL target.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
async function main() {
  if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL privately in the environment before migrating.');
  const argument=process.argv.indexOf('--file'),source=path.resolve(argument<0?path.join(__dirname,'..','scheduler.db'):process.argv[argument+1]||'');
  if(!fs.existsSync(source)||!fs.statSync(source).isFile())throw Error('SQLite source file not found.');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'portal-sqlite-import-'));
  let sourceDb,snapshot,target;
  try {
    sourceDb=new Database(source,{readonly:true});await sourceDb.backup(path.join(directory,'snapshot.db'));sourceDb.close();sourceDb=null;
    snapshot=new Database(path.join(directory,'snapshot.db'),{readonly:true});
    if(snapshot.pragma('integrity_check',{simple:true})!=='ok'||snapshot.pragma('foreign_key_check').length)throw Error('SQLite snapshot failed verification.');
    const tables={};for(const table of require('../postgres-backups').TABLES)tables[table]=snapshot.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    target=await require('../storage').postgresAdapter({connectionString:process.env.DATABASE_URL});
    const counts=await require('../postgres-transfer').importTables(target,tables);
    console.log('Verified import completed. Local records and passwords were preserved; login sessions were not copied.');
    console.log(JSON.stringify(counts,null,2));
  } finally {
    sourceDb?.close();snapshot?.close();if(target)await target.close();
    const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('portal-sqlite-import-'))throw Error('Unsafe temporary directory');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error('Import failed. '+(error.message.includes('already has accounts')?error.message:'Check the private database configuration and source snapshot. No credentials are printed.'));process.exitCode=1;});
