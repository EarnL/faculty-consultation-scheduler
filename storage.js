const {AsyncLocalStorage} = require('node:async_hooks');
const fs = require('node:fs');
const path = require('node:path');
const localContext = new AsyncLocalStorage();

// Retain one local SQLite connection while allowing asynchronous route handlers.
// The lock stays held across awaits in a transaction, including rollback.
function sqliteAdapter(raw) {
  let tail = Promise.resolve();
  const token = {};
  async function locked(work) {
    if(localContext.getStore() === token) return work();
    const previous = tail;
    let release;
    tail = new Promise(resolve => {release = resolve;});
    await previous;
    try {return await localContext.run(token,work);} finally {release();}
  }
  const adapter = {
    kind:'sqlite', raw, name:raw.name,
    prepare(sql) {
      return Object.fromEntries(['get','all','run'].map(method => [method,(...args)=>locked(()=>raw.prepare(sql)[method](...args))]));
    },
    exec:sql=>locked(()=>raw.exec(sql)),
    backup:file=>locked(()=>raw.backup(file)),
    close:()=>locked(()=>raw.close()),
    transaction(fn) {
      const run = (...args)=>locked(async()=>{
        raw.exec('BEGIN IMMEDIATE');
        try {const result = await fn(...args);raw.exec('COMMIT');return result;}
        catch(error) {raw.exec('ROLLBACK');throw error;}
      });
      run.immediate=run;return run;
    }
  };
  return adapter;
}

function postgresSQL(source) {
  let sql = source.replace(/datetime\('now','localtime'\)/gi,"to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI:SS')")
    .replace(/json_extract\(data,'\$\.userId'\)/g,"((data::jsonb->>'userId')::integer)")
    .replace(/([\w.]+)\s*=\s*\?\s+COLLATE NOCASE/gi,'lower($1)=lower(?)')
    .replace(/\bLIKE\b/gi,'ILIKE');
  if(/\bFROM departments\b/i.test(sql))sql=sql.replace(/\bWHERE name\s*=\s*\?/gi,'WHERE lower(name)=lower(?)');
  const ignore=/^\s*INSERT OR IGNORE\b/i.test(sql);
  sql=sql.replace(/^\s*INSERT OR IGNORE\b/i,'INSERT');
  if (/^\s*INSERT OR REPLACE INTO sessions/i.test(sql)) {
    sql='INSERT INTO sessions(sid,data,expires) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data,expires=excluded.expires';
  }
  let quoted=false,index=0,result='';
  for(let i=0;i<sql.length;i++) {
    const char=sql[i];
    if(char==="'") {if(quoted&&sql[i+1]==="'"){result+="''";i++;continue;}quoted=!quoted;}
    result+=char==='?'&&!quoted?'$'+(++index):char;
  }
  result=result.trim().replace(/;$/,'');
  if(ignore)result+=' ON CONFLICT DO NOTHING';
  // The only insert without an integer id is the session store.
  if(/^INSERT\b/i.test(result)&&!/^INSERT INTO sessions\b/i.test(result))result+=' RETURNING id';
  else if(/^(UPDATE|DELETE)\b/i.test(result))result+=' RETURNING 1';
  return result;
}

async function postgresAdapter({connectionString,testPath}={}) {
  const context=new AsyncLocalStorage();
  let pool;
  if(testPath) {
    if(process.env.NODE_ENV==='production')throw Error('Embedded PostgreSQL is available only for local tests.');
    const {PGlite}=require('@electric-sql/pglite');
    const engine=new PGlite(testPath);
    await engine.waitReady;
    let tail=Promise.resolve();
    pool={query:(sql,params)=>{const result=tail.then(()=>params===undefined?engine.exec(sql):engine.query(sql,params));tail=result.catch(()=>{});return result;},end:()=>engine.close(),test:true};
  } else {
    const {Pool,types}=require('pg');
    types.setTypeParser(20,value=>Number(value));
    pool=new Pool({connectionString,max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000,statement_timeout:15000});
    pool.on('error',()=>console.error('A database connection ended unexpectedly.'));
  }
  await pool.query('SELECT 1');
  let testTail=Promise.resolve();
  async function testLock(fn) {
    const previous=testTail;let release;testTail=new Promise(resolve=>{release=resolve;});
    await previous;try{return await fn();}finally{release();}
  }
  const execute=(sql,params=[]) => pool.test&&!context.getStore()?testLock(()=>pool.query(sql,params)):(context.getStore()||pool).query(sql,params);
  const adapter={
    kind:'postgres',name:'PostgreSQL',
    prepare(source) {
      const sql=postgresSQL(source);
      const query=async args=>{
        try{return await execute(sql,args.map(value=>value===undefined?null:value));}
        catch(error){if(error.code==='23505'){error.code='SQLITE_CONSTRAINT_UNIQUE';}throw error;}
      };
      return {
        get:async(...args)=>(await query(args)).rows[0],
        all:async(...args)=>(await query(args)).rows,
        run:async(...args)=>{const r=await query(args);return {changes:r.rowCount??r.affectedRows??r.rows.length,lastInsertRowid:r.rows[0]?.id};}
      };
    },
    exec:sql=>execute(postgresSQL(sql)),
    close:()=>pool.end(),
    transaction(fn) {
      const work=async(...args)=>{
        if(context.getStore())return fn(...args);
        const client=pool.test?pool:await pool.connect();
        try {
          await client.query('BEGIN');
          if(!pool.test)await client.query('SELECT pg_advisory_xact_lock(677447)');
          const result=await context.run(client,()=>fn(...args));
          await client.query('COMMIT');return result;
        } catch(error){await client.query('ROLLBACK');throw error;}
        finally{if(!pool.test)client.release();}
      };
      const run=(...args)=>pool.test&&!context.getStore()?testLock(()=>work(...args)):work(...args);
      run.immediate=run;return run;
    }
  };
  try {await pool.query(fs.readFileSync(path.join(__dirname,'deploy','postgres-schema.sql'),'utf8'));}
  catch(error){await pool.end();throw error;}
  return adapter;
}
module.exports={sqliteAdapter,postgresAdapter,postgresSQL};
