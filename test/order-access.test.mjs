import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import backend from '../apps/backend/src/index.mjs';
import { issueSession } from '../apps/backend/src/sessions.mjs';

test('sessions isolate customer orders, even when another order ID is known', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0001_store.sql', import.meta.url), 'utf8'));
  sqlite.exec(`INSERT INTO users(email,role) VALUES ('a@example.test','customer'),('b@example.test','customer'),('staff@example.test','admin');
    UPDATE settings SET lat=17, lon=78;
    INSERT INTO slots VALUES ('morning','Morning',unixepoch()*1000+60000,10,0);
    INSERT INTO orders(id,email,request_key,fingerprint,address,phone,lat,lon,distance,origin_lat,origin_lon,slot,slot_label,items,fee,total,consent,created)
    VALUES ('a-order','a@example.test','key','fingerprint','Private A','1',17,78,0,17,78,'morning','Morning','[]',2000,3000,0,1),
           ('b-order','b@example.test','key','fingerprint','Private B','2',17,78,0,17,78,'morning','Morning','[]',2000,3000,0,1);`);
  const db = { prepare(sql) {
    return { bind(...values) {
      const statement = sqlite.prepare(sql);
      return {
        first: async () => statement.get(...values) ?? null,
        all: async () => ({ results: statement.all(...values) }),
        run: async () => statement.run(...values)
      };
    } };
  } };
  const a = await issueSession(db, 'a@example.test');
  const b = await issueSession(db, 'b@example.test');
  const staff = await issueSession(db, 'staff@example.test', 'admin');
  assert.match(a, /Secure; HttpOnly; SameSite=Lax/);
  const get = (path, cookie) => backend.fetch(new Request('https://shop.example.test' + path, {
    headers: cookie ? { Cookie: cookie.split(';')[0] } : {}
  }), { DB: db });
  assert.equal((await get('/api/orders')).status, 401);
  assert.equal((await get('/api/orders', staff)).status, 403);
  assert.equal((await get('/api/orders/b-order', a)).status, 404);
  assert.equal((await get('/api/orders/a-order', b)).status, 404);
  const response = await get('/api/orders?email=b@example.test', a);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual((await response.json()).orders.map(order => order.id), ['a-order']);
  sqlite.exec('UPDATE sessions SET expires=0');
  assert.equal((await get('/api/orders', a)).status, 401);
  sqlite.close();
});

