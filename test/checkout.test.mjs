import test from 'node:test';
import assert from 'node:assert/strict';
import backend from '../apps/backend/src/index.mjs';
import { issueSession } from '../apps/backend/src/sessions.mjs';
import { localDatabase } from '../scripts/local-db.mjs';

test('admin publishes a pack and checkout reserves the last unit only once',async()=>{
  const DB=localDatabase();
  const customer=await issueSession(DB,'shopper@example.test');
  const admin=await issueSession(DB,'staff@example.test','admin');
  const origin='https://shop.example.test';
  const fetch=(path,cookie,data,key)=>backend.fetch(new Request(origin+path,{
    method:data ? 'POST' : 'GET',
    headers:{Origin:origin,Cookie:cookie?.split(';')[0] ?? '',...(key && {'Idempotency-Key':key})},
    body:data && JSON.stringify(data)
  }),{DB});
  assert.equal((await fetch('/api/admin/catalog',customer)).status,403);
  const publish=await fetch('/api/admin/catalog',admin,{name:'Carrot',unit:'500 g',category:'vegetables',price:4000,stock:1});
  assert.equal(publish.status,201);
  const {id}=await publish.json();
  const catalog=await (await fetch('/api/catalog')).json();
  assert.ok(catalog.products.some(product=>product.id===id));
  const payload={lat:17.47,lon:78.48,address:'Test address',phone:'9999999999',slot:'local',items:[{id,quantity:1}],total:6000};
  assert.equal((await (await fetch('/api/delivery/check',null,{lat:payload.lat,lon:payload.lon})).json()).eligible,true);
  assert.equal((await (await fetch('/api/delivery/check',null,{lat:20,lon:payload.lon})).json()).eligible,false);
  assert.equal((await fetch('/api/orders',null,payload,'guest')).status,401);
  assert.equal((await fetch('/api/orders',customer,{...payload,lat:20},'far')).status,422);
  const attempts=await Promise.all(['order-a','order-b'].map(key=>fetch('/api/orders',customer,payload,key)));
  assert.deepEqual(attempts.map(result=>result.status).sort(),[201,409]);
  const winner=attempts.findIndex(result=>result.status===201);
  const order=await attempts[winner].json();
  const replay=await fetch('/api/orders',customer,payload,['order-a','order-b'][winner]);
  assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),order);
  const adminOrders=await (await fetch('/api/admin/orders',admin)).json();
  assert.deepEqual(adminOrders.orders.map(row=>row.id),[order.order.id]);
  assert.equal((await DB.prepare('SELECT stock FROM products WHERE id=?').bind(id).first()).stock,0);
  assert.equal((await DB.prepare('SELECT booked FROM slots WHERE id=?').bind('local').first()).booked,1);
  const today = await (await fetch('/api/admin/orders?today=1',admin)).json();
  assert.equal(today.orders.length,1);
  assert.deepEqual(today.counts,{total:1,pending:1,accepted:0,delivered:0,earnings:0});
  const decision = '/api/admin/orders/'+order.order.id+'/decision';
  assert.equal((await fetch(decision,customer,{action:'reject'})).status,403);
  assert.equal((await fetch(decision,admin,{action:'reject'})).status,200);
  assert.equal((await fetch(decision,admin,{action:'accept'})).status,409);
  assert.equal((await DB.prepare('SELECT stock FROM products WHERE id=?').bind(id).first()).stock,1);
  assert.equal((await DB.prepare('SELECT booked FROM slots WHERE id=?').bind('local').first()).booked,0);
  const replacement = await fetch('/api/orders',customer,payload,'replacement');
  const accepted = (await replacement.json()).order;
  assert.equal((await fetch('/api/admin/orders/'+accepted.id+'/decision',admin,{action:'accept'})).status,200);
  assert.equal((await fetch('/api/orders/'+accepted.id,customer)).status,200);
  assert.equal((await DB.prepare('SELECT status FROM orders WHERE id=?').bind(accepted.id).first()).status,'Confirmed');
  const beforeDelivery=await (await fetch('/api/admin/orders?today=1',admin)).json();
  assert.deepEqual(beforeDelivery.counts,{total:2,pending:0,accepted:1,delivered:0,earnings:0});
  const deliveryPath='/api/admin/orders/'+accepted.id+'/decision';
  await DB.prepare('UPDATE orders SET created=created-86400000 WHERE id=?').bind(accepted.id).run();
  assert.equal((await fetch(deliveryPath,customer,{action:'deliver'})).status,403);
  assert.equal((await fetch(deliveryPath,admin,{action:'deliver'})).status,200);
  assert.equal((await fetch(deliveryPath,admin,{action:'deliver'})).status,409);
  const {counts}=await (await fetch('/api/admin/orders?today=1',admin)).json();
  assert.deepEqual(counts,{total:1,pending:0,accepted:0,delivered:1,earnings:6000});
  const customerOrder=await (await fetch('/api/orders/'+accepted.id,customer)).json();
  assert.equal(customerOrder.order.status,'Delivered');
});

