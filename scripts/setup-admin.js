// Run locally: npm run setup:admin -- --username admin --name "System Administrator"
// ADMIN_PASSWORD may supply a password; otherwise a strong one is generated once.
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
async function main(){
const {db,close}=await require('../server').ready;
try {
  const option = (name,fallback) => { const index=process.argv.indexOf('--'+name); return index<0?fallback:process.argv[index+1]; };
  const username=option('username','admin');
  const name=option('name','System Administrator');
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username||'') || !name?.trim() || name.length>200) throw Error('Provide a valid username (3–40 letters, numbers, dots, underscores or hyphens) and name.');
  if (await db.prepare("SELECT id FROM users WHERE role='admin'").get()) throw Error('An administrator already exists. Setup will not overwrite existing accounts.');
  if (await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(username)) throw Error('This username is already in use.');
  const password=process.env.ADMIN_PASSWORD || crypto.randomBytes(15).toString('base64url');
  if (password.length<8 || Buffer.byteLength(password)>72) throw Error('Password must be at least 8 characters and at most 72 bytes.');
  const id=Number((await db.prepare("INSERT INTO users(email,password,name,role) VALUES(?,?,?,'admin')").run(username,bcrypt.hashSync(password,12),name.trim())).lastInsertRowid);
  await db.prepare("INSERT INTO audit_log(actor_id,action,target_id) VALUES(?,'admin.initialized',?)").run(id,id);
  console.log('\nAdministrator created. Select the Admin tab on the sign-in page.\nUsername: '+username+'\n'+(process.env.ADMIN_PASSWORD?'Password: supplied through ADMIN_PASSWORD':'Password: '+password)+'\nChange the generated password in your profile after signing in.\n');
} catch(e) { console.error(e.message);process.exitCode=1; }
finally { await close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
