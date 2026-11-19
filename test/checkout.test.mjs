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
  assert.deepEqual(profile,{ email:'shopper@example.test',role:'customer',username:null,...details });
  assert.deepEqual((await (await call(other)).json()).profile,{ email:'other@example.test',role:'customer',username:null,name:null,phone:null,address:null,lat:null,lon:null });
});

test('admin email codes issue staff sessions only for provisioned admin accounts', async () => {
  const DB=localDatabase();
  const origin='https://admin.example.test';
  let code;
  const env={DB,OTP_SECRET:'test-secret',BREVO_API_KEY:'test',BREVO_SENDER:'test@example.test',
    async sendLocalEmail(_url,options) {
      code=JSON.parse(options.body).textContent.match(/\b\d{6}\b/)[0];
      return new Response(null,{status:201});
    }
  };
  const call=(path,data,cookie)=>backend.fetch(new Request(origin+'/api/'+path,{
    method:data ? 'POST' : 'GET',
    headers:{Origin:origin,Cookie:cookie?.split(';')[0] ?? ''},
    body:data && JSON.stringify(data)
  }),env);
  const email='staff@example.test';
  assert.equal((await call('auth/otp/request',{email:'shopper@example.test',mode:'admin'})).status,400);
  assert.equal((await call('auth/otp/request',{email,mode:'login'})).status,400);
  assert.equal(code,undefined);
  assert.equal((await call('auth/otp/request',{email,mode:'admin'})).status,200);
  const verified=await call('auth/otp/verify',{email,code,mode:'admin'});
  assert.equal(verified.status,200);
  const cookie=verified.headers.get('Set-Cookie');
  assert.match(cookie,/Max-Age=604800$/);
  assert.equal((await call('auth/otp/verify',{email,code,mode:'admin'})).status,401);
  assert.equal((await (await call('profile',null,cookie)).json()).profile.role,'admin');
  assert.equal((await call('admin/catalog',null,cookie)).status,200);
  assert.equal((await call('auth/logout',{},cookie)).status,200);
  assert.equal((await call('admin/catalog',null,cookie)).status,401);
});