test('customer profile fields are saved only for the signed-in account', async () => {
  const DB = localDatabase();
  await DB.prepare("INSERT INTO users(email,role) VALUES (?,'customer')").bind('other@example.test').run();
  const origin = 'https://shop.example.test';
  const shopper = await issueSession(DB,'shopper@example.test');
  const other = await issueSession(DB,'other@example.test');
  const call = (cookie, data) => backend.fetch(new Request(origin+'/api/profile',{
    method: data ? 'POST' : 'GET',
    headers: { Origin: origin, Cookie: cookie.split(';')[0] },
    body: data && JSON.stringify(data)
  }),{ DB });
  const details = { name:'Sample Customer',phone:'9999999999',address:'Sample address',lat:17.47,lon:78.48 };
  assert.equal((await call(shopper,{...details,lat:91})).status,400);
  assert.equal((await call(shopper,{...details,email:'other@example.test'})).status,200);
  const { profile } = await (await call(shopper)).json();
  assert.deepEqual(profile,{ email:'shopper@example.test',role:'customer',...details });
  assert.deepEqual((await (await call(other)).json()).profile,{ email:'other@example.test',role:'customer' });
});

test('email signup issues a persistent customer session and logout revokes it', async () => {
  const DB = localDatabase();
  const email = 'new@example.test';
  const origin = 'https://shop.example.test';
  let code;
  const env = { DB, OTP_SECRET:'test-secret', BREVO_API_KEY:'test', BREVO_SENDER:'test@example.test',
    async sendLocalEmail(_url, options) {
      code = JSON.parse(options.body).textContent.match(/\b\d{6}\b/)[0];
      return new Response(null,{status:201});
    }
  };
  const call = (path, data, cookie) => backend.fetch(new Request(origin+'/api/'+path,{
    method: data ? 'POST' : 'GET',
    headers: { Origin:origin, Cookie:cookie?.split(';')[0] ?? '' },
    body: data && JSON.stringify(data)
  }),env);
  const unknownLogin = await call('auth/otp/request',{email,mode:'login'});
  assert.equal(unknownLogin.status,400);
  assert.match((await unknownLogin.json()).error,/Create an account/);
  assert.equal(code,undefined);
  assert.equal((await call('auth/otp/request',{email,mode:'signup'})).status,200);
  const verify = await call('auth/otp/verify',{email,code,mode:'signup'});
  assert.equal(verify.status,200);
  const cookie = verify.headers.get('Set-Cookie');
  assert.match(cookie,/Secure; HttpOnly; SameSite=Lax/);
  assert.equal((await DB.prepare('SELECT expires FROM sessions WHERE email=?').bind(email).first()).expires,-1);
  assert.equal((await call('auth/otp/verify',{email,code,mode:'signup'})).status,401);
  const account = await call('profile',null,cookie);
  assert.equal((await account.json()).profile.email,email);
  assert.equal(account.headers.get('Set-Cookie'),cookie);
  assert.match((await call('auth/logout',{},cookie)).headers.get('Set-Cookie'),/Max-Age=0$/);
  assert.equal((await call('profile',null,cookie)).status,401);
  await call('auth/otp/request',{email,mode:'login'});
  assert.equal((await call('auth/otp/verify',{email,code,mode:'login'})).status,200);
});
test('publishing ₹30 per kg creates all three priced variants and checkout charges ₹60 for two kilos', async () => {
  const DB=localDatabase();
  const origin='https://shop.example.test';
  const customer=await issueSession(DB,'shopper@example.test');
  const admin=await issueSession(DB,'staff@example.test','admin');
  const form=new FormData();
  for(const [key,value] of Object.entries({name:'Carrot',category:'vegetables',pricing:'weight',price:'40',offer:'on',discount:'10',stock:'5',stock250:'10',stock500:'8'})) form.set(key,value);
  form.append('tags',"Today's special");
  form.append('tags','Seasonal');
  form.set('photo',new File([new Uint8Array([255,216,255,217])],'carrot.jpg',{type:'image/jpeg'}));
  const images=new Map();
  const PHOTOS={
    async put(key,body,{httpMetadata}) { images.set(key,{body,httpMetadata}); },
    async get(key) { return images.get(key); },
    async delete(key) { images.delete(key); }
  };
  const call=(path,options={})=>backend.fetch(new Request(origin+path,options),{DB,PHOTOS});
  const published=await call('/api/admin/catalog',{method:'POST',headers:{Origin:origin,Cookie:admin.split(';')[0]},body:form});
  assert.equal(published.status,201);
  const {id}=await published.json();
  const {products}=await (await call('/api/catalog')).json();
  const variants=products.filter(product=>product.pack_group===id);
  assert.equal(variants.length,3);
  for (const variant of variants) {
    assert.equal(variant.has_photo,1);
    assert.deepEqual(JSON.parse(variant.tags),["Today's special",'Seasonal']);
    const photo=await call('/api/photos/'+variant.id);
    assert.equal(photo.status,200);
    assert.equal(photo.headers.get('content-type'),'image/jpeg');
    assert.deepEqual([...new Uint8Array(await photo.arrayBuffer())],[255,216,255,217]);
  }
  assert.equal(variants.find(product=>product.unit==='500 g').price,1500);
  const kilo=variants.find(product=>product.unit==='1 kg');
  assert.equal(kilo.price,3000);
  assert.equal(kilo.original_price,4000);
  assert.equal(variants.find(product=>product.unit==='250 g').price,750);
  assert.equal(variants[0].pack_group,variants[1].pack_group);
  const response=await call('/api/orders',{method:'POST',headers:{Origin:origin,Cookie:customer.split(';')[0],'Idempotency-Key':'two-kilos'},
    body:JSON.stringify({lat:17.47,lon:78.48,address:'Test address',phone:'9999999999',slot:'local',items:[{id:kilo.id,quantity:2}],total:8000})});
  assert.equal(response.status,201);
  assert.equal((await response.json()).order.total,8000);
});

