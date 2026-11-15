import { deliveryEligibility } from './delivery.mjs';
import { readSession, renewCustomerCookie } from './sessions.mjs';

const idPattern = /^[a-zA-Z0-9-]{1,80}$/;
const orderFields = 'id,address,phone,slot_label,items,fee,total,status,collected,created';
const getRows = async statement => (await statement.all()).results;
const catalogTags = new Set(['Regular',"Today's special",'Leafy vegetables','Seasonal','Fruit']);

export async function shopRoutes(request, db, path, reply, photos, demo = false) {
  const method = request.method;
  if (path === '/api/profile' && ['GET','POST'].includes(method)) {
    const session = await readSession(db, request);
    if (!session) return reply({ error: 'Sign in required' }, 401);
    if (method === 'GET') {
      const details = session.role === 'customer' && await db.prepare(
        'SELECT name,phone,address,lat,lon FROM customer_profiles WHERE email=?'
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
    await db.prepare(`INSERT INTO customer_profiles VALUES (?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET
      name=excluded.name,phone=excluded.phone,address=excluded.address,lat=excluded.lat,lon=excluded.lon`)
      .bind(session.email,name,phone,address,lat,lon).run();
    return reply({ profile: { ...session,name,phone,address,lat,lon } });
  }
  const photoId = /^\/api\/photos\/([a-zA-Z0-9-]{1,80})$/.exec(path)?.[1];
  if (photoId && method === 'GET') {
    const product = await db.prepare('SELECT photo FROM products WHERE id=? AND active=1').bind(photoId).first();
    const object = product?.photo && await photos?.get(product.photo);
    return object ? new Response(object.body, { headers: {
      'Content-Type': object.httpMetadata.contentType, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=300'
    } }) : reply({ error: 'Photo not found' }, 404);
  }
  if (path === '/api/catalog' && method === 'GET') {
    const products = await getRows(db.prepare(`SELECT p.id,p.name,p.unit,p.price,p.stock,p.pack_group,p.kilo_price,p.tags,p.original_price,p.photo IS NOT NULL AS has_photo,c.name AS category
      FROM products p JOIN categories c ON c.id=p.category WHERE p.active=1 ORDER BY c.name,p.name LIMIT 250`));
    const slots = await getRows(db.prepare('SELECT id,label FROM slots WHERE cutoff>? AND booked<capacity ORDER BY cutoff LIMIT 30').bind(Date.now()));
    const settings = await db.prepare('SELECT fee FROM settings WHERE id=1').first();
    const categories = await getRows(db.prepare('SELECT name FROM categories ORDER BY name'));
    return reply({ products, categories, slots, fee: settings.fee, demo });
  }
  const admin = path.startsWith('/api/admin/');
  const checkout = path === '/api/orders' && method === 'POST';
  if (!admin && !checkout) return null;
  if (method !== 'GET' && request.headers.get('Origin') !== new URL(request.url).origin) {
    return reply({ error: 'Invalid request origin' }, 403);
  }
  const session = await readSession(db, request);
  if (!session) return reply({ error: 'Sign in required' }, 401);
  if (session.role !== (admin ? 'admin' : 'customer')) return reply({ error: 'Access denied' }, 403);
  if (checkout) return createOrder(request, db, session.email, reply);
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
    const products = await getRows(db.prepare('SELECT id,name,unit,price,stock,pack_group,kilo_price,tags,original_price,photo IS NOT NULL AS has_photo FROM products ORDER BY name,price LIMIT 250'));
    return reply({ categories, products, demo });
  }
  if (path === '/api/admin/catalog' && method === 'POST') {
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
      { unit:'250 g', price:Math.round(effective/4), original:Math.round(input.price/4), stock:Number(form.get('stock250')) },
      ...(form.has('stock500') ? [{ unit:'500 g', price:Math.round(effective/2), original:Math.round(input.price/2), stock:Number(form.get('stock500')) }] : []),
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
    const id = crypto.randomUUID();
    const photo = form?.get('photo');
    const hasPhoto = photo instanceof File && photo.size > 0;
    if (hasPhoto) {
      if (photo.size > 2 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(photo.type)) {
        return reply({ error: 'Choose a JPEG, PNG or WebP image up to 2 MB' }, 400);
      }
      if (!photos) return reply({ error: 'Photo storage is unavailable' }, 503);
      if (!await db.prepare('SELECT id FROM categories WHERE id=?').bind(input.category).first()) return reply({ error: 'Unknown category' }, 400);
      await photos.put(id, await photo.arrayBuffer(), { httpMetadata: { contentType: photo.type } });
    }
    let product;
    try {
      if (byWeight) {
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
      if (hasPhoto && !product) await photos.delete(id);
    }
    return product ? reply({ id }, 201) : reply({ error: 'Unknown category' }, 400);
  }
  return reply({ error: 'Not found' }, 404);
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

  const quantities = new Map();
  for (const line of input.items) {
    if (typeof line?.id !== 'string' || !idPattern.test(line.id) || quantities.has(line.id) ||
        !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50) {
      return reply({ error: 'Invalid cart quantities' }, 400);
    }
    quantities.set(line.id, line.quantity);
  }
  const { lat, lon, slot, total: reviewedTotal } = input;
  const consent = input.consent === true ? 1 : 0;
  const fingerprint = JSON.stringify([address,phone,lat,lon,slot,reviewedTotal,consent,[...quantities].sort()]);
  const existingOrder = () => db.prepare('SELECT id,total,status,fingerprint FROM orders WHERE email=? AND request_key=?').bind(email,key).first();
  const replay = row => row.fingerprint === fingerprint
    ? reply({ order: { id: row.id, total: row.total, status: row.status } })
    : reply({ error: 'This checkout key was used for a different order' }, 409);
  const existing = await existingOrder();
  if (existing) return replay(existing);

  const dispatch = await db.prepare('SELECT lat,lon,fee FROM settings WHERE id=1').first();
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
  const total = items.reduce((sum,item) => sum + item.price * item.quantity, dispatch.fee);
  if (total !== reviewedTotal) return reply({ error: 'The total changed. Refresh your cart.' }, 409);

  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO orders(id,email,request_key,fingerprint,address,phone,lat,lon,distance,
      origin_lat,origin_lon,slot,slot_label,items,fee,total,consent,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,email,key,fingerprint,address,phone,lat,lon,delivery.distanceKm,dispatch.lat,dispatch.lon,
        slot,slotRow.label,JSON.stringify(items),dispatch.fee,total,consent,Date.now()).run();
  } catch (error) {
    const duplicate = await existingOrder();
    if (duplicate) return replay(duplicate);
    if (/settings_changed|slot_unavailable|catalog_changed/.test(String(error))) {
      return reply({ error: 'Availability changed. Refresh your cart and try again.' }, 409);
    }
    throw error;
  }
  return reply({ order: { id, total, status: 'Placed' } }, 201);
}
