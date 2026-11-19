const get = id => document.getElementById(id);
const notice = message => { get('notice').textContent = message; };
const money = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);
let signedIn=false;
async function api(path, options) {
  const response = await fetch('/api/'+path,options);
  const result = await response.json();
  if(response.status===401 && signedIn && path.startsWith('admin/')) {
    signedIn=false;
    showAdminPage();
  }
  if (!response.ok) throw new Error(result.error);
  return result;
}
function text(tag,value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}
function whatsappInvoiceUrl(order) {
  const digits = String(order.phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const phone = digits.length === 10 ? '91' + digits : digits;
  const items = JSON.parse(order.items || '[]');
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Number(order.coupon_discount || 0);
  const fee = Number(order.fee || 0);
  const status = { Placed: 'Order Received', Confirmed: 'Order Confirmed', Delivered: 'Order Delivered', Rejected: 'Order Rejected' }[order.status] ?? order.status;
  const lines = [
    '*Manankuragayalu — Order Invoice*',
    `Status: ${status}`,
    `Order ID: #${String(order.id).slice(0, 8).toUpperCase()}`,
    `Delivery Slot: ${order.slot_label}`,
    '',
    '*Ordered Items:*',
    ...items.map(item => `• ${item.name} (${item.unit}) × ${item.quantity} = ${money(item.price * item.quantity)}`),
    '',
    `Subtotal: ${money(subtotal)}`,
    ...(discount > 0 ? [`Coupon (${order.coupon_code || 'DISCOUNT'}): -${money(discount)}`] : []),
    `Delivery Fee: ${fee === 0 ? 'FREE' : money(fee)}`,
    `*Total Payable on Delivery: ${money(order.total)}*`,
    '',
    `Address: ${order.address}`,
    'Thank you for ordering from Manankuragayalu!'
  ];
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(lines.join('\n'));
}
function bookingCard(order) {
  const card = text('article','');
  card.className = 'card';
  const status = {Placed:'Pending',Confirmed:'Accepted'}[order.status] ?? order.status;
  card.append(text('strong',status+' · '+money(order.total)),text('p',order.id),
    text('p',order.address+' · '+order.phone),text('p',order.slot_label),
    text('p',JSON.parse(order.items).map(item=>item.name+' × '+item.quantity).join(', ')));
  const controls = text('div','');
  controls.className = 'actions';
  if (['Placed','Confirmed'].includes(order.status)) {
    const actions = order.status === 'Placed' ? [['accept','Accept'],['reject','Reject']] : [['deliver','Mark delivered']];
    for (const [action,label] of actions) {
      const button = text('button',label);
      button.onclick = async () => {
        if (action === 'reject' && !window.confirm('Reject this booking and release its stock?')) return;
        for (const control of controls.querySelectorAll('button')) control.disabled = true;
        try {
          await api('admin/orders/'+order.id+'/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
          await loadBookings();
        } catch (error) { notice(error.message); }
        finally { for (const control of controls.querySelectorAll('button')) control.disabled = false; }
      };
      controls.append(button);
    }
  }
  const waUrl = whatsappInvoiceUrl(order);
  if (waUrl) {
    const link = text('a','WhatsApp Invoice');
    link.href = waUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'wa-invoice-btn';
    controls.append(link);
  }
  if (controls.childElementCount) card.append(controls);
  return card;
}
let bookingRequest = 0;
const renderedBookings = new Map();
async function loadBookings() {
  const request = ++bookingRequest;
  const [today, all] = await Promise.all([api('admin/orders?today=1'),api('admin/orders')]);
  if (request !== bookingRequest) return;
  const lists = [
    ['pending-orders', all.orders.filter(order=>order.status==='Placed'), 'No pending bookings.'],
    ['accepted-orders', all.orders.filter(order=>order.status==='Confirmed'), 'No accepted bookings.'],
    ['delivered-orders', all.orders.filter(order=>order.status==='Delivered'), 'No delivered bookings.'],
    ['orders', all.orders.filter(order=>!['Placed','Confirmed','Delivered'].includes(order.status)), 'No other bookings.']
  ];
  for (const [id,orders,empty] of lists) {
    const snapshot = JSON.stringify(orders);
    if (renderedBookings.get(id) === snapshot) continue;
    get(id).replaceChildren(...(orders.length ? orders.map(bookingCard) : [text('p',empty)]));
    renderedBookings.set(id,snapshot);
  }
  const {total,pending,accepted,delivered,earnings}=today.counts;
  get('stat-total').textContent=total;
  get('stat-pending').textContent=pending;
  get('stat-accepted').textContent=accepted;
  get('stat-delivered').textContent=Number.isFinite(delivered) ? delivered : 0;
  get('stat-revenue').textContent=money(Number.isFinite(earnings) ? earnings : 0);
  const dateEl=get('dashboard-date');
  if (dateEl) dateEl.textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'});
  const activeSnap=JSON.stringify(today.orders);
  if (renderedBookings.get('dashboard-active') !== activeSnap) {
    get('dashboard-active').replaceChildren(...(today.orders.length ? today.orders.slice(0,8).map(bookingCard) : [text('p','All caught up — no pending or accepted bookings right now.')]));
    renderedBookings.set('dashboard-active',activeSnap);
  }
}
async function loadCatalog() {
  const {categories,products,demo} = await api('admin/catalog');
  get('catalog-mode').hidden = !demo;
  const picker=get('category-picker');
  const current=get('category-current');
  const categoryInput=publishForm.elements.category;
  function selectCategory(category) {
    categoryInput.value=category?.id ?? '';
    current.textContent=category?.name ?? 'No categories available';
    picker.open=false;
  }
  get('categories').replaceChildren(...categories.map(category=>{
    const option=text('button',category.name);
    option.type='button';
    option.onclick=()=>{selectCategory(category); current.focus();};
    return option;
  }));
  selectCategory(categories.find(category=>category.id===categoryInput.value) ??
    categories.find(category=>category.name.toLowerCase()==='vegetables') ?? categories[0]);
  const groups = new Map();
  for (const product of products) {
    const key = product.pack_group ?? product.id;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(product);
  }
  const stockBox=get('dashboard-stock');
  if (stockBox) {
    const outOfStock=products.filter(p=>p.stock===0);
    const lowStock=products.filter(p=>p.stock>0 && p.stock<=5);
    const summary=text('div','');
    summary.className='stock-summary';
    for (const [label,val,cls] of [
      ['Products',groups.size,''],
      ['Total packs',products.length,''],
      ['Low stock (≤5)',lowStock.length,lowStock.length ? 'warn' : ''],
      ['Out of stock',outOfStock.length,outOfStock.length ? 'danger' : '']
    ]) {
      const box=text('div','');
      if (cls) box.className=cls;
      box.append(text('strong',String(val)),text('span',label));
      summary.append(box);
    }
    const alerts=[...outOfStock,...lowStock].slice(0,6);
    if (alerts.length) {
      const list=text('ul','');
      list.className='stock-alerts';
      for (const item of alerts) {
        list.append(text('li',`${item.name} (${item.unit}) — ${item.stock===0 ? 'Out of stock' : item.stock+' left'}`));
      }
      stockBox.replaceChildren(summary,list);
    } else {
      const ok=text('p','All catalog packs are well stocked.');
      ok.className='stock-ok';
      stockBox.replaceChildren(summary,ok);
    }
  }
  get('products').replaceChildren(...[...groups.values()].map(packs=>{
    const [product] = packs;
    const card = text('article','');
    card.className='card';
    const media = text('div','');
    media.className='catalog-photo';
const staticProducePhotos=new Set([
  'aalu','beans','beetroot','bendakaya','black-mirchi','black-vankaya',
  'cabbage','capsicum','carrot','cauliflower','chamagada','chikudukaya',
  'dondakaya','kira','munakaya','onion','podugu-vankaya','sweet-potato',
  'tomato','white-mirchi','white-vankaya'
]);
function adminPhotoUrl(product) {
  const photo = typeof product === 'object' ? (product.photo || product.id) : product;
  const slug = String(photo).replace(/-(?:250g|500g|1kg)$/, '').toLowerCase();
  if (staticProducePhotos.has(slug)) return '/photos/' + slug + '.jpg';
  const id = typeof product === 'object' ? product.id : product;
  return '/api/photos/' + encodeURIComponent(id);
}
    if (product.has_photo) {
      const image = document.createElement('img');
      image.src = adminPhotoUrl(product);
      image.alt = product.name;
      image.onerror = () => {
        if (!image.dataset.retried) {
          image.dataset.retried = '1';
          image.src = '/api/photos/' + encodeURIComponent(product.id);
        }
      };
      media.append(image);
    }
    const tags=JSON.parse(product.tags ?? '[]');
    if(tags.length) {
      const badges=text('div','');
      badges.className='catalog-photo-tags';
      for(const tag of tags) {
        const badge=text('span',tag);
        if(tag==="Today's special") badge.className='catalog-special';
        badges.append(badge);
      }
      media.append(badges);
    }
    if(media.hasChildNodes()) card.append(media);
    card.append(text('h3',product.name));
    if (packs.some(pack=>pack.original_price>pack.price)) {
      const offer=text('span','Offer');
      offer.className='catalog-offer';
      card.append(offer);
    }
    for (const pack of packs) {
      const row=text('p',pack.unit+' · ');
      if (pack.original_price>pack.price) {
        const original=text('s',money(pack.original_price));
        original.className='catalog-original-price';
        row.append(original, ' ');
      }
      row.append(text('strong',money(pack.price)));
      card.append(row);
    }
    const edit=text('button','Edit product');
    edit.type='button';
    edit.onclick=()=>{
      const fields=publishForm.elements;
      publishForm.reset();
      editing={id:product.pack_group ?? product.id,photo:product.has_photo ? '/api/photos/'+product.id : '',
        previousStock:Object.fromEntries(packs.map(pack=>[pack.id,pack.stock]))};
      const base=packs.find(pack=>pack.unit==='1 kg') ?? product;
      fields.name.value=product.name;
      selectCategory(categories.find(category=>category.id===product.category));
      fields.pricing.value=product.pack_group ? 'weight' : 'fixed';
      fields.unit.value=base.unit;
      fields.price.value=(base.original_price ?? base.price)/100;
      fields.stock.value=base.stock;
      fields.stock250.value=packs.find(pack=>pack.unit==='250 g')?.stock ?? 0;
      fields.stock500.value=packs.find(pack=>pack.unit==='500 g')?.stock ?? 0;
      fields.offer.checked=base.original_price>base.price;
      fields.discount.value=fields.offer.checked ? (base.original_price-base.price)/100 : '';
      const tags=JSON.parse(product.tags ?? '[]');
      for(const checkbox of publishForm.querySelectorAll('[name="tags"]')) checkbox.checked=tags.includes(checkbox.value);
      get('publish-action').textContent='Save and publish';
      get('cancel-edit').hidden=false;
      previewPricing();
      previewPhoto();
      fields.name.focus();
    };
    card.append(edit);
    return card;
  }));
}
const publishForm = get('publish');
let editing;
function resetPublishForm() {
  editing=undefined;
  publishForm.reset();
  get('publish-action').textContent='Publish vegetable';
  get('cancel-edit').hidden=true;
  previewPhoto();
  previewPricing();
}
get('cancel-edit').onclick=()=>{
  resetPublishForm();
  loadCatalog().catch(error=>notice(error.message));
};
function previewPricing() {
  const {pricing,unit,price,stock250,stock500,offer,discount} = publishForm.elements;
  const byWeight = pricing.value === 'weight';
  get('pricing-picker').hidden=Boolean(editing);
  get('pricing-current').textContent = byWeight ? 'By kilogram' : 'Fixed pack';
  get('fixed-unit').hidden = byWeight;
  get('quarter-stock').hidden = !byWeight;
  get('half-stock').hidden = !byWeight;
  unit.required = !byWeight;
  stock250.required = byWeight;
  stock500.required = byWeight;
  get('price-caption').textContent = byWeight ? 'Price per kg (₹)' : 'Price per pack (₹)';
  get('stock-label').textContent = byWeight ? '1 kg packs in stock' : 'Packs in stock';
  get('discount-field').hidden=!offer.checked;
  discount.disabled=!offer.checked;
  discount.required=offer.checked;
  get('discount-caption').textContent=byWeight ? 'Discount on the 1 kg pack (₹)' : 'Discount off each pack (₹)';
  const base=Math.round(Number(price.value)*100);
  const amount=offer.checked ? Math.round(Number(discount.value || NaN)*100) : 0;
  const paise=base-amount;
  const valid=Number.isFinite(amount) && amount>=1 && paise>=(byWeight ? 2 : 1);
  discount.setCustomValidity(offer.checked && Number.isFinite(amount) && !valid ? 'Enter a discount that leaves a valid selling price.' : '');
  get('pack-prices').textContent = paise >= (byWeight ? 2 : 1)
    ? byWeight ? '250 g: '+money(Math.round(base/4))+' · 500 g: '+money(Math.round(base/2))+' · 1 kg: '+money(paise)
      : 'Price per pack: '+money(paise)
    : '';
}
let previewUrl;
function previewPhoto() {
  if(previewUrl) URL.revokeObjectURL(previewUrl);
  const image=get('upload-preview');
  const file=publishForm.elements.photo.files[0];
  image.hidden=!file && !editing?.photo;
  get('upload-caption').textContent=image.hidden ? 'Upload product photo' : 'Change photo';
  previewUrl=file ? URL.createObjectURL(file) : undefined;
  if(previewUrl || editing?.photo) image.src=previewUrl ?? editing.photo;
  else image.removeAttribute('src');
}
publishForm.elements.photo.addEventListener('change',previewPhoto);
get('category-picker').addEventListener('keydown',event=>{
  if(event.key==='Escape') {
    get('category-picker').open=false;
    get('category-current').focus();
  }
});
publishForm.addEventListener('input',previewPricing);
const pricingPicker = get('pricing-picker');
for (const option of pricingPicker.querySelectorAll('[data-pricing]')) {
  option.onclick = () => {
    publishForm.elements.pricing.value = option.dataset.pricing;
    previewPricing();
    pricingPicker.open = false;
    get('pricing-current').focus();
  };
}
pricingPicker.addEventListener('keydown',event=>{
  if(event.key==='Escape') {
    pricingPicker.open=false;
    get('pricing-current').focus();
  }
});
previewPricing();
publishForm.onsubmit=async event=>{
  event.preventDefault();
  event.submitter.disabled=true;
  try {
    const body=new FormData(publishForm);
    const target=editing;
    if(target) body.set('previousStock',JSON.stringify(target.previousStock));
    await api(target ? 'admin/catalog/'+target.id : 'admin/catalog',{method:target ? 'PUT' : 'POST',body});
    resetPublishForm();
    await loadCatalog();
    notice(target ? 'Product updated and published.' : 'Vegetable published.');
  } catch(error) { notice(error.message); }
  finally { event.submitter.disabled=false; }
};
async function refreshVisibleBookings() {
  if (document.hidden || (get('home').hidden && get('bookings').hidden)) return;
  try {
    await loadBookings();
    get('booking-sync').textContent='';
    get('dashboard-sync').textContent='';
  } catch {
    const message='Could not update bookings. Retrying automatically.';
    get('booking-sync').textContent=message;
    get('dashboard-sync').textContent=message;
  }
}


const couponForm=get('coupon-form');
const deliveryOfferForm=get('delivery-offer-form');
async function loadDeliveryOffer() {
  const button=get('save-delivery-offer');
  const status=get('delivery-offer-status');
  button.disabled=true;
  status.textContent='Loading delivery offer…';
  try {
    const {threshold}=await api('admin/delivery-offer');
    deliveryOfferForm.elements.threshold.value=threshold/100;
    status.textContent='Published threshold: '+money(threshold);
    button.disabled=false;
  } catch(error) {
    status.textContent='Could not load the delivery offer. '+error.message;
  }
}
deliveryOfferForm.onsubmit=async event=>{
  event.preventDefault();
  const button=get('save-delivery-offer');
  const status=get('delivery-offer-status');
  button.disabled=true;
  try {
    const threshold=Math.round(Number(deliveryOfferForm.elements.threshold.value)*100);
    const saved=await api('admin/delivery-offer',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({threshold})});
    status.textContent='Published. Free delivery for subtotals above '+money(saved.threshold)+'.';
  } catch(error) {status.textContent=error.message;}
  finally {button.disabled=false;}
};
const selectedCustomers=new Map();
let couponAudiences=[];
function showSelectedCustomers() {
  get('selected-customers').replaceChildren(...[...selectedCustomers].map(([email,label])=>{
    const row=text('li',label+' ');
    const remove=text('button','Remove');
    remove.type='button';
    remove.onclick=()=>{selectedCustomers.delete(email); showSelectedCustomers();};
    row.append(remove);
    return row;
  }));
}
get('coupon-audience').onchange=event=>{
  const selected=event.target;
  if(selected.name!=='audience') return;
  for(const control of couponForm.querySelectorAll('[name="audience"]')) control.checked=control===selected;
  get('coupon-targets').hidden=!couponAudiences.find(option=>option.id===selected.value)?.requiresCustomers;
};
get('find-customers').onclick=async()=>{
  const query=get('customer-search').value.trim();
  if(query.length<2) return notice('Enter at least two characters.');
  try {
    const {customers}=await api('admin/customers?q='+encodeURIComponent(query));
    get('customer-results').replaceChildren(...customers.map(({email,username})=>{
      const label=username ? username+' · '+email : email;
      const option=text('button',label);
      option.type='button';
      option.onclick=()=>{selectedCustomers.set(email,label); showSelectedCustomers();};
      return option;
    }));
    if(!customers.length) get('customer-results').textContent='No matching customers.';
  } catch(error) {notice(error.message);}
};
get('customer-search').onkeydown=event=>{
  if(event.key==='Enter') {event.preventDefault(); get('find-customers').click();}
};
async function loadCoupons() {
  const {coupons,audiences}=await api('admin/coupons');
  if(!Array.isArray(audiences) || !audiences.length) throw new Error('The server returned no audience options.');
  const selected=new FormData(couponForm).get('audience');
  couponAudiences=audiences;
  get('coupon-audience-options').replaceChildren(...audiences.map(option=>{
    const row=text('label','');
    row.className='toggle-row';
    const control=document.createElement('input');
    control.type='checkbox';
    control.name='audience';
    control.value=option.id;
    control.defaultChecked=Boolean(option.default);
    control.checked=selected ? selected===option.id : control.defaultChecked;
    control.setAttribute('role','switch');
    const track=text('span','');
    track.className='toggle-track';
    track.setAttribute('aria-hidden','true');
    row.append(text('span',option.label),control,track);
    return row;
  }));
  get('coupon-list').replaceChildren(...coupons.map(coupon=>text('p',coupon.code+' · '+money(coupon.discount)+' off · '+
    (audiences.find(option=>option.id===coupon.audience)?.label ?? coupon.audience)+' · '+money(coupon.budget-coupon.used)+' remaining')));
  if(!coupons.length) get('coupon-list').textContent='No coupons yet.';
}
couponForm.onsubmit=async event=>{
  event.preventDefault();
  const button=get('publish-coupon');
  const status=get('coupon-status');
  if(button.disabled) return;
  const fields=new FormData(couponForm);
  const audience=couponAudiences.find(option=>option.id===fields.get('audience'));
  if(!audience) {
    status.textContent='Choose a coupon audience.';
    return;
  }
  button.disabled=true;
  status.textContent='Publishing coupon…';
  try {
    await api('admin/coupons',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      code:fields.get('code'),discount:Math.round(Number(fields.get('discount'))*100),
      budget:Math.round(Number(fields.get('budget'))*100),
      customers:audience.requiresCustomers ? [...selectedCustomers.keys()] : null,
      audience:audience.id
    })});
    couponForm.reset();
    selectedCustomers.clear();
    showSelectedCustomers();
    get('customer-results').replaceChildren();
    get('coupon-targets').hidden=true;
    status.textContent='Coupon published.';
    try {
      await loadCoupons();
    } catch(error) {
      status.textContent='Coupon published. Could not refresh the coupon list. '+error.message;
    }
  } catch(error) {status.textContent=error.message;}
  finally {button.disabled=false;}
};

