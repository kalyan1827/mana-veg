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
  const shortId = String(order.id).slice(0, 8).toUpperCase();

  if (order.status === 'Confirmed') {
    const lines = [
      '*Manankuragayalu — Order Accepted!* ✅',
      '',
      `Dear Customer, your order *#${shortId}* has been *ACCEPTED*!`,
      '🚚 *Delivery Schedule:* Next day delivery directly to your doorstep tomorrow.',
      '',
      '*Order Summary:*',
      ...items.map(item => `• ${item.name} (${item.unit}) × ${item.quantity} = ${money(item.price * item.quantity)}`),
      '',
      `Subtotal: ${money(subtotal)}`,
      ...(discount > 0 ? [`Coupon Discount (${order.coupon_code || 'DISCOUNT'}): -${money(discount)}`] : []),
      `Delivery Fee: ${fee === 0 ? 'FREE' : money(fee)}`,
      `💰 *Total Payable on Delivery: ${money(order.total)}*`,
      'Payment: Cash on Delivery / UPI',
      '',
      `📍 Delivery Address: ${order.address}`,
      '',
      'Our farm team is packing your fresh vegetables. Thank you for shopping with Manankuragayalu! 🥬🥦'
    ];
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(lines.join('\n'));
  }

  const status = { Placed: 'Order Received', Confirmed: 'Order Confirmed', Delivered: 'Order Delivered', Rejected: 'Order Rejected' }[order.status] ?? order.status;
  const lines = [
    '*Manankuragayalu — Order Invoice*',
    `Status: ${status}`,
    `Order ID: #${shortId}`,
    `Delivery: Next day delivery`,
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
  card.className = 'card' + (order.status === 'Placed' ? ' booking-card-pending' : '');
  const status = {Placed:'Pending · Waiting Acceptance',Confirmed:'Accepted'}[order.status] ?? order.status;
  card.append(text('strong',status+' · '+money(order.total)),text('p',order.id),
    text('p',order.address+' · '+order.phone),text('p',order.slot_label),
    text('p',JSON.parse(order.items).map(item=>item.name+' × '+item.quantity).join(', ')));
  const controls = text('div','');
  controls.className = 'actions';
  if (['Placed','Confirmed'].includes(order.status)) {
    const actions = order.status === 'Placed' ? [['accept','Accept'],['reject','Reject']] : [['deliver','Mark delivered']];
    for (const [action,label] of actions) {
      const button = text('button',label);
      button.type = 'button';
      button.className = 'btn-action btn-action-' + action;
      button.onclick = async () => {
        if (action === 'reject' && !window.confirm('Reject this booking and release its stock?')) return;
        for (const control of controls.querySelectorAll('button')) control.disabled = true;
        try {
          await api('admin/orders/'+order.id+'/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
          if (action === 'accept') {
            notice('Order #' + String(order.id).slice(0,8).toUpperCase() + ' accepted! Click "📲 WhatsApp Accepted Message" to notify customer.');
          }
          await loadBookings();
        } catch (error) { notice(error.message); }
        finally { for (const control of controls.querySelectorAll('button')) control.disabled = false; }
      };
      controls.append(button);
    }
  }
  const waUrl = whatsappInvoiceUrl(order);
  if (waUrl) {
    const isAccepted = order.status === 'Confirmed';
    const link = text('a', isAccepted ? '📲 WhatsApp Accepted Message' : 'WhatsApp Invoice');
    link.href = waUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'wa-invoice-btn' + (isAccepted ? ' wa-accepted-btn' : '');
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
    clearFieldError('publish-category-error', null);
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
function setFieldError(errorId, inputElement, message) {
  const errorEl = get(errorId);
  if (errorEl) errorEl.textContent = message;
  if (inputElement) inputElement.setAttribute('aria-invalid', 'true');
}

function clearFieldError(errorId, inputElement) {
  const errorEl = get(errorId);
  if (errorEl) errorEl.textContent = '';
  if (inputElement) inputElement.removeAttribute('aria-invalid');
}

const publishForm = get('publish');
let editing;
function resetPublishForm() {
  editing=undefined;
  publishForm.reset();
  get('publish-action').textContent='Publish vegetable';
  get('cancel-edit').hidden=true;
  ['publish-photo-error','publish-name-error','publish-category-error','publish-unit-error','publish-price-error','publish-stock250-error','publish-stock500-error','publish-stock-error','publish-discount-error','publish-general-error'].forEach(id => {
    const el = get(id);
    if (el) el.textContent = '';
  });
  publishForm.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  get('upload-tile-label')?.classList.remove('has-error');
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
  if (byWeight) {
    clearFieldError('publish-unit-error', unit);
  } else {
    clearFieldError('publish-stock250-error', stock250);
    clearFieldError('publish-stock500-error', stock500);
  }
  get('price-caption').textContent = byWeight ? 'Price per kg (₹)' : 'Price per pack (₹)';
  get('stock-label').textContent = byWeight ? '1 kg packs in stock' : 'Packs in stock';
  get('discount-field').hidden=!offer.checked;
  discount.disabled=!offer.checked;
  discount.required=offer.checked;
  if (!offer.checked) {
    clearFieldError('publish-discount-error', discount);
  }
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
  const photoInput = publishForm.elements.photo;
  const file = photoInput.files[0];
  const photoError = get('publish-photo-error');
  const uploadTile = get('upload-tile-label');

  if (file) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    if (file.size > 2 * 1024 * 1024) {
      photoError.textContent = `⚠️ Photo size is ${sizeMB} MB. Please upload an image less than 2 MB.`;
      uploadTile?.classList.add('has-error');
      photoInput.setAttribute('aria-invalid', 'true');
      photoInput.value = '';
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      const image = get('upload-preview');
      image.hidden = !editing?.photo;
      if (editing?.photo) image.src = editing.photo;
      else image.removeAttribute('src');
      get('upload-caption').textContent = editing?.photo ? 'Change photo' : 'Upload product photo';
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      photoError.textContent = '⚠️ Invalid file type. Please upload a JPG, PNG, or WebP photo.';
      uploadTile?.classList.add('has-error');
      photoInput.setAttribute('aria-invalid', 'true');
      photoInput.value = '';
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      return;
    }

    photoError.textContent = '';
    uploadTile?.classList.remove('has-error');
    photoInput.removeAttribute('aria-invalid');
  } else {
    if (!uploadTile?.classList.contains('has-error')) {
      photoError.textContent = '';
      photoInput.removeAttribute('aria-invalid');
    }
  }

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  const image = get('upload-preview');
  image.hidden = !file && !editing?.photo;
  get('upload-caption').textContent = image.hidden ? 'Upload product photo' : 'Change photo';
  previewUrl = file ? URL.createObjectURL(file) : undefined;
  if (previewUrl || editing?.photo) image.src = previewUrl ?? editing.photo;
  else image.removeAttribute('src');
}
publishForm.elements.photo.addEventListener('change', previewPhoto);

function validatePublishForm() {
  let isValid = true;
  let firstInvalid = null;

  function markInvalid(errorId, inputElement, message) {
    isValid = false;
    setFieldError(errorId, inputElement, message);
    if (!firstInvalid && inputElement) {
      firstInvalid = inputElement;
    }
  }

  const { name, category, pricing, unit, price, stock250, stock500, stock, offer, discount, photo } = publishForm.elements;
  const byWeight = pricing.value === 'weight';

  const photoFile = photo.files[0];
  if (photoFile) {
    if (photoFile.size > 2 * 1024 * 1024) {
      const sizeMB = (photoFile.size / (1024 * 1024)).toFixed(2);
      markInvalid('publish-photo-error', photo, `⚠️ Photo size is ${sizeMB} MB. Please upload an image less than 2 MB.`);
      get('upload-tile-label')?.classList.add('has-error');
    } else if (!['image/jpeg', 'image/png', 'image/webp'].includes(photoFile.type)) {
      markInvalid('publish-photo-error', photo, '⚠️ Please upload a JPG, PNG, or WebP photo.');
      get('upload-tile-label')?.classList.add('has-error');
    }
  }

  const nameVal = name.value.trim();
  if (!nameVal) {
    markInvalid('publish-name-error', name, 'Please enter vegetable name.');
  } else if (nameVal.length > 100) {
    markInvalid('publish-name-error', name, 'Name must be 100 characters or less.');
  } else {
    clearFieldError('publish-name-error', name);
  }

  if (!category.value) {
    markInvalid('publish-category-error', null, 'Please select a category.');
    if (!firstInvalid) firstInvalid = get('category-current');
  } else {
    clearFieldError('publish-category-error', null);
  }

  if (!byWeight) {
    const unitVal = unit.value.trim();
    if (!unitVal) {
      markInvalid('publish-unit-error', unit, 'Please enter pack size (e.g. 6 eggs, 1 bundle).');
    } else {
      clearFieldError('publish-unit-error', unit);
    }
  } else {
    clearFieldError('publish-unit-error', unit);
  }

  const priceVal = price.value.trim();
  const priceNum = Number(priceVal);
  if (!priceVal) {
    markInvalid('publish-price-error', price, 'Please enter price in rupees (e.g. 40 or 35.50).');
  } else if (isNaN(priceNum) || priceNum <= 0) {
    markInvalid('publish-price-error', price, 'Please enter a valid price greater than ₹0.');
  } else {
    clearFieldError('publish-price-error', price);
  }

  if (byWeight) {
    const s250Val = stock250.value.trim();
    const s250Num = Number(s250Val);
    if (!s250Val || isNaN(s250Num) || s250Num < 0 || !Number.isInteger(s250Num)) {
      markInvalid('publish-stock250-error', stock250, 'Please enter 250 g packs in stock (0 or more).');
    } else {
      clearFieldError('publish-stock250-error', stock250);
    }

    const s500Val = stock500.value.trim();
    const s500Num = Number(s500Val);
    if (!s500Val || isNaN(s500Num) || s500Num < 0 || !Number.isInteger(s500Num)) {
      markInvalid('publish-stock500-error', stock500, 'Please enter 500 g packs in stock (0 or more).');
    } else {
      clearFieldError('publish-stock500-error', stock500);
    }
  } else {
    clearFieldError('publish-stock250-error', stock250);
    clearFieldError('publish-stock500-error', stock500);
  }

  const stockVal = stock.value.trim();
  const stockNum = Number(stockVal);
  if (!stockVal || isNaN(stockNum) || stockNum < 0 || !Number.isInteger(stockNum)) {
    markInvalid('publish-stock-error', stock, byWeight ? 'Please enter 1 kg packs in stock (0 or more).' : 'Please enter packs in stock (0 or more).');
  } else {
    clearFieldError('publish-stock-error', stock);
  }

  if (offer.checked) {
    const discVal = discount.value.trim();
    const discNum = Number(discVal);
    if (!discVal) {
      markInvalid('publish-discount-error', discount, 'Please enter discount amount in rupees.');
    } else if (isNaN(discNum) || discNum <= 0) {
      markInvalid('publish-discount-error', discount, 'Please enter a valid discount greater than ₹0.');
    } else if (priceNum && discNum >= priceNum) {
      markInvalid('publish-discount-error', discount, `Discount (₹${discNum}) must be less than price (₹${priceNum}).`);
    } else {
      clearFieldError('publish-discount-error', discount);
    }
  } else {
    clearFieldError('publish-discount-error', discount);
  }

  if (!isValid && firstInvalid) {
    firstInvalid.focus();
  }

  return isValid;
}

publishForm.elements.name.addEventListener('input', () => {
  if (publishForm.elements.name.value.trim()) clearFieldError('publish-name-error', publishForm.elements.name);
});
publishForm.elements.unit.addEventListener('input', () => {
  if (publishForm.elements.unit.value.trim()) clearFieldError('publish-unit-error', publishForm.elements.unit);
});
publishForm.elements.price.addEventListener('input', () => {
  const num = Number(publishForm.elements.price.value.trim());
  if (!isNaN(num) && num > 0) clearFieldError('publish-price-error', publishForm.elements.price);
});
publishForm.elements.stock.addEventListener('input', () => {
  const num = Number(publishForm.elements.stock.value.trim());
  if (!isNaN(num) && num >= 0 && Number.isInteger(num)) clearFieldError('publish-stock-error', publishForm.elements.stock);
});
publishForm.elements.stock250.addEventListener('input', () => {
  const num = Number(publishForm.elements.stock250.value.trim());
  if (!isNaN(num) && num >= 0 && Number.isInteger(num)) clearFieldError('publish-stock250-error', publishForm.elements.stock250);
});
publishForm.elements.stock500.addEventListener('input', () => {
  const num = Number(publishForm.elements.stock500.value.trim());
  if (!isNaN(num) && num >= 0 && Number.isInteger(num)) clearFieldError('publish-stock500-error', publishForm.elements.stock500);
});
publishForm.elements.discount.addEventListener('input', () => {
  const num = Number(publishForm.elements.discount.value.trim());
  const pNum = Number(publishForm.elements.price.value.trim());
  if (!isNaN(num) && num > 0 && (!pNum || num < pNum)) clearFieldError('publish-discount-error', publishForm.elements.discount);
});

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
  get('publish-general-error').textContent = '';
  if (!validatePublishForm()) return;
  event.submitter.disabled=true;
  try {
    const body=new FormData(publishForm);
    const target=editing;
    if(target) body.set('previousStock',JSON.stringify(target.previousStock));
    await api(target ? 'admin/catalog/'+target.id : 'admin/catalog',{method:target ? 'PUT' : 'POST',body});
    resetPublishForm();
    await loadCatalog();
    notice(target ? 'Product updated and published.' : 'Vegetable published.');
  } catch(error) {
    if (error.message && error.message.toLowerCase().includes('photo')) {
      setFieldError('publish-photo-error', publishForm.elements.photo, error.message);
      get('upload-tile-label')?.classList.add('has-error');
    } else {
      get('publish-general-error').textContent = error.message;
    }
    notice(error.message);
  }
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
deliveryOfferForm.elements.threshold.addEventListener('input', () => {
  const val = deliveryOfferForm.elements.threshold.value.trim();
  const num = Number(val);
  if (val && !isNaN(num) && num >= 0) clearFieldError('delivery-offer-error', deliveryOfferForm.elements.threshold);
});
deliveryOfferForm.onsubmit=async event=>{
  event.preventDefault();
  const input=deliveryOfferForm.elements.threshold;
  const val=input.value.trim();
  const num=Number(val);
  if (!val) {
    setFieldError('delivery-offer-error', input, 'Please enter minimum cart amount for free delivery.');
    input.focus();
    return;
  }
  if (isNaN(num) || num < 0) {
    setFieldError('delivery-offer-error', input, 'Please enter a valid amount in rupees (e.g. 500).');
    input.focus();
    return;
  }
  clearFieldError('delivery-offer-error', input);
  const button=get('save-delivery-offer');
  const status=get('delivery-offer-status');
  button.disabled=true;
  try {
    const threshold=Math.round(num*100);
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

couponForm.elements.code.addEventListener('input', () => {
  if (couponForm.elements.code.value.trim()) clearFieldError('coupon-code-error', couponForm.elements.code);
});
couponForm.elements.discount.addEventListener('input', () => {
  const num = Number(couponForm.elements.discount.value.trim());
  if (!isNaN(num) && num > 0) clearFieldError('coupon-discount-error', couponForm.elements.discount);
});
couponForm.elements.budget.addEventListener('input', () => {
  const num = Number(couponForm.elements.budget.value.trim());
  if (!isNaN(num) && num > 0) clearFieldError('coupon-budget-error', couponForm.elements.budget);
});

couponForm.onsubmit=async event=>{
  event.preventDefault();
  const { code, discount, budget } = couponForm.elements;
  let valid = true;
  let firstInvalid = null;

  const codeVal = code.value.trim();
  if (!codeVal) {
    setFieldError('coupon-code-error', code, 'Please enter coupon code.');
    valid = false;
    if (!firstInvalid) firstInvalid = code;
  } else if (!/^[a-zA-Z0-9\-]{3,32}$/.test(codeVal)) {
    setFieldError('coupon-code-error', code, 'Coupon code must be 3-32 letters, numbers, or hyphens.');
    valid = false;
    if (!firstInvalid) firstInvalid = code;
  } else {
    clearFieldError('coupon-code-error', code);
  }

  const discVal = discount.value.trim();
  const discNum = Number(discVal);
  if (!discVal) {
    setFieldError('coupon-discount-error', discount, 'Please enter discount per order.');
    valid = false;
    if (!firstInvalid) firstInvalid = discount;
  } else if (isNaN(discNum) || discNum <= 0) {
    setFieldError('coupon-discount-error', discount, 'Please enter a valid discount greater than ₹0.');
    valid = false;
    if (!firstInvalid) firstInvalid = discount;
  } else {
    clearFieldError('coupon-discount-error', discount);
  }

  const budgetVal = budget.value.trim();
  const budgetNum = Number(budgetVal);
  if (!budgetVal) {
    setFieldError('coupon-budget-error', budget, 'Please enter total budget for coupon.');
    valid = false;
    if (!firstInvalid) firstInvalid = budget;
  } else if (isNaN(budgetNum) || budgetNum <= 0) {
    setFieldError('coupon-budget-error', budget, 'Please enter a valid budget greater than ₹0.');
    valid = false;
    if (!firstInvalid) firstInvalid = budget;
  } else if (discNum && budgetNum < discNum) {
    setFieldError('coupon-budget-error', budget, `Budget must be at least ₹${discNum} (the discount amount).`);
    valid = false;
    if (!firstInvalid) firstInvalid = budget;
  } else {
    clearFieldError('coupon-budget-error', budget);
  }

  if (!valid) {
    if (firstInvalid) firstInvalid.focus();
    return;
  }

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
      code:codeVal,discount:Math.round(discNum*100),
      budget:Math.round(budgetNum*100),
      customers:audience.requiresCustomers ? [...selectedCustomers.keys()] : null,
      audience:audience.id
    })});
    couponForm.reset();
    ['coupon-code-error','coupon-discount-error','coupon-budget-error'].forEach(id => {
      const el = get(id);
      if (el) el.textContent = '';
    });
    couponForm.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
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
  currentAdminPage = page;
  refreshVisibleBookings();
}

