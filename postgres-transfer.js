const TABLES=require('./postgres-backups').TABLES;
async function importTables(db,tables,{replace=false}={}) {
  for(const table of TABLES)if(!Array.isArray(tables[table]))throw Error('The snapshot is missing table '+table);
  return db.transaction(async()=>{
    if(!replace&&(await db.prepare('SELECT count(*) AS n FROM users').get()).n!==0)throw Error('The target database already has accounts. Import refused; existing data was preserved.');
    if(replace)await db.exec(`TRUNCATE TABLE ${TABLES.join(',')},sessions,portal_backups RESTART IDENTITY CASCADE`);
    const counts={};
    // Foreign-key parents are inserted before their children.
    for(const table of TABLES) {
      const allowed=(await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=?").all(table)).map(row=>row.column_name);
      for(const row of tables[table]) {
        const columns=Object.keys(row);
        if(!columns.length||columns.some(column=>!allowed.includes(column)))throw Error('Unsupported snapshot columns for '+table);
        await db.prepare(`INSERT INTO ${table}(${columns.map(column=>'"'+column+'"').join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column]));
      }
      await db.exec(`SELECT setval(pg_get_serial_sequence('${table}','id'),greatest(coalesce((SELECT max(id) FROM ${table}),0),1),(SELECT count(*)>0 FROM ${table}))`);
      counts[table]=tables[table].length;
    }
    await db.exec('DELETE FROM sessions');
    return counts;
  }).immediate();
}
module.exports={importTables};