function showAdminPage() {
  const pages=['home','catalog','bookings','offers','profile'];
  const requested=location.hash.slice(1);
  const page=pages.includes(requested) ? requested : 'home';
  for(const id of pages) get(id).hidden=!signedIn || id!==page;
  document.querySelector('header nav').hidden=!signedIn;
  get('admin-login').hidden=signedIn;
  if(!signedIn) return;
  for(const link of document.querySelectorAll('header nav a')) {
    if(link.hash==='#'+page) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  window.scrollTo(0,0);
  if(page==='offers') {
    loadDeliveryOffer();
    const button=get('publish-coupon');
    const status=get('coupon-status');
    button.disabled=true;
    status.textContent='Loading coupons and audience options…';
    loadCoupons().then(()=>{
      status.textContent='';
      button.disabled=false;
    }).catch(error=>{
      status.textContent='Could not load coupons and audience options. '+error.message;
    });
  }
  refreshVisibleBookings();
}
window.addEventListener('hashchange',showAdminPage);
document.addEventListener('visibilitychange',refreshVisibleBookings);
async function pollBookings() {
  await refreshVisibleBookings();
  setTimeout(pollBookings,5000);
}
setTimeout(pollBookings,5000);

async function loadAdminAccount() {
  const {profile}=await api('profile');
  if(profile.role!=='admin') throw new Error('Use your store admin account to sign in.');
  get('account').textContent=profile.email;
  signedIn=true;
  showAdminPage();
  loadCatalog().catch(error=>notice(error.message));
}
function bindAdminAuth(formId,field,errorId,missing,invalid,submit) {
  const form=get(formId);
  const input=form.elements[field];
  const error=get(errorId);
  function showError(message) {
    error.textContent=message;
    if(message) input.setAttribute('aria-invalid','true');
    else input.removeAttribute('aria-invalid');
  }
  input.addEventListener('input',()=>showError(''));
  form.onsubmit=async event=>{
    event.preventDefault();
    showError('');
    if(!input.validity.valid) {
      showError(input.validity.valueMissing ? missing : invalid);
      input.focus();
      return;
    }
    const button=form.querySelector('button');
    button.disabled=true;
    try { await submit(input.value); }
    catch(error) { showError(error.message); }
    finally { button.disabled=false; }
  };
}
function postAuth(path,data={}) {
  return api('auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
let codeEmail;
bindAdminAuth('admin-send','email','admin-email-error','Enter your email address.','Enter a valid email address.',async email=>{
  const verify=get('admin-verify');
  verify.hidden=true;
  verify.reset();
  verify.elements.code.removeAttribute('aria-invalid');
  get('admin-code-error').textContent='';
  get('admin-code-status').textContent='';
  await postAuth('otp/request',{email,mode:'admin'});
  codeEmail=email;
  verify.hidden=false;
  get('admin-code-status').textContent='Code sent to '+email+'.';
  verify.elements.code.focus();
});
bindAdminAuth('admin-verify','code','admin-code-error','Enter your six-digit code.','Enter exactly six digits.',async code=>{
  await postAuth('otp/verify',{email:codeEmail,code,mode:'admin'});
  await loadAdminAccount();
  get('admin-send').reset();
  get('admin-verify').reset();
  get('admin-verify').hidden=true;
  get('admin-code-status').textContent='';
  if(location.hash==='#login') window.history.replaceState(null,'','#home');
});
get('admin-logout').onclick=async event=>{
  const button=event.currentTarget;
  button.disabled=true;
  try {
    await postAuth('logout');
    window.history.replaceState(null,'','#login');
    location.reload();
  } catch(error) {
    get('logout-error').textContent=error.message;
  } finally {
    button.disabled=false;
  }
};
loadAdminAccount().catch(()=>showAdminPage());
