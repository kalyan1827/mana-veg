import { issueSession } from './sessions.mjs';
export const validUsername = value => typeof value==='string' && /^[a-zA-Z0-9_]{3,24}$/.test(value);

export async function hashPassword(password, saltHex = null) {
  const encoder = new TextEncoder();
  const salt = saltHex
    ? new Uint8Array(saltHex.match(/.{1,2}/g).map(b => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits), b => b.toString(16).padStart(2, '0')).join('');
  const saltOut = Array.from(salt, b => b.toString(16).padStart(2, '0')).join('');
  return `${saltOut}:${hashHex}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [saltOut, expectedHash] = storedHash.split(':');
  const computed = await hashPassword(password, saltOut);
  return computed === storedHash;
}

async function digest(secret, email, code) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const hash = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify([email,code])));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2,'0')).join('');
}

function buildOtpEmail(code, mode, username) {
  const title = mode === 'signup'
    ? 'Verify your new account'
    : mode === 'admin'
      ? 'Admin portal sign-in'
      : 'Sign in to your account';
  const greeting = mode === 'signup' && username
    ? `Welcome, ${username.replace(/[&<>"']/g, '')}!`
    : 'Hello,';
  const subtitle = mode === 'signup'
    ? 'Use the 6-digit code below to finish creating your Manakurgayalu account.'
    : mode === 'admin'
      ? 'Use the 6-digit code below to sign in to the Manakurgayalu Store Admin portal.'
      : 'Use the 6-digit code below to sign in to Manakurgayalu.';
  const subject = mode === 'signup'
    ? `${code} is your Manakurgayalu signup code`
    : mode === 'admin'
      ? `${code} is your Manakurgayalu Admin sign-in code`
      : `${code} is your Manakurgayalu sign-in code`;
  const textContent = `Manakurgayalu — ${title}\n\nYour code is ${code}. It expires in 10 minutes.\n\nIf you did not request this code, you can ignore this email.`;
  const htmlContent = `<div style="margin:0;padding:24px 12px;background:#f7f4eb;font-family:system-ui,-apple-system,Arial,sans-serif;color:#35271e;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e1d8ca;border-radius:14px;overflow:hidden;">
    <div style="background:#5a3e2b;color:#ffffff;padding:18px 20px;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;letter-spacing:.3px;">Manakurgayalu</div>
      <div style="font-size:12px;opacity:.88;margin-top:3px;">Fresh Local Vegetables · Bowenpally</div>
    </div>
    <div style="padding:24px 20px;text-align:center;">
      <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#35271e;">${greeting}</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#6c5b4d;">${subtitle}</p>
      <div style="background:#f7f4eb;border:1px dashed #c7b294;border-radius:12px;padding:16px 12px;margin:0 auto 16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:#6c5b4d;margin-bottom:6px;">Your verification code</div>
        <div style="font-family:ui-monospace,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#5a3e2b;">${code}</div>
      </div>
      <p style="margin:0;font-size:12px;color:#6c5b4d;">Valid for <strong>10 minutes</strong> · Do not share this code with anyone.</p>
    </div>
    <div style="background:#fbf8f2;border-top:1px solid #e1d8ca;padding:12px 20px;text-align:center;font-size:11px;color:#7d6b5d;">
      Manakurgayalu · Gandhinagar, Bowenpally · Didn’t request this? Safely ignore this email.
    </div>
  </div>
</div>`;
  return { subject, textContent, htmlContent };
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
    const mail = buildOtpEmail(code, mode, username);
    const response = await (env.sendLocalEmail ?? fetch)('https://api.brevo.com/v3/smtp/email',{
      method:'POST',
      headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({sender:{email:env.BREVO_SENDER,name:'Manakurgayalu'},to:[{email}],
        subject:mail.subject,textContent:mail.textContent,htmlContent:mail.htmlContent})
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
  if (mode === 'admin' && input?.password !== undefined) {
    if (typeof input.password !== 'string' || input.password.length < 8) {
      return reply({error:'Password must be at least 8 characters long'},400);
    }
    const passwordHash = await hashPassword(input.password);
    await db.prepare("UPDATE users SET password_hash=? WHERE email=? AND role='admin'").bind(passwordHash,email).run();
  }
  const cookie = await issueSession(db,email,role);
  return cookie ? reply({ok:true},200,{'Set-Cookie':cookie}) : reply({error:'Invalid code'},401);
}

export async function adminPasswordAuth(request, env, reply) {
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return reply({ error: 'Invalid origin' }, 403);

  const input = await request.json().catch(() => null);
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input?.password === 'string' ? input.password : '';
  if (!email || email.length > 254 || !password) {
    return reply({ error: 'Enter your admin email and password' }, 400);
  }

  const db = env.DB;
  const now = Date.now();
  const hour = Math.floor(now / 3600000);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = await digest(env.OTP_SECRET || 'admin-secret', ip, 'admin-pwd:' + hour);
  const rate = await db.prepare(`INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(bucket)
    DO UPDATE SET hits=hits+1 WHERE hits<? RETURNING hits`)
    .bind(bucket, (hour + 1) * 3600000, 20).first();
  if (!rate) return reply({ error: 'Too many login attempts. Try again later' }, 429);

  const user = await db.prepare('SELECT role, password_hash FROM users WHERE email=?').bind(email).first();
  if (!user || user.role !== 'admin') {
    return reply({ error: 'Invalid admin credentials' }, 401);
  }
  if (!user.password_hash) {
    return reply({
      error: 'No password set yet. Please verify your email first to set up your admin password.',
      needsSetup: true
    }, 400);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return reply({ error: 'Incorrect email or password' }, 401);
  }

  const cookie = await issueSession(db, email, 'admin');
  return cookie ? reply({ ok: true }, 200, { 'Set-Cookie': cookie }) : reply({ error: 'Failed to issue session' }, 500);
}
