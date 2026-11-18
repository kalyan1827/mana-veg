import { deliveryEligibility } from './delivery.mjs';
import { readSession, renewCustomerCookie } from './sessions.mjs';
import { validUsername } from './auth.mjs';

const idPattern = /^[a-zA-Z0-9-]{1,80}$/;
const orderFields = 'id,address,phone,slot_label,items,fee,total,status,collected,created';
const getRows = async statement => (await statement.all()).results;
const couponAudiences = [
  {id:'everyone',label:'Everyone',default:true},
  {id:'selected',label:'Selected customers',requiresCustomers:true},
  {id:'first',label:'First-time users'}
];
const catalogTags = new Set(['Regular',"Today's special",'Leafy vegetables','Seasonal','Fruit']);

export async function shopRoutes(request, db, path, reply, photos, demo = false) {
  const method = request.method;
  if (path === '/api/profile' && ['GET','POST'].includes(method)) {
    const session = await readSession(db, request);
    if (!session) return reply({ error: 'Sign in required' }, 401);
    if (method === 'GET') {
      const details = session.role === 'customer' && await db.prepare(
        'SELECT u.username,p.name,p.phone,p.address,p.lat,p.lon FROM users u LEFT JOIN customer_profiles p ON p.email=u.email WHERE u.email=?'
      ).bind(session.email).first();
      return reply({ profile: { ...session, ...details } },200,
        session.role === 'customer' ? { 'Set-Cookie': renewCustomerCookie(request) } : {});
    }
    if (session.role !== 'customer' || request.headers.get('Origin') !== new URL(request.url).origin) {
      return reply({ error: 'Access denied' }, 403);
    }
    const input = await request.json().catch(() => null);
    const fields = ['name','phone','address'].map(field => typeof input?.[field] === 'string' ? input[field].trim() : '');
    const [name,phone,address] = fields;
    const { lat = null, lon = null } = input ?? {};
    const locationValid = (lat === null && lon === null) ||
      (Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180);
    if (!name || name.length > 100 || (phone && !/^\+?[0-9]{10,15}$/.test(phone)) || address.length > 300 || !locationValid) {
      return reply({ error: 'Check your name, phone and delivery location' }, 400);
    }
    if(input.username !== undefined) {
      if(!validUsername(input.username)) return reply({error:'Enter a valid username'},400);
      const updated=await db.prepare('UPDATE OR IGNORE users SET username=? WHERE email=? RETURNING email').bind(input.username,session.email).first();
      if(!updated) return reply({error:'That username is taken'},409);
    }
    await db.prepare(`INSERT INTO customer_profiles VALUES (?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET
      name=excluded.name,phone=excluded.phone,address=excluded.address,lat=excluded.lat,lon=excluded.lon`)
      .bind(session.email,name,phone,address,lat,lon).run();
    const {username}=await db.prepare('SELECT username FROM users WHERE email=?').bind(session.email).first();
    return reply({ profile: { ...session,username,name,phone,address,lat,lon } });
  }
  const photoId = /^\/api\/photos\/([a-zA-Z0-9-]{1,80})$/.exec(path)?.[1];
  if (photoId && method === 'GET') {
    const product = await db.prepare('SELECT photo FROM products WHERE id=? AND active=1').bind(photoId).first();
    const object = product?.photo && await photos?.get(product.photo);
    return object ? new Response(object.body, { headers: {
      'Content-Type': object.httpMetadata.contentType, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    } }) : reply({ error: 'Photo not found' }, 404);
  }
  if (path === '/api/catalog' && method === 'GET') {
    const products = await getRows(db.prepare(`SELECT p.id,p.name,p.unit,p.price,p.stock,p.pack_group,p.kilo_price,p.tags,p.original_price,p.photo IS NOT NULL AS has_photo,c.name AS category
      FROM products p JOIN categories c ON c.id=p.category WHERE p.active=1 ORDER BY c.name,p.name LIMIT 250`));
    const slots = await getRows(db.prepare('SELECT id,label FROM slots WHERE cutoff>? AND booked<capacity ORDER BY cutoff LIMIT 30').bind(Date.now()));
    const settings = await db.prepare('SELECT fee,free_delivery_threshold FROM settings WHERE id=1').first();
    const categories = await getRows(db.prepare('SELECT name FROM categories ORDER BY name'));
    return reply({ products, categories, slots, fee: settings.fee, freeDeliveryThreshold:settings.free_delivery_threshold, demo });
  }
  const admin = path.startsWith('/api/admin/');
  const checkout = path === '/api/orders' && method === 'POST';
  const quote = path === '/api/coupons/quote' && method === 'POST';
  if (!admin && !checkout && !quote) return null;
  if (method !== 'GET' && request.headers.get('Origin') !== new URL(request.url).origin) {
    return reply({ error: 'Invalid request origin' }, 403);
  }
  const session = await readSession(db, request);
  if (!session) return reply({ error: 'Sign in required' }, 401);
  if (session.role !== (admin ? 'admin' : 'customer')) return reply({ error: 'Access denied' }, 403);
  if (checkout) return createOrder(request, db, session.email, reply);
  if(path==='/api/admin/delivery-offer' && method==='GET') {
    const settings=await db.prepare('SELECT free_delivery_threshold AS threshold FROM settings WHERE id=1').first();
    return reply(settings);
  }
  if(path==='/api/admin/delivery-offer' && method==='PUT') {
    const input=await request.json().catch(()=>null);
    const threshold=input?.threshold;
    if(!Number.isSafeInteger(threshold) || threshold<0 || threshold>10000000000) return reply({error:'Enter a valid free-delivery threshold'},400);
    await db.prepare('UPDATE settings SET free_delivery_threshold=? WHERE id=1').bind(threshold).run();
    return reply({threshold});
  }
  if(quote) {
    const input=await request.json().catch(()=>null);
    const code=normalizeCode(input?.code);
    const items=cartQuantities(input?.items);
    if(!code || !items) return reply({error:'Enter a valid coupon and add items to your cart'},400);
    const totals=await db.prepare(`SELECT COUNT(*) AS matched, SUM(p.price*(line.value->>'quantity')) AS subtotal
      FROM json_each(?) line JOIN products p ON p.id=line.value->>'id'
      WHERE p.active=1 AND p.stock>=line.value->>'quantity'`).bind(JSON.stringify(input.items)).first();
    if(totals.matched!==items.size) return reply({error:'Some products are unavailable. Refresh your cart.'},409);
    const discount=await availableDiscount(db,code,session.email,totals.subtotal);
    return discount ? reply({code,discount}) : reply({error:'This coupon is unavailable for your cart or account'},409);
  }
  if(path==='/api/admin/customers' && method==='GET') {
    const query=(new URL(request.url).searchParams.get('q') ?? '').trim();
    if(query.length<2 || query.length>254) return reply({customers:[]});
    const customers=await getRows(db.prepare(`SELECT email,username FROM users WHERE role='customer'
      AND (instr(lower(email),lower(?))>0 OR instr(lower(username),lower(?))>0)
      ORDER BY username,email LIMIT 20`).bind(query,query));
    return reply({customers});
  }
  if(path==='/api/admin/coupons' && method==='GET') {
    return reply({audiences:couponAudiences,coupons:await getRows(db.prepare(`SELECT c.code,c.discount,c.budget,
      CASE WHEN c.first_time=1 THEN 'first' WHEN c.customers IS NOT NULL THEN 'selected' ELSE 'everyone' END AS audience,
      COALESCE(SUM(o.coupon_discount),0) AS used FROM coupons c LEFT JOIN orders o
      ON o.coupon_code=c.code AND o.status NOT IN ('Rejected','Cancelled')
      GROUP BY c.code ORDER BY c.created DESC LIMIT 100`))});
  }
  if(path==='/api/admin/coupons' && method==='POST') {
    const input=await request.json().catch(()=>null);
    const code=normalizeCode(input?.code);
    const {discount,budget,customers}=input ?? {};
    const audience=input?.audience ?? (input?.firstTime ? 'first' : customers===null ? 'everyone' : 'selected');
    const firstTime=audience==='first';
    if(!code || !Number.isSafeInteger(discount) || discount<1 || !Number.isSafeInteger(budget) ||
      budget<discount || budget>10000000000 || !couponAudiences.some(option=>option.id===audience) ||
      (audience==='selected')!==(customers!==null) || (customers!==null && (!Array.isArray(customers) ||
      !customers.length || customers.length>100 || customers.some(email=>typeof email!=='string' || email.length>254)))) {
      return reply({error:'Enter a code, discount, budget and eligible customers'},400);
    }
    const selected=customers===null ? null : JSON.stringify([...new Set(customers)]);
    const created=await db.prepare(`INSERT INTO coupons(code,discount,budget,customers,created,first_time)
      SELECT ?,?,?,?,?,? WHERE NOT EXISTS (
        SELECT 1 FROM json_each(?) chosen WHERE NOT EXISTS (
          SELECT 1 FROM users WHERE email=chosen.value AND role='customer'
        )
      ) ON CONFLICT DO NOTHING RETURNING code`).bind(code,discount,budget,selected,Date.now(),Number(firstTime),selected).first();
    return created ? reply(created,201) : reply({error:'Code already exists or a selected customer is unavailable'},409);
  }
  if (path === '/api/admin/orders' && method === 'GET') {
    if (new URL(request.url).searchParams.get('today') === '1') {
      const offset = 19800000;
      const start = Math.floor((Date.now() + offset) / 86400000) * 86400000 - offset;
      const end = start + 86400000;
      const counts = await db.prepare(`SELECT COUNT(*) AS total,
        COUNT(CASE WHEN status='Placed' THEN 1 END) AS pending,
        COUNT(CASE WHEN status='Confirmed' THEN 1 END) AS accepted
        FROM orders WHERE created>=? AND created<?`).bind(start,end).first();
      const orders = await getRows(db.prepare('SELECT ' + orderFields +
        " FROM orders WHERE created>=? AND created<? AND status IN ('Placed','Confirmed') ORDER BY created DESC").bind(start,end));
      const delivery = await db.prepare(`SELECT COUNT(*) AS delivered, COALESCE(SUM(total),0) AS earnings
        FROM orders WHERE delivered_at>=? AND delivered_at<? AND status='Delivered'`).bind(start,end).first();
      return reply({ orders, counts: { ...counts, ...delivery } });
    }
    return reply({ orders: await getRows(db.prepare('SELECT ' + orderFields + ' FROM orders ORDER BY created DESC LIMIT 100')) });
  }
  const decisionId = /^\/api\/admin\/orders\/([a-zA-Z0-9-]{1,80})\/decision$/.exec(path)?.[1];
  if (decisionId && method === 'POST') {
    const input = await request.json().catch(() => null);
    if (input?.action === 'deliver') {
      const order = await db.prepare(`UPDATE orders SET status='Delivered', delivered_at=?, decision_actor=?
        WHERE id=? AND status='Confirmed' RETURNING id,status`).bind(Date.now(),session.email,decisionId).first();
      return order ? reply({ order }) : reply({ error: 'Only an accepted booking can be marked delivered' },409);
    }
    if (!['accept','reject'].includes(input?.action)) return reply({ error: 'Choose Accept or Reject' }, 400);
    const status = input.action === 'accept' ? 'Confirmed' : 'Rejected';
    const order = await db.prepare(`UPDATE orders SET status=?, decision_actor=?
      WHERE id=? AND status='Placed' RETURNING id,status`).bind(status,session.email,decisionId).first();
    return order ? reply({ order }) : reply({ error: 'This booking is no longer awaiting a decision' }, 409);
  }
  if (path === '/api/admin/catalog' && method === 'GET') {
    const categories = await getRows(db.prepare('SELECT id,name FROM categories ORDER BY name'));
    const products = await getRows(db.prepare('SELECT id,category,name,unit,price,stock,pack_group,kilo_price,tags,original_price,photo IS NOT NULL AS has_photo FROM products ORDER BY name,price LIMIT 250'));
    return reply({ categories, products, demo });
  }
  const editId = /^\/api\/admin\/catalog\/([a-zA-Z0-9-]{1,80})$/.exec(path)?.[1];
  if ((path === '/api/admin/catalog' && method === 'POST') || (editId && method === 'PUT')) {
    const multipart = request.headers.get('Content-Type')?.startsWith('multipart/form-data');
    const form = multipart ? await request.formData().catch(() => null) : null;
    const input = multipart ? form && {name:form.get('name'), unit:form.get('unit'), category:form.get('category'),
      price:Math.round(Number(form.get('price'))*100), stock:Number(form.get('stock'))} : await request.json().catch(() => null);
    const byWeight = form?.get('pricing') === 'weight';
    const tags = [...new Set(form?.getAll('tags') ?? [])];
    if (tags.some(tag=>!catalogTags.has(tag))) return reply({ error:'Choose valid catalog tags' },400);
    const storedTags = JSON.stringify(tags);
    const discount = form?.has('offer') ? Math.round(Number(form.get('discount'))*100) : 0;
    const effective = input?.price - discount;
    if (form?.has('offer') && (!Number.isSafeInteger(discount) || discount<=0 || effective<(byWeight ? 2 : 1))) {
      return reply({ error:'Enter a discount that leaves a valid selling price' },400);
    }
    const packs = byWeight ? [
      { unit:'250 g', price:Math.round(input.price/4), stock:Number(form.get('stock250')) },
      ...(form.has('stock500') ? [{ unit:'500 g', price:Math.round(input.price/2), stock:Number(form.get('stock500')) }] : []),
      { unit:'1 kg', price:effective, original:input.price, stock:Number(form.get('stock')) }
    ] : [];
    if (byWeight) input.unit = '1 kg';
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const unit = typeof input?.unit === 'string' ? input.unit.trim() : '';
    if (!name || name.length > 100 || !unit || unit.length > 40 ||
        !idPattern.test(input.category ?? '') || !Number.isInteger(input.price) || input.price < 1 ||
        input.price > 10000000 || !Number.isInteger(input.stock) || input.stock < 0 || input.stock > 100000) {
      return reply({ error: 'Enter a valid name, pack size, category, price and stock' }, 400);
    }
    if (byWeight && packs.some(pack=>pack.price<1 || !Number.isInteger(pack.stock) || pack.stock<0 || pack.stock>100000)) {
      return reply({ error:'Enter valid stock for each pack and a price of at least ₹0.02 per kg' },400);
    }
    const id = editId ?? crypto.randomUUID();
    const existing = editId ? await getRows(db.prepare(
      'SELECT id,unit,stock,pack_group FROM products WHERE COALESCE(pack_group,id)=?'
    ).bind(editId)) : [];
    if(editId && !existing.length) return reply({error:'Product not found'},404);
    if(editId && Boolean(existing[0].pack_group)!==byWeight) return reply({error:'Pricing method cannot be changed on a published product'},400);
    if(editId && byWeight && existing.some(row=>!packs.some(pack=>pack.unit===row.unit))) return reply({error:'Include all existing pack sizes'},400);
    const photoKey = editId ? crypto.randomUUID() : id;
    const photo = form?.get('photo');
    const hasPhoto = photo instanceof File && photo.size > 0;
    if (hasPhoto) {
      if (photo.size > 2 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(photo.type)) {
        return reply({ error: 'Choose a JPEG, PNG or WebP image up to 2 MB' }, 400);
      }
      if (!photos) return reply({ error: 'Photo storage is unavailable' }, 503);
      if (!await db.prepare('SELECT id FROM categories WHERE id=?').bind(input.category).first()) return reply({ error: 'Unknown category' }, 400);
      await photos.put(photoKey, await photo.arrayBuffer(), { httpMetadata: { contentType: photo.type } });
    }
    let product;
    try {
      if (editId) {
        let previous;
        try { previous = JSON.parse(form?.get('previousStock') || '{}'); }
        catch { return reply({error:'Invalid stock snapshot'},400); }
        const updates = existing.map(row=>{
          const pack=byWeight ? packs.find(option=>option.unit===row.unit) : {unit,price:effective,original:input.price,stock:input.stock};
          return { ...pack,id:row.id,expected:previous?.[row.id],
            original:pack.original>pack.price ? pack.original : null };
        });
        if(updates.some(pack=>!Number.isInteger(pack.expected))) return reply({error:'Reload the product before editing'},409);
        product = await db.prepare(`WITH updates AS (
          SELECT value AS pack FROM json_each(?)
        ) UPDATE products AS p SET
          name=?,category=?,unit=u.pack->>'unit',price=u.pack->>'price',
          stock=CASE WHEN (u.pack->>'stock')=(u.pack->>'expected') THEN p.stock ELSE u.pack->>'stock' END,
          original_price=u.pack->>'original',kilo_price=?,tags=?,photo=COALESCE(?,p.photo)
        FROM updates u WHERE p.id=u.pack->>'id'
          AND EXISTS (SELECT 1 FROM categories WHERE id=?)
          AND NOT EXISTS (
            SELECT 1 FROM updates v JOIN products current ON current.id=v.pack->>'id'
            WHERE (v.pack->>'stock')<>(v.pack->>'expected') AND current.stock<>(v.pack->>'expected')
          ) RETURNING id`)
          .bind(JSON.stringify(updates),name,input.category,byWeight ? effective : null,storedTags,
            hasPhoto ? photoKey : null,input.category).first();
      } else if (byWeight) {
        const variants = packs.map((pack,index)=>({ ...pack,id:index===0 ? id : crypto.randomUUID() }));
        product = await db.prepare(`INSERT INTO products(id,category,name,unit,price,stock,active,photo,pack_group,kilo_price,tags,original_price)
          SELECT value->>'id',categories.id,?,value->>'unit',value->>'price',value->>'stock',1,?,?,?,?,
            CASE WHEN (value->>'original')>(value->>'price') THEN value->>'original' END
          FROM categories,json_each(?) WHERE categories.id=? RETURNING id`)
          .bind(name,hasPhoto ? id : null,id,effective,storedTags,JSON.stringify(variants),input.category).first();
      } else product = await db.prepare(`INSERT INTO products(id,category,name,unit,price,stock,active,photo,tags,original_price)
        SELECT ?,id,?,?,?,?,1,?,?,? FROM categories WHERE id=? RETURNING id`)
        .bind(id,name,unit,effective,input.stock,hasPhoto ? id : null,storedTags,discount ? input.price : null,input.category).first();
    } finally {
      if (hasPhoto && !product) await photos.delete(photoKey);
    }
    return product ? reply({ id }, editId ? 200 : 201) :
      editId ? reply({error:'Stock or category changed. Reload the catalog and try again.'},409) : reply({error:'Unknown category'},400);
  }
  return reply({ error: 'Not found' }, 404);
}

