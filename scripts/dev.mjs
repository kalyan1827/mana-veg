import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import backend from '../apps/backend/src/index.mjs';
import { localDatabase } from './local-db.mjs';
import { vegetables } from './demo-produce.mjs';

const DB = localDatabase();
const localOtpSecret = crypto.randomUUID();
const adminEmail = process.env.LOCAL_ADMIN_EMAIL?.trim().toLowerCase() || 'staff@example.test';
if (adminEmail !== 'staff@example.test') {
  await DB.prepare("INSERT INTO users(email,role) VALUES (?,'admin')").bind(adminEmail).run();
}
async function sendLocalEmail(_url, options) {
  const { to, textContent } = JSON.parse(options.body);
  console.log('Local sign-in for ' + to[0].email + ': ' + textContent);
  return new Response(null,{status:201});
}
const brevoApiKey = process.env.BREVO_API_KEY?.trim();
const emailEnv = brevoApiKey ? {
  BREVO_API_KEY: brevoApiKey,
  BREVO_SENDER: process.env.BREVO_SENDER?.trim() || 'manaveg083@gmail.com',
  sendLocalEmail(url, options) {
    const { to } = JSON.parse(options.body);
    return to[0].email === 'staff@example.test' ? sendLocalEmail(url, options) : fetch(url, options);
  }
} : {
  BREVO_API_KEY: 'local',
  BREVO_SENDER: 'local@example.test',
  sendLocalEmail
};
console.log('Local admin: ' + adminEmail + (adminEmail === 'staff@example.test' ? ' (code appears in this terminal)' : ''));
console.log(brevoApiKey ? 'Login codes: Brevo email' : 'Login codes: terminal preview (BREVO_API_KEY is unset)');
const images = new Map();
const demoPhotoIds = new Set(vegetables.map(([id])=>id));
const PHOTOS = {
  async get(id) {
    if (images.has(id)) return images.get(id);
    if (!demoPhotoIds.has(id)) return null;
    const body = await readFile(new URL('./demo-photos/'+id+'.jpg',import.meta.url)).catch(error=>{
      if (error.code==='ENOENT') return null;
      throw error;
    });
    return body && { body,httpMetadata:{contentType:'image/jpeg'} };
  },
  async put(id, body, { httpMetadata }) { images.set(id, { body, httpMetadata }); },
  async delete(id) { images.delete(id); }
};
const assets = new Map([['/','index.html'],['/style.css','style.css'],['/app.mjs','app.mjs'],['/logo.svg','logo.svg'],['/logo.jpg','logo.jpg'],['/manifest.webmanifest','manifest.webmanifest']]);
const mime = { 'index.html':'text/html', 'style.css':'text/css', 'app.mjs':'text/javascript', 'logo.svg':'image/svg+xml', 'logo.jpg':'image/jpeg', 'manifest.webmanifest':'application/manifest+json' };
for (const [app, port] of [
  ['customer',Number(process.env.CUSTOMER_PORT ?? 8787)],
  ['admin',Number(process.env.ADMIN_PORT ?? 8788)]
]) {
  // Cookies are scoped by hostname, so using separate ports alone shares the session.
  const host = app === 'customer' ? 'localhost' : '127.0.0.1';
  const origin = 'http://'+host+':'+port;
  createServer(async (incoming,outgoing) => {
    try {
      const url = new URL(incoming.url,origin);
      const file = assets.get(url.pathname);
      if (file && incoming.method==='GET') {
        const body = await readFile(new URL('../apps/'+app+'/public/'+file,import.meta.url));
        const headers = {'Content-Type':mime[file]};
        outgoing.writeHead(200,headers);
        outgoing.end(body);
        return;
      }
      const request = new Request(url,{method:incoming.method,headers:incoming.headers,
        ...(!['GET','HEAD'].includes(incoming.method) && {body:incoming,duplex:'half'})});
      const response = await backend.fetch(request,{DB,PHOTOS,DEMO_CATALOG:true,OTP_SECRET:localOtpSecret,...emailEnv});
      outgoing.writeHead(response.status,Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      outgoing.writeHead(500);
      outgoing.end('Local request failed');
    }
  }).listen(port,host,()=>console.log(app+' '+origin));
}