let currentAdminPage = 'home';
function navigateAdminTab(targetHref) {
  const cleanTarget = targetHref.replace(/^#/, '');
  const pages = ['home', 'catalog', 'bookings', 'offers', 'profile'];
  if (pages.includes(cleanTarget)) {
    if (cleanTarget === 'home') {
      window.history.replaceState(null, '', '#home');
    } else if (currentAdminPage === 'home') {
      window.history.pushState(null, '', '#' + cleanTarget);
    } else {
      window.history.replaceState(null, '', '#' + cleanTarget);
    }
    currentAdminPage = cleanTarget;
    showAdminPage();
    return true;
  }
  return false;
}

document.addEventListener('click', event => {
  const anchor = event.target.closest('a[href^="#"]');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href || href === '#') return;
  if (navigateAdminTab(href)) {
    event.preventDefault();
  }
});

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

function switchToOtpSetup(prefillEmail = '') {
  get('admin-pwd-form').hidden = true;
  get('admin-otp-wrap').hidden = false;
  get('admin-login-desc').textContent = 'Verify your admin email to set or reset your password.';
  if (prefillEmail) get('admin-send').elements.email.value = prefillEmail;
}

function switchToPasswordLogin(prefillEmail = '') {
  get('admin-otp-wrap').hidden = true;
  get('admin-pwd-form').hidden = false;
  get('admin-login-desc').textContent = 'Sign in with your admin email and password.';
  if (prefillEmail) get('admin-pwd-form').elements.email.value = prefillEmail;
}