function normalizeCode(value) {
  const code=typeof value==='string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9-]{3,32}$/.test(code) ? code : null;
}

async function availableDiscount(db,code,email,subtotal) {
  const coupon=await db.prepare(`SELECT c.discount FROM coupons c WHERE c.code=? AND c.discount<=?
    AND (c.first_time=0 OR NOT EXISTS (SELECT 1 FROM orders WHERE email=? AND status NOT IN ('Rejected','Cancelled')))
    AND (c.customers IS NULL OR EXISTS (SELECT 1 FROM json_each(c.customers) WHERE value=?))
    AND c.budget>=c.discount+COALESCE((SELECT SUM(o.coupon_discount) FROM orders o
      WHERE o.coupon_code=c.code AND o.status NOT IN ('Rejected','Cancelled')),0)
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.coupon_code=c.code AND o.email=?
      AND o.status NOT IN ('Rejected','Cancelled'))`).bind(code,subtotal,email,email,email).first();
  return coupon?.discount ?? 0;
}

function cartQuantities(items) {
  if(!Array.isArray(items) || !items.length || items.length>30) return null;
  const quantities=new Map();
  for(const line of items) {
    if(typeof line?.id!=='string' || !idPattern.test(line.id) || quantities.has(line.id) ||
      !Number.isInteger(line.quantity) || line.quantity<1 || line.quantity>50) return null;
    quantities.set(line.id,line.quantity);
  }
  return quantities;
}

