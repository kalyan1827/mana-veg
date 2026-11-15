import { customerAuth } from './auth.mjs';
import { readSession, revokeSession } from './sessions.mjs';
import { deliveryEligibility } from './delivery.mjs';
import { shopRoutes } from './shop.mjs';

function privateResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/auth/logout' && request.method === 'POST') {
      if (request.headers.get('Origin') !== new URL(request.url).origin) return privateResponse({error:'Invalid origin'},403);
      return privateResponse({ok:true},200,{'Set-Cookie':await revokeSession(env.DB,request)});
    }
    if (path === '/api/auth/otp/request' || path === '/api/auth/otp/verify') return customerAuth(request, env, path, privateResponse);
    if (path === '/api/delivery/check' && request.method === 'POST') {
      const point = await request.json().catch(() => null);
      const dispatch = await env.DB.prepare('SELECT lat,lon FROM settings WHERE id=1').first();
      if (dispatch?.lat == null || dispatch?.lon == null) {
        return privateResponse({ error: 'Delivery location is being set up' }, 503);
      }
      try {
        return privateResponse(deliveryEligibility(dispatch, point));
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return privateResponse({ error: error.message }, 400);
      }
    }
    const shopResponse = await shopRoutes(request, env.DB, path, privateResponse, env.PHOTOS, env.DEMO_CATALOG === true);
    if (shopResponse) return shopResponse;
    if (request.method !== 'GET') return privateResponse({ error: 'Method not allowed' }, 405);
    if (path === '/api/health') return privateResponse({ ok: true });

    const orderId = /^\/api\/orders\/([a-zA-Z0-9-]{1,80})$/.exec(path)?.[1];
    if (path !== '/api/orders' && !orderId) return privateResponse({ error: 'Not found' }, 404);

    const session = await readSession(env.DB, request);
    if (!session) return privateResponse({ error: 'Sign in required' }, 401);
    if (session.role !== 'customer') return privateResponse({ error: 'Customer access required' }, 403);

    const fields = 'id,address,phone,slot_label,items,fee,total,status,collected,created';
    if (orderId) {
      const order = await env.DB.prepare('SELECT ' + fields + ' FROM orders WHERE email=? AND id=?')
        .bind(session.email, orderId).first();
      return order ? privateResponse({ order }) : privateResponse({ error: 'Order not found' }, 404);
    }
    const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return privateResponse({ error: 'Invalid order offset' }, 400);
    const orders = await env.DB.prepare('SELECT ' + fields + ' FROM orders WHERE email=? ORDER BY created DESC,id DESC LIMIT 51 OFFSET ?')
      .bind(session.email,offset).all();
    return privateResponse({ orders: orders.results.slice(0,50), nextOffset: orders.results.length > 50 ? offset + 50 : null });
  }
};