get('admin-switch-otp').onclick = () => {
  const email = get('admin-pwd-form').elements.email.value.trim();
  switchToOtpSetup(email);
};

get('admin-switch-pwd').onclick = () => {
  const email = get('admin-send').elements.email.value.trim();
  switchToPasswordLogin(email);
};

const pwdForm = get('admin-pwd-form');
pwdForm.onsubmit = async event => {
  event.preventDefault();
  get('admin-pwd-email-error').textContent = '';
  get('admin-pwd-error').textContent = '';
  get('admin-pwd-status').textContent = '';

  const email = pwdForm.elements.email.value.trim();
  const password = pwdForm.elements.password.value;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    get('admin-pwd-email-error').textContent = 'Enter a valid admin email address.';
    pwdForm.elements.email.focus();
    return;
  }
  if (!password) {
    get('admin-pwd-error').textContent = 'Enter your admin password.';
    pwdForm.elements.password.focus();
    return;
  }

  const button = get('admin-pwd-btn');
  button.disabled = true;
  get('admin-pwd-status').textContent = 'Signing in…';
  try {
    await postAuth('admin/login', { email, password });
    pwdForm.reset();
    get('admin-pwd-status').textContent = '';
    await loadAdminAccount();
    if (location.hash === '#login') window.history.replaceState(null, '', '#home');
  } catch (error) {
    get('admin-pwd-status').textContent = '';
    if (error.needsSetup) {
      switchToOtpSetup(email);
      get('admin-code-status').textContent = error.message;
    } else {
      get('admin-pwd-error').textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
};

let codeEmail;
bindAdminAuth('admin-send','email','admin-email-error','Enter your email address.','Enter a valid email address.',async email=>{
  const verify=get('admin-verify');
  verify.hidden=true;
  verify.reset();
  verify.elements.code.removeAttribute('aria-invalid');
  get('admin-code-error').textContent='';
  get('admin-new-pwd-error').textContent='';
  get('admin-code-status').textContent='Sending verification code…';
  await postAuth('otp/request',{email,mode:'admin'});
  codeEmail=email;
  verify.hidden=false;
  get('admin-code-status').textContent='6-digit verification code sent to '+email+'.';
  verify.elements.code.focus();
});

const verifyForm = get('admin-verify');
verifyForm.onsubmit = async event => {
  event.preventDefault();
  get('admin-code-error').textContent = '';
  get('admin-new-pwd-error').textContent = '';

  const code = verifyForm.elements.code.value.trim();
  const newPassword = verifyForm.elements.new_password.value;

  if (!/^\d{6}$/.test(code)) {
    get('admin-code-error').textContent = 'Enter exactly six digits.';
    verifyForm.elements.code.focus();
    return;
  }
  if (!newPassword || newPassword.length < 8) {
    get('admin-new-pwd-error').textContent = 'Password must be at least 8 characters long.';
    verifyForm.elements.new_password.focus();
    return;
  }

  const button = get('admin-verify-btn');
  button.disabled = true;
  try {
    await postAuth('otp/verify', { email: codeEmail, code, mode: 'admin', password: newPassword });
    get('admin-send').reset();
    verifyForm.reset();
    verifyForm.hidden = true;
    get('admin-code-status').textContent = '';
    switchToPasswordLogin(codeEmail);
    await loadAdminAccount();
    if (location.hash === '#login') window.history.replaceState(null, '', '#home');
  } catch (error) {
    get('admin-code-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
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
