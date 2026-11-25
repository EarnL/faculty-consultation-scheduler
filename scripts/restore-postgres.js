const fs=require('node:fs'),zlib=require('node:zlib');
async function main() {
  if(!process.argv.includes('--confirm-replace')||!process.argv.includes('--confirm-offline'))throw Error('Stop the hosted backend, preserve a fresh backup, then provide --confirm-offline --confirm-replace.');
  if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL privately in the environment.');
  const index=process.argv.indexOf('--file');if(index<0||!process.argv[index+1])throw Error('Provide --file with a downloaded .json.gz backup.');
  const snapshot=JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[index+1]),{maxOutputLength:256*1024*1024}).toString('utf8'));
  if(snapshot.format!=='it-consult-postgres-v1'||!snapshot.tables)throw Error('Unsupported PostgreSQL backup format.');
  const db=await require('../storage').postgresAdapter({connectionString:process.env.DATABASE_URL});
  try {const counts=await require('../postgres-transfer').importTables(db,snapshot.tables,{replace:true});console.log('Restore committed. Login sessions were cleared. Restart the backend.');console.log(JSON.stringify(counts,null,2));}
  finally {await db.close();}
}
main().catch(error=>{console.error(error.message.startsWith('Stop the hosted')||error.message.startsWith('Set DATABASE')||error.message.startsWith('Provide --file')?error.message:'Restore failed; inspect the backup and private database configuration.');process.exitCode=1;});