async function createOrder(request, db, email, reply) {
  const input = await request.json().catch(() => null);
  const key = request.headers.get('Idempotency-Key');
  const address = typeof input?.address === 'string' ? input.address.trim() : '';
  const phone = typeof input?.phone === 'string' ? input.phone.trim() : '';
  if (!idPattern.test(key ?? '') || !address || address.length > 300 ||
      !/^\+?[0-9]{10,15}$/.test(phone) || typeof input?.slot !== 'string' || !idPattern.test(input.slot) ||
      !Array.isArray(input.items) || !input.items.length || input.items.length > 30 ||
      !Number.isSafeInteger(input.total) || input.total < 0) return reply({ error: 'Invalid checkout details' }, 400);

  const quantities=cartQuantities(input.items);
  if(!quantities) return reply({error:'Invalid cart quantities'},400);
  const { lat, lon, slot, total: reviewedTotal } = input;
  const consent = input.consent === true ? 1 : 0;
  const code=normalizeCode(input.coupon);
  if(input.coupon && !code) return reply({error:'Invalid coupon code'},400);
  const fingerprint = JSON.stringify([address,phone,lat,lon,slot,reviewedTotal,consent,[...quantities].sort(),...(code ? [code] : [])]);
  const existingOrder = () => db.prepare('SELECT id,total,status,fingerprint FROM orders WHERE email=? AND request_key=?').bind(email,key).first();
  const replay = row => row.fingerprint === fingerprint
    ? reply({ order: { id: row.id, total: row.total, status: row.status } })
    : reply({ error: 'This checkout key was used for a different order' }, 409);
  const existing = await existingOrder();
  if (existing) return replay(existing);

  const dispatch = await db.prepare('SELECT lat,lon,fee,free_delivery_threshold FROM settings WHERE id=1').first();
  if (dispatch?.lat == null || dispatch?.lon == null) return reply({ error: 'Delivery location is being set up' }, 503);
  let delivery;
  try {
    delivery = deliveryEligibility(dispatch,{ lat, lon });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return reply({ error: error.message }, 400);
  }
  if (!delivery.eligible) return reply({ error: 'This address is outside the delivery area' }, 422);
  const slotRow = await db.prepare('SELECT label FROM slots WHERE id=? AND booked<capacity AND cutoff>?').bind(slot,Date.now()).first();
  if (!slotRow) return reply({ error: 'Delivery slot is unavailable' }, 409);
  const ids = [...quantities.keys()];
  const products = await getRows(db.prepare('SELECT id,name,unit,price,stock FROM products WHERE active=1 AND id IN (' +
    ids.map(() => '?').join(',') + ')').bind(...ids));
  if (products.length !== ids.length || products.some(product => product.stock < quantities.get(product.id))) {
    return reply({ error: 'Some products are unavailable. Refresh your cart.' }, 409);
  }
  const items = products.map(({ id,name,unit,price }) => ({ id,name,unit,price,quantity: quantities.get(id) }));
  const subtotal = items.reduce((sum,item) => sum + item.price * item.quantity, 0);
  const discount=code ? await availableDiscount(db,code,email,subtotal) : 0;
  if(code && !discount) return reply({error:'This coupon is unavailable for your cart or account'},409);
  const netSubtotal=subtotal-discount;
  const fee=netSubtotal>dispatch.free_delivery_threshold ? 0 : dispatch.fee;
  const total = netSubtotal + fee;
  if (total !== reviewedTotal) return reply({ error: 'The total changed. Refresh your cart.' }, 409);

  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO orders(id,email,request_key,fingerprint,address,phone,lat,lon,distance,
      origin_lat,origin_lon,slot,slot_label,items,fee,total,consent,created,coupon_code,coupon_discount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,email,key,fingerprint,address,phone,lat,lon,delivery.distanceKm,dispatch.lat,dispatch.lon,
        slot,slotRow.label,JSON.stringify(items),fee,total,consent,Date.now(),code,discount).run();
  } catch (error) {
    const duplicate = await existingOrder();
    if (duplicate) return replay(duplicate);
    if(String(error).includes('coupon_unavailable')) return reply({error:'This coupon is no longer available'},409);
    if (/settings_changed|slot_unavailable|catalog_changed/.test(String(error))) {
      return reply({ error: 'Availability changed. Refresh your cart and try again.' }, 409);
    }
    throw error;
  }
  return reply({ order: { id, total, status: 'Placed' } }, 201);
}