test('admin sets password once via email verification, then logs in directly with email and password', async () => {
  const DB=localDatabase();
  const origin='https://admin.example.test';
  let code;
  const env={DB,OTP_SECRET:'test-secret',BREVO_API_KEY:'test',BREVO_SENDER:'test@example.test',
    async sendLocalEmail(_url,options) {
      code=JSON.parse(options.body).textContent.match(/\b\d{6}\b/)[0];
      return new Response(null,{status:201});
    }
  };
  const call=(path,data,cookie)=>backend.fetch(new Request(origin+'/api/'+path,{
    method:data ? 'POST' : 'GET',
    headers:{Origin:origin,Cookie:cookie?.split(';')[0] ?? ''},
    body:data && JSON.stringify(data)
  }),env);
  const email='staff@example.test';

  // 1. Direct password login before setting password fails with needsSetup: true
  const initialLogin = await call('auth/admin/login',{email,password:'MyAdminPass123!'});
  assert.equal(initialLogin.status,400);
  const initialJson = await initialLogin.json();
  assert.equal(initialJson.needsSetup,true);

  // 2. Initial setup: verify email with OTP and set new password
  assert.equal((await call('auth/otp/request',{email,mode:'admin'})).status,200);
  assert.ok(code);
  const setupRes = await call('auth/otp/verify',{email,code,mode:'admin',password:'MyAdminPass123!'});
  assert.equal(setupRes.status,200);
  const setupCookie = setupRes.headers.get('Set-Cookie');
  assert.ok(setupCookie);

  // 3. Daily login: Admin logs in with Email + Password directly (no email OTP needed!)
  const pwdLogin = await call('auth/admin/login',{email,password:'MyAdminPass123!'});
  assert.equal(pwdLogin.status,200);
  const adminCookie = pwdLogin.headers.get('Set-Cookie');
  assert.ok(adminCookie);

  // 4. Verify admin access works with the session from password login
  assert.equal((await call('admin/catalog',null,adminCookie)).status,200);

  // 5. Wrong password fails
  assert.equal((await call('auth/admin/login',{email,password:'WrongPassword!'})).status,401);

  // 6. Non-admin email fails
  assert.equal((await call('auth/admin/login',{email:'shopper@example.test',password:'MyAdminPass123!'})).status,401);

  // 7. Provisioned admin ranjithbellam91901@gmail.com can set password and log in
  let ranjithCode;
  const ranjithEnv = {
    ...env,
    async sendLocalEmail(_url, options) {
      ranjithCode = JSON.parse(options.body).textContent.match(/\b\d{6}\b/)[0];
      return new Response(null, { status: 201 });
    }
  };
  const ranjithCall = (path, data, cookie) => backend.fetch(new Request(origin + '/api/' + path, {
    method: data ? 'POST' : 'GET',
    headers: { Origin: origin, Cookie: cookie?.split(';')[0] ?? '' },
    body: data && JSON.stringify(data)
  }), ranjithEnv);

  assert.equal((await ranjithCall('auth/otp/request', { email: 'ranjithbellam91901@gmail.com', mode: 'admin' })).status, 200);
  assert.ok(ranjithCode);
  const ranjithSetup = await ranjithCall('auth/otp/verify', { email: 'ranjithbellam91901@gmail.com', code: ranjithCode, mode: 'admin', password: 'RanjithPass123!' });
  assert.equal(ranjithSetup.status, 200);

  const ranjithLogin = await ranjithCall('auth/admin/login', { email: 'ranjithbellam91901@gmail.com', password: 'RanjithPass123!' });
  assert.equal(ranjithLogin.status, 200);
  assert.equal((await ranjithCall('admin/catalog', null, ranjithLogin.headers.get('Set-Cookie'))).status, 200);
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
  assert.equal((await call('auth/otp/request',{email,mode:'signup',username:'new_shopper'})).status,200);
  const verify = await call('auth/otp/verify',{email,code,mode:'signup',username:'new_shopper'});
  assert.equal(verify.status,200);
  const cookie = verify.headers.get('Set-Cookie');
  assert.match(cookie,/Secure; HttpOnly; SameSite=Lax/);
  assert.equal((await DB.prepare('SELECT expires FROM sessions WHERE email=?').bind(email).first()).expires,-1);
  assert.equal((await call('auth/otp/verify',{email,code,mode:'signup',username:'new_shopper'})).status,401);
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
  assert.equal(variants.find(product=>product.unit==='500 g').price,2000);
  const kilo=variants.find(product=>product.unit==='1 kg');
  assert.equal(kilo.price,3000);
  assert.equal(kilo.original_price,4000);
  assert.equal(variants.find(product=>product.unit==='250 g').price,1000);
  assert.ok(variants.filter(product=>product.unit!=='1 kg').every(product=>product.original_price===null));
  assert.equal(variants[0].pack_group,variants[1].pack_group);
  const response=await call('/api/orders',{method:'POST',headers:{Origin:origin,Cookie:customer.split(';')[0],'Idempotency-Key':'two-kilos'},
    body:JSON.stringify({lat:17.47,lon:78.48,address:'Test address',phone:'9999999999',slot:'local',items:[{id:kilo.id,quantity:2}],total:8000})});
  assert.equal(response.status,201);
  assert.equal((await response.json()).order.total,8000);
  const editPath='/api/admin/catalog/'+id;
  const editOptions={method:'PUT',headers:{Origin:origin,Cookie:admin.split(';')[0]},body:form};
  form.set('previousStock',JSON.stringify(Object.fromEntries(variants.map(pack=>[pack.id,pack.stock]))));
  form.set('name','Updated Carrot');
  form.set('price','48');
  form.delete('photo');
  form.delete('offer');
  form.set('stock','9');
  assert.equal((await call(editPath,editOptions)).status,409);
  form.set('stock','5');
  assert.equal((await call(editPath,editOptions)).status,200);
  const updated=(await (await call('/api/catalog')).json()).products.filter(pack=>pack.pack_group===id);
  assert.deepEqual(updated.map(pack=>pack.id).sort(),variants.map(pack=>pack.id).sort());
  assert.ok(updated.every(pack=>pack.name==='Updated Carrot' && pack.has_photo && pack.original_price===null));
  assert.equal(updated.find(pack=>pack.id===kilo.id).price,4800);
  assert.equal(updated.find(pack=>pack.id===kilo.id).stock,3);
});
test('admin targets a coupon by username and checkout reserves and releases its budget',async()=>{
  const DB=localDatabase();
  await DB.prepare('UPDATE users SET username=? WHERE email=?').bind('FreshShopper','shopper@example.test').run();
  await DB.prepare("INSERT INTO users(email,role) VALUES (?,'customer')").bind('other@example.test').run();
  const admin=await issueSession(DB,'staff@example.test','admin');
  const shopper=await issueSession(DB,'shopper@example.test');
  const other=await issueSession(DB,'other@example.test');
  const origin='https://shop.example.test';
  const call=(path,cookie,body,key)=>backend.fetch(new Request(origin+'/api/'+path,{
    method:body ? 'POST' : 'GET', headers:{Origin:origin,Cookie:cookie.split(';')[0],...(key && {'Idempotency-Key':key})},
    body:body && JSON.stringify(body)
  }),{DB});
  assert.equal((await call('admin/customers?q=fresh',shopper)).status,403);
  const {customers}=await (await call('admin/customers?q=fresh',admin)).json();
  assert.deepEqual(customers,[{email:'shopper@example.test',username:'FreshShopper'}]);
  assert.equal((await call('admin/coupons',admin,{code:'FRESH10',discount:1000,budget:1000,
    customers:customers.map(customer=>customer.email)})).status,201);
  assert.equal((await call('admin/coupons',admin,{code:'FIRST10',discount:1000,budget:3000,
    customers:null,firstTime:true})).status,201);
  assert.equal((await call('coupons/quote',shopper,{code:'FIRST10',items:[{id:'tomato-1kg',quantity:1}]})).status,200);
  const quote={code:'fresh10',items:[{id:'tomato-1kg',quantity:1}]};
  assert.equal((await call('coupons/quote',other,quote)).status,409);
  assert.deepEqual(await (await call('coupons/quote',shopper,quote)).json(),{code:'FRESH10',discount:1000});
  const order={address:'Test address',phone:'9999999999',lat:17.47,lon:78.48,slot:'local',
    items:[{id:'tomato-1kg',quantity:1}],coupon:'FRESH10',total:4000};
  assert.equal((await call('orders',other,order,'other')).status,409);
  const created=await call('orders',shopper,order,'first');
  assert.equal(created.status,201);
  assert.equal((await call('orders',shopper,{...order,coupon:'FIRST10'},'first-only')).status,409);
  const {order:{id}}=await created.json();
  assert.equal((await call('orders',shopper,order,'first')).status,200);
  assert.equal((await call('orders',shopper,order,'second')).status,409);
  assert.equal((await call('admin/orders/'+id+'/decision',admin,{action:'reject'})).status,200);
  assert.equal((await call('coupons/quote',shopper,{code:'FIRST10',items:[{id:'tomato-1kg',quantity:1}]})).status,200);
  assert.equal((await call('orders',shopper,order,'third')).status,201);
  const setting=threshold=>backend.fetch(new Request(origin+'/api/admin/delivery-offer',{
    method:'PUT',headers:{Origin:origin,Cookie:admin.split(';')[0]},body:JSON.stringify({threshold})
  }),{DB});
  assert.equal((await setting(3000)).status,200);
  const regular={...order,coupon:undefined,total:5000};
  assert.equal((await call('orders',shopper,regular,'at-threshold')).status,201);
  assert.equal((await setting(2900)).status,200);
  assert.equal((await call('orders',shopper,regular,'stale-fee')).status,409);
  const free=await call('orders',shopper,{...regular,total:3000},'free-delivery');
  assert.equal(free.status,201);
  assert.equal((await free.json()).order.total,3000);
});

