const cookieLifetime = 400 * 24 * 60 * 60;
const encoder = new TextEncoder();
const cookieAttributes = '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=';
const readToken = request => request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-session=([a-f0-9-]{72})(?:;|$)/)?.[1];

async function digest(token) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Invoke only after OTP verification and any required staff MFA.
export async function issueSession(db, verifiedEmail, role = 'customer') {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const issued = await db.prepare('INSERT INTO sessions (token,email,expires) SELECT ?,email,? FROM users WHERE email=? AND role=? RETURNING token')
    .bind(await digest(token), role === 'customer' ? -1 : Date.now() + 7 * 86400000, verifiedEmail, role).first();
  if (!issued) return null;
  return '__Host-session=' + token + cookieAttributes + (role === 'customer' ? cookieLifetime : 7 * 86400);
}

export async function readSession(db, request) {
  const token = readToken(request);
  if (!token) return null;
  return db.prepare(
    "SELECT users.email, users.role FROM sessions JOIN users ON users.email=sessions.email WHERE sessions.token=? AND (sessions.expires>? OR (sessions.expires=-1 AND users.role='customer'))"
  ).bind(await digest(token), Date.now()).first();
}

export function renewCustomerCookie(request) {
  return '__Host-session=' + readToken(request) + cookieAttributes + cookieLifetime;
}

export async function revokeSession(db, request) {
  const token = readToken(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token=?').bind(await digest(token)).run();
  return '__Host-session=' + cookieAttributes + '0';
}

