const crypto=require('node:crypto');
const zlib=require('node:zlib');
const TABLES=['users','departments','faculty_schedules','appointments','notifications','blocked_dates','audit_log','reschedule_requests','appointment_events','reminder_deliveries'];
function installBackups({app,db,auth}) {
  const admin=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Administrator access required'});
  const metadata=row=>row?{file:row.file,bytes:Number(row.bytes),created_at:row.created_at}:null;
  app.get('/api/admin/backups',auth,admin,async(req,res)=>res.json({latest:metadata(await db.prepare('SELECT file,bytes,created_at FROM portal_backups ORDER BY created_at DESC LIMIT 1').get())}));
  app.post('/api/admin/backups',auth,admin,async(req,res)=>{
    const result=await db.transaction(async()=>{
      const tables={};for(const table of TABLES)tables[table]=await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      const bytes=zlib.gzipSync(JSON.stringify({format:'it-consult-postgres-v1',created_at:new Date().toISOString(),tables}));
      JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
      const file=`portal-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json.gz`;
      const created=new Date().toISOString();
      await db.prepare('INSERT INTO portal_backups(file,payload,bytes,created_at) VALUES(?,?,?,?)').run(file,bytes.toString('base64'),bytes.length,created);
      await db.prepare("INSERT INTO audit_log(actor_id,action,details) VALUES(?,'backup.created',?)").run(req.user.id,file);
      // Retain three downloadable snapshots in the database. Download copies
      // off-host for recovery independent of the database provider.
      await db.exec('DELETE FROM portal_backups WHERE id NOT IN (SELECT id FROM portal_backups ORDER BY id DESC LIMIT 3)');
      return {file,bytes:bytes.length,created_at:created};
    }).immediate();
    res.status(201).json(result);
  });
  app.get('/api/admin/backups/:file/download',auth,admin,async(req,res)=>{
    if(!/^portal-backup-\d+-[a-f0-9]{8}\.json\.gz$/.test(req.params.file))return res.status(404).json({error:'Backup not found'});
    const row=await db.prepare('SELECT payload FROM portal_backups WHERE file=?').get(req.params.file);
    if(!row)return res.status(404).json({error:'Backup not found'});
    res.type('application/gzip').attachment(req.params.file).send(Buffer.from(row.payload,'base64'));
  });
}
module.exports={installBackups,TABLES};
