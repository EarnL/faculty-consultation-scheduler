const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function origin(value, label) {
  if (!value) throw new Error(`${label} is required. Set the actual HTTPS site origin in Netlify build environment variables.`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${label} must be an HTTPS origin without a path, credentials, query or fragment.`);
  return url.origin;
}
function build(env = process.env) {
  // Validate everything before creating output. Never ship a guessed backend.
  const backend = origin(env.RENDER_API_URL, 'RENDER_API_URL');
  const frontend = origin(env.PUBLIC_URL || env.URL, 'PUBLIC_URL (or Netlify URL)');
  if (backend === frontend) throw new Error('The Render backend and Netlify frontend must have different origins.');
  const output = path.join(root, 'netlify-dist');
  fs.mkdirSync(output, {recursive:true});
  // public/ is deliberately the only copied source. No DBs, backups or secrets.
  fs.cpSync(path.join(root,'public'), output, {recursive:true, force:true});
  fs.writeFileSync(path.join(output,'_redirects'), [
    `/api/* ${backend}/api/:splat 200!`,
    '/* /index.html 200',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(output,'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /offline.html\nSitemap: ${frontend}/sitemap.xml\n`);
  fs.writeFileSync(path.join(output,'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${frontend}/</loc></url></urlset>\n`);
  const index = path.join(output, 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index,'utf8').replace('</head>', `  <link rel="canonical" href="${frontend}/">\n</head>`));
  return {output, backend, frontend};
}
if (require.main === module) {
  try {const result=build();console.log(`Frontend prepared in ${result.output}. API requests use the Render proxy.`);}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
module.exports={build,origin};