test('order placement and admin decisions trigger Manankuragayalu invoice emails', async () => {
  const DB = localDatabase();
  const shopper = await issueSession(DB, 'shopper@example.test');
  const admin = await issueSession(DB, 'staff@example.test', 'admin');
  const origin = 'https://shop.example.test';
  const sent = [];
  const env = {
    DB,
    BREVO_API_KEY: 'test',
    BREVO_SENDER: 'manaveg083@gmail.com',
    ADMIN_WHATSAPP: '919398750721',
    async sendLocalEmail(_url, options) {
      sent.push(JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }
  };
  const call = (path, cookie, body, key) => backend.fetch(new Request(origin + '/api/' + path, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie.split(';')[0], ...(key && { 'Idempotency-Key': key }) },
    body: JSON.stringify(body)
  }), env);

  const created = await call('orders', shopper, {
    address: 'Bowenpally Main Rd', phone: '9876543210', lat: 17.47, lon: 78.48,
    slot: 'local', items: [{ id: 'tomato-1kg', quantity: 2 }], total: 8000
  }, 'invoice-order');
  assert.equal(created.status, 201);
  const { order: { id } } = await created.json();

  assert.equal(sent.length, 2);
  const customerMail = sent.find(m => m.to.some(r => r.email === 'shopper@example.test'));
  const adminMail = sent.find(m => m.to.some(r => r.email === 'staff@example.test'));
  assert.ok(customerMail && adminMail);
  assert.equal(customerMail.sender.name, 'Manankuragayalu');
  assert.match(customerMail.subject, /Manankuragayalu Invoice/);
  assert.match(customerMail.textContent, /Tomato \(1 kg\) x 2/);
  assert.match(customerMail.textContent, /9876543210/);
  assert.match(customerMail.textContent, /Total Payable on Delivery: ₹80\.00/);
  assert.match(adminMail.subject, /New Order/);
  assert.match(adminMail.textContent, /Tomato \(1 kg\) x 2/);

  sent.length = 0;
  assert.equal((await call('admin/orders/' + id + '/decision', admin, { action: 'accept' })).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0].email, 'shopper@example.test');
  assert.match(sent[0].subject, /Order Confirmed/);
  assert.match(sent[0].htmlContent, /Manankuragayalu/);
  assert.match(sent[0].htmlContent, /Tomato/);

  sent.length = 0;
  assert.equal((await call('admin/orders/' + id + '/decision', admin, { action: 'deliver' })).status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Order Delivered/);
});
