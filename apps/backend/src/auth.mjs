import { issueSession } from './sessions.mjs';
export const validUsername = value => typeof value==='string' && /^[a-zA-Z0-9_]{3,24}$/.test(value);

async function digest(secret, email, code) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const hash = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify([email,code])));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2,'0')).join('');
}

export async function emailAuth(request, env, path, reply) {
  if (request.method !== 'POST') return reply({error:'Method not allowed'},405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return reply({error:'Invalid origin'},403);
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER || !env.OTP_SECRET) return reply({error:'Email login unavailable'},503);

  const input = await request.json().catch(() => null);
  const mode = input?.mode;
  const username=input?.username;
  if(mode==='signup' && !validUsername(username)) return reply({error:'Use a username with 3-24 letters, digits or underscores',field:'username'},400);
  if (!['login','signup','admin'].includes(mode)) return reply({error:'Choose sign in or create an account'},400);
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({error:'Invalid email'},400);
  const db = env.DB;
  const now = Date.now();
  const issuing = path.endsWith('/request');
  const hour = Math.floor(now / 3600000);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = await digest(env.OTP_SECRET, ip, String(issuing) + ':' + hour);
  const rate = await db.prepare(`INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(bucket)
    DO UPDATE SET hits=hits+1 WHERE hits<? RETURNING hits`)
    .bind(bucket,(hour+1)*3600000,issuing ? 12 : 60).first();
  if (!rate) return reply({error:'Try again later'},429);
  const account = await db.prepare('SELECT role FROM users WHERE email=?').bind(email).first();
  const role = mode === 'admin' ? 'admin' : 'customer';
  const eligible = mode === 'signup' ? !account : account?.role === role;
  if (!eligible) {
    if (!issuing) return reply({error:'Invalid code for this option'},401);
    if (mode === 'admin') return reply({error:'Use the email address assigned to your admin account.'},400);
    return mode === 'login'
      ? reply({ok:false,error:'No customer account can sign in with this email. Create an account or check the address.'},400)
      : reply({ok:false,error:'This email cannot be used to create an account. Try signing in or use another email.'},400);
  }
  if(mode==='signup' && await db.prepare('SELECT 1 FROM users WHERE username=?').bind(username).first()) {
    return reply({error:'That username is taken',field:'username'},409);
  }
  const purpose=mode==='signup' ? mode+':'+username : mode;

  if (issuing) {
    const random = new Uint32Array(1);
    do { crypto.getRandomValues(random); } while (random[0] >= 4294000000);
    const code = String(random[0] % 1000000).padStart(6,'0');
    const hash = await digest(env.OTP_SECRET,email,purpose+':'+code);
    const row = await db.prepare(`INSERT INTO otp VALUES (?,?,?,0,?) ON CONFLICT(email)
      DO UPDATE SET digest=excluded.digest,expires=excluded.expires,attempts=0,sent=excluded.sent
      WHERE otp.sent<=? RETURNING email`).bind(email,hash,now+600000,now,now-60000).first();
    if (!row) return reply({error:'Wait one minute before requesting another code'},429);
    const response = await (env.sendLocalEmail ?? fetch)('https://api.brevo.com/v3/smtp/email',{
      method:'POST',
      headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({sender:{email:env.BREVO_SENDER,name:'Manankuragayalu'},to:[{email}],
        subject:'Your Manankuragayalu sign-in code',textContent:'Your code is '+code+'. It expires in 10 minutes.'})
    }).catch(() => null);
    if (response?.ok) return reply({ok:true});
    await db.prepare('UPDATE otp SET expires=0 WHERE email=? AND digest=?').bind(email,hash).run();
    return reply({error:'Unable to send a code. Try again later.'},503);
  }

  const code = input?.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return reply({error:'Enter the six-digit code'},400);
  const hash = await digest(env.OTP_SECRET,email,purpose+':'+code);
  const row = await db.prepare('DELETE FROM otp WHERE email=? AND digest=? AND expires>? AND attempts<5 RETURNING email')
    .bind(email,hash,now).first();
  if (!row) {
    await db.prepare('UPDATE otp SET attempts=attempts+1 WHERE email=? AND expires>? AND attempts<5').bind(email,now).run();
    return reply({error:'Invalid or expired code'},401);
  }
  if (mode === 'signup') {
    const created = await db.prepare("INSERT INTO users(email,role,username) VALUES (?,'customer',?) ON CONFLICT DO NOTHING RETURNING email").bind(email,username).first();
    if (!created) return reply({error:'Email or username is already in use'},409);
  }
  const cookie = await issueSession(db,email,role);
  return cookie ? reply({ok:true},200,{'Set-Cookie':cookie}) : reply({error:'Invalid code'},401);
}
