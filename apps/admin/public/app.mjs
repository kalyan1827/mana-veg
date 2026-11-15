const get = id => document.getElementById(id);
const notice = message => { get('notice').textContent = message; };
const money = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);
async function api(path, options) {
  const response = await fetch('/api/'+path,options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function text(tag,value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}
function bookingCard(order) {
  const card = text('article','');
  card.className = 'card';
  const status = {Placed:'Pending',Confirmed:'Accepted'}[order.status] ?? order.status;
  card.append(text('strong',status+' · '+money(order.total)),text('p',order.id),
    text('p',order.address+' · '+order.phone),text('p',order.slot_label),
    text('p',JSON.parse(order.items).map(item=>item.name+' × '+item.quantity).join(', ')));
  if (['Placed','Confirmed'].includes(order.status)) {
    const controls = text('div','');
    controls.className = 'actions';
    const actions = order.status === 'Placed' ? [['accept','Accept'],['reject','Reject']] : [['deliver','Mark delivered']];
    for (const [action,label] of actions) {
      const button = text('button',label);
      button.onclick = async () => {
        if (action === 'reject' && !window.confirm('Reject this booking and release its stock?')) return;
        for (const control of controls.children) control.disabled = true;
        try {
          await api('admin/orders/'+order.id+'/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
          await loadBookings();
        } catch (error) { notice(error.message); }
        finally { for (const control of controls.children) control.disabled = false; }
      };
      controls.append(button);
    }
    card.append(controls);
  }
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
  get('products').replaceChildren(...[...groups.values()].map(packs=>{
    const [product] = packs;
    const card = text('article','');
    card.className='card';
    const media = text('div','');
    media.className='catalog-photo';
    if (product.has_photo) {
      const image = document.createElement('img');
      image.src='/api/photos/'+product.id;
      image.alt=product.name;
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
      row.append(text('strong',money(pack.price)),' · '+pack.stock+' in stock');
      card.append(row);
    }
    return card;
  }));
}
const publishForm = get('publish');
function previewPricing() {
  const {pricing,unit,price,stock250,stock500,offer,discount} = publishForm.elements;
  const byWeight = pricing.value === 'weight';
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
  get('discount-caption').textContent=byWeight ? 'Discount off each kg (₹)' : 'Discount off each pack (₹)';
  const base=Math.round(Number(price.value)*100);
  const amount=offer.checked ? Math.round(Number(discount.value || NaN)*100) : 0;
  const paise=base-amount;
  const valid=Number.isFinite(amount) && amount>=1 && paise>=(byWeight ? 2 : 1);
  discount.setCustomValidity(offer.checked && Number.isFinite(amount) && !valid ? 'Enter a discount that leaves a valid selling price.' : '');
  get('pack-prices').textContent = paise >= (byWeight ? 2 : 1)
    ? byWeight ? '250 g: '+money(Math.round(paise/4))+' · 500 g: '+money(Math.round(paise/2))+' · 1 kg: '+money(paise)
      : 'Price per pack: '+money(paise)
    : '';
}
let previewUrl;
function previewPhoto() {
  if(previewUrl) URL.revokeObjectURL(previewUrl);
  const image=get('upload-preview');
  const file=publishForm.elements.photo.files[0];
  image.hidden=!file;
  get('upload-caption').textContent=file ? 'Change photo' : 'Upload product photo';
  previewUrl=file ? URL.createObjectURL(file) : undefined;
  if(previewUrl) image.src=previewUrl;
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
    await api('admin/catalog',{method:'POST',body:new FormData(event.currentTarget)});
    get('publish').reset();
    previewPhoto();
    previewPricing();
    await loadCatalog();
    notice('Vegetable published.');
  } catch(error) { notice(error.message); }
  finally { event.submitter.disabled=false; }
};
Promise.all([loadCatalog(),api('profile').then(({profile})=>{get('account').textContent=profile.email+' · '+profile.role;})]).catch(error=>notice(error.message));

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


function showAdminPage() {
  const pages=['home','catalog','bookings','profile'];
  const requested=location.hash.slice(1);
  const page=pages.includes(requested) ? requested : 'home';
  for(const id of pages) get(id).hidden=id!==page;
  for(const link of document.querySelectorAll('header nav a')) {
    if(link.hash==='#'+page) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  window.scrollTo(0,0);
  refreshVisibleBookings();
}
window.addEventListener('hashchange',showAdminPage);
document.addEventListener('visibilitychange',refreshVisibleBookings);
async function pollBookings() {
  await refreshVisibleBookings();
  setTimeout(pollBookings,5000);
}
setTimeout(pollBookings,5000);
showAdminPage();



