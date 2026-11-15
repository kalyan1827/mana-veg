const get=id=>document.getElementById(id);
const notice=message=>{get('notice').textContent=message;};
const money=value=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(value/100);
const checkout=get('checkout');
const profileForm=get('profile-form');
const cart=new Map();
let catalog, profile, pending;
let loginEmail;
let authMode='login';
let returnPage='home';
let catalogLoading;
let category='Vegetables', nextOffset=null, orderRequest=0;

async function api(path,data,headers={}) {
  const response=await fetch('/api/'+path,data===undefined ? {} : {
    method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)
  });
  const result=await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error),{status:response.status});
  return result;
}
function node(tag,text,cls) {
  const element=document.createElement(tag);
  element.textContent=text;
  if(cls) element.className=cls;
  return element;
}
function action(label,callback) {
  const button=node('button',label);
  button.type='button';
  button.onclick=callback;
  return button;
}
function bind(id,handler) {
  const form=get(id);
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=event.submitter;
    if(button) button.disabled=true;
    notice('');
    try { await handler(new FormData(form)); }
    catch(error) { notice(error.message); }
    finally { if(button) button.disabled=false; }
  };
}
function change(product,quantity) {
  if(quantity>Math.min(product.stock,50)) return notice('No more packs available.');
  if(quantity<=0) cart.delete(product.id);
  else cart.set(product.id,{product,quantity});
  drawCart();
}
const subtotal=()=>[...cart.values()].reduce((sum,{product,quantity})=>sum+product.price*quantity,0);
function updateCartBar() {
  const count=[...cart.values()].reduce((sum,item)=>sum+item.quantity,0);
  get('cart-bar-count').textContent=count+' '+(count===1 ? 'pack' : 'packs')+' added';
  get('cart-bar').hidden=!count || !['#home','#categories'].includes(location.hash);
  document.body.classList.toggle('has-cart-bar',!get('cart-bar').hidden);
}
function drawCart() {
  const count=[...cart.values()].reduce((sum,item)=>sum+item.quantity,0);
  get('cart-count').textContent=count ? '('+count+')' : '';
  updateCartBar();
  checkout.hidden=!count;
  get('browse').hidden=Boolean(count);
  const rows=[...cart.values()].map(({product,quantity})=>{
    const card=node('article','','card');
    card.append(node('h3',product.name),node('p',product.unit+' × '+quantity+' · '+money(product.price*quantity)),
      action('Remove one',()=>change(product,quantity-1)),document.createTextNode(' '),action('Add one',()=>change(product,quantity+1)));
    return card;
  });
  get('cart').replaceChildren(...rows,node('p',count ? 'Subtotal '+money(subtotal())+' · Delivery '+money(catalog.fee)+' · Total '+money(subtotal()+catalog.fee) : 'Your cart is empty.'));
}
function productCards(products) {
  const groups = new Map();
  for (const product of products) {
    const key = product.pack_group ?? product.id;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(product);
  }
  return [...groups.values()].map(packs=>productCard(packs.sort((a,b)=>a.price-b.price)));
}
function productCard(variants) {
  const [product] = variants;
  const card=node('article','','card');
  card.classList.add('produce-card');
  const media=node('div','','product-media');
  const placeholder=node('span','Photo unavailable');
  media.append(placeholder);
  const photoVariant=variants.find(option=>option.has_photo);
  if(photoVariant) {
    const image=document.createElement('img');
    image.src='/api/photos/'+encodeURIComponent(photoVariant.id)+(catalog.demo && /^[a-z-]+-\d+(?:g|kg)$/.test(photoVariant.id) ? '?demo=1' : '');
    image.alt=product.name;
    image.loading='lazy';
    image.addEventListener('load',()=>{placeholder.hidden=true;});
    image.addEventListener('error',()=>{image.hidden=true; placeholder.hidden=false;});
    media.append(image);
  }
  card.append(media);
  const tags=JSON.parse(product.tags ?? '[]').sort((a,b)=>Number(b==="Today's special")-Number(a==="Today's special"));
  const hasOffer=variants.some(option=>option.original_price>option.price);
  if(tags.length) {
    const badges=node('div','','photo-tags');
    for(const tag of tags) badges.append(node('span',tag,tag==="Today's special" ? 'featured' : ''));
    media.append(badges);
  }
  let variant = variants.find(option=>option.stock) ?? product;
  const pack = node('fieldset','','pack-picker');
  pack.append(node('legend','Pack size'));
  const packButtons = variants.map(option=>{
    const choice=action('',()=>{
      variant=option;
      updateTotal();
    });
    choice.className='pack-option';
    choice.append(node('strong',option.unit),node('span',money(option.price)));
    if(option.original_price>option.price) choice.append(node('s',money(option.original_price)));
    choice.disabled=!option.stock;
    if (!option.stock) choice.append(node('small','Sold out'));
    pack.append(choice);
    return choice;
  });
  const total=node('p','');
  total.className='product-total';
  total.setAttribute('aria-live','polite');
  const button=action('Add to cart',()=>{
    change(variant,(cart.get(variant.id)?.quantity ?? 0)+1);
    updateTotal();
  });
  function updateTotal() {
    packButtons.forEach((choice,index)=>choice.setAttribute('aria-pressed',String(variants[index]===variant)));
    const remaining=Math.min(variant.stock,50)-(cart.get(variant.id)?.quantity ?? 0);
    button.disabled=remaining<=0;
    total.textContent=money(variant.price)+' per pack';
    button.textContent=!variant.stock ? 'Sold out' : button.disabled ? 'Pack limit reached' : 'Add to cart';
  }
  updateTotal();
  card.append(node('span',product.category,'badge'),node('h3',product.name));
  if(hasOffer) card.append(node('span','Offer','product-offer'));
  if(product.kilo_price) card.append(node('p',money(product.kilo_price)+' per kg'));
  card.append(pack,total,button);
  return card;
}
function drawCategory() {
  get('category-title').textContent=category;
  for(const button of get('category-filter').children) button.setAttribute('aria-pressed',String(button.textContent===category));
  const products=catalog.products.filter(product=>product.category===category);
  get('category-products').replaceChildren(...(products.length ? productCards(products) : [node('p','No products in this category yet.')]));
}
async function loadCatalog() {
  catalog=await api('catalog');
  get('catalog-mode').hidden=!catalog.demo;
  get('products').replaceChildren(...(catalog.products.length ? productCards(catalog.products) : [node('p','No products available yet.')]));
  const names=new Set(['Vegetables','Eggs','Groceries',...(catalog.categories ?? []).map(item=>item.name),...catalog.products.map(item=>item.category)]);
  get('category-filter').replaceChildren(...[...names].map(name=>action(name,()=>{category=name; drawCategory();})));
  const slots=get('slots');
  const selectedSlot=slots.value;
  slots.replaceChildren(...catalog.slots.map(slot=>new Option(slot.label,slot.id)));
  if(catalog.slots.some(slot=>slot.id===selectedSlot)) slots.value=selectedSlot;
  drawCategory();
  drawCart();
}
function refreshCatalog() {
  if(!catalogLoading) catalogLoading=loadCatalog().catch(error=>notice(error.message)).finally(()=>{catalogLoading=null;});
}
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden && document.querySelector('[data-page="home"]:not([hidden]), [data-page="categories"]:not([hidden])')) refreshCatalog();
});
function showProfile(current) {
  profile=current;
  get('account').textContent=profile ? profile.email : 'Sign in to manage your profile and orders.';
  get('logout').hidden=!profile;
  get('profile-signin').hidden=Boolean(profile);
  get('checkout-signin').hidden=Boolean(profile);
  get('place-order').hidden=!profile;
  profileForm.hidden=!profile;
  get('use-saved').disabled=!profile?.address;
  for(const field of ['name','phone','address','lat','lon']) profileForm.elements[field].value=profile?.[field] ?? '';
  get('profile-location-status').textContent=profile?.lat!=null && profile?.lon!=null ? 'Delivery location saved.' : '';
}
async function loadProfile() {
  try { showProfile((await api('profile')).profile); }
  catch { showProfile(null); }
}
bind('send',async data=>{
  const email=data.get('email');
  const mode=authMode;
  loginEmail=undefined;
  get('verify').hidden=true;
  get('verify').reset();
  get('login-status').textContent='';
  await api('auth/otp/request',{email,mode});
  if(mode!==authMode) return;
  loginEmail=email;
  get('verify').reset();
  get('verify').hidden=false;
  get('login-status').textContent='Code sent to '+email+'.';
  get('verify').elements.code.focus();
});
bind('verify',async data=>{
  await api('auth/otp/verify',{email:loginEmail,code:data.get('code'),mode:authMode});
  await loadProfile();
  if (!profile) throw new Error('The browser could not save your session. Try again.');
  get('verify').hidden=true;
  get('verify').reset();
  get('send').reset();
  get('login-status').textContent='';
  location.replace('#'+returnPage);
});
function signInFrom(page) {
  returnPage=page;
  location.hash='login';
}
get('profile-signin').onclick=()=>signInFrom('profile');
get('checkout-signin').onclick=()=>signInFrom('cart');
get('logout').onclick=async event=>{
  const button=event.currentTarget;
  button.disabled=true;
  try {
    await api('auth/logout',{});
    orderRequest++;
    get('history').replaceChildren();
    get('receipt').textContent='';
    checkout.reset();
    get('delivery-status').textContent='';
    cart.clear();
    pending=null;
    drawCart();
    showProfile(null);
    location.hash='home';
  } catch(error) { notice(error.message); }
  finally { button.disabled=false; }
};
const coordinates=form=>({
  lat:form.elements.lat.value === '' ? null : Number(form.elements.lat.value),
  lon:form.elements.lon.value === '' ? null : Number(form.elements.lon.value)
});
bind('profile-form',async data=>{
  const result=await api('profile',{...Object.fromEntries(data),...coordinates(profileForm)});
  showProfile(result.profile);
  notice('Profile saved.');
});
get('use-saved').onclick=()=>{
  for(const field of ['address','phone','lat','lon']) checkout.elements[field].value=profile?.[field] ?? '';
  if(coordinates(checkout).lat!==null && coordinates(checkout).lon!==null) checkDelivery(checkout,'delivery-status');
  else get('delivery-status').textContent='Saved address loaded. Use your current location to check delivery.';
};
function locate(buttonId,form,status,onSuccess) {
  const button=get(buttonId);
  button.onclick=async()=>{
    get(status).textContent='Finding your location…';
    button.disabled=true;
    try {
      if(!navigator.geolocation) throw new Error('Location is unavailable in this browser.');
      const {coords}=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{timeout:12000}));
      form.elements.lat.value=coords.latitude;
      form.elements.lon.value=coords.longitude;
      await onSuccess();
    } catch(error) {
      get(status).textContent=error.code===1
        ? 'Allow location access in your browser, then try again.'
        : 'Could not find your location. Check that location services are on, then try again.';
    } finally { button.disabled=false; }
  };
}
async function checkDelivery(form,status,copyToCheckout=false) {
  const point=coordinates(form);
  try {
    const {eligible}=await api('delivery/check',point);
    const current=coordinates(form);
    if(point.lat!==current.lat || point.lon!==current.lon) return;
    get(status).textContent=eligible ? 'Delivery available.' : 'Outside the delivery area.';
    if(copyToCheckout && eligible) {
      checkout.elements.lat.value=point.lat;
      checkout.elements.lon.value=point.lon;
      get('delivery-status').textContent='Delivery available at the checked location.';
    }
  } catch(error) {get(status).textContent=error.message;}
}
const preview=get('delivery-preview');
preview.onsubmit=event=>event.preventDefault();
locate('preview-locate',preview,'preview-status',()=>checkDelivery(preview,'preview-status',true));
locate('locate',checkout,'delivery-status',()=>checkDelivery(checkout,'delivery-status'));
locate('profile-locate',profileForm,'profile-location-status',()=>{
  get('profile-location-status').textContent='Location selected. Save your profile to keep it.';
});
bind('checkout',async data=>{
  if(!cart.size) throw new Error('Add products before placing an order.');
  if(!profile) return signInFrom('cart');
  const point=coordinates(checkout);
  if(point.lat===null || point.lon===null) throw new Error('Use your current location or a saved address before placing an order.');
  const order={...coordinates(checkout),address:data.get('address'),phone:data.get('phone'),slot:data.get('slot'),
    consent:data.has('consent'),total:subtotal()+catalog.fee,items:[...cart.values()].map(({product,quantity})=>({id:product.id,quantity}))};
  const fingerprint=JSON.stringify(order);
  if(pending?.fingerprint!==fingerprint) pending={fingerprint,key:crypto.randomUUID()};
  let result;
  try { result=await api('orders',order,{'Idempotency-Key':pending.key}); }
  catch(error) {
    if(error.status!==401) throw error;
    showProfile(null);
    return signInFrom('cart');
  }
  cart.clear();
  pending=null;
  drawCart();
  get('receipt').textContent='Order placed · '+result.order.id+' · '+money(result.order.total);
  loadCatalog().catch(error=>notice(error.message));
});
async function loadOrders(offset=0) {
  const request=++orderRequest;
  const history=get('history');
  get('more-orders').hidden=true;
  if(!profile) {
    history.replaceChildren(action('Sign in to see your orders',()=>signInFrom('orders')));
    return;
  }
  if(!offset) history.textContent='Loading your orders…';
  try {
    const result=await api('orders?offset='+offset);
    if(request!==orderRequest) return;
    const cards=result.orders.map(order=>{
      const card=node('article','','card');
      const status={Placed:'Awaiting acceptance',Confirmed:'Accepted',Rejected:'Rejected'}[order.status] ?? order.status;
      card.append(node('strong',status,'badge'),node('p',new Date(order.created).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'})+' · '+money(order.total)),
        node('p',JSON.parse(order.items).map(item=>item.name+' × '+item.quantity).join(', ')),node('p',order.slot_label),node('small','Order '+order.id));
      return card;
    });
    if(offset) history.append(...cards);
    else history.replaceChildren(...(cards.length ? cards : [node('p','No orders yet.')]));
    nextOffset=result.nextOffset;
    get('more-orders').hidden=nextOffset==null;
  } catch(error) {
    if(request!==orderRequest) return;
    if(offset) { get('more-orders').hidden=false; notice(error.message); }
    else if(error.status===401) { showProfile(null); loadOrders(); }
    else history.textContent=error.message;
  }
}
get('more-orders').onclick=()=>loadOrders(nextOffset);
function showPage() {
  const aliases={'categories-nav':'categories','cart-section':'cart','my-orders':'orders','catalog':'home','support':'profile'};
  const hash=location.hash.slice(1);
  const candidate=aliases[hash] ?? hash;
  const authRoute=!profile && ['login','signup','welcome'].includes(candidate);
  const page=authRoute ? 'welcome' : ['home','categories','cart','orders','profile','delivery'].includes(candidate) ? candidate : 'home';
  const route=authRoute ? hash==='signup' ? 'signup' : 'login' : page;
  if(hash!==route) window.history.replaceState(null,'','#'+route);
  document.querySelector('header nav').hidden=authRoute;
  if(authRoute) {
    const mode=route==='signup' ? 'signup' : 'login';
    if(mode!==authMode) {
      loginEmail=undefined;
      get('verify').hidden=true;
      get('verify').reset();
      get('login-status').textContent='';
    }
    authMode=mode;
    get('auth-title').textContent=mode==='signup' ? 'Create your account' : 'Sign in';
    get('auth-description').textContent=mode==='signup' ? 'Verify your email to create your account.' : 'Enter your email to receive a one-time sign-in code.';
    const link=node('a',mode==='signup' ? 'Sign in' : 'Create an account');
    link.href=mode==='signup' ? '#login' : '#signup';
    get('auth-alternative').replaceChildren(mode==='signup' ? 'Already have an account? ' : 'New to Manankuragayalu? ',link);
    get('auth-back').href='#'+returnPage;
    get('auth-back').textContent=returnPage==='cart' ? 'Back to cart' : 'Back to shopping';
  } else if(!catalog || page==='home' || page==='categories') {
    refreshCatalog();
  }
  for(const section of document.querySelectorAll('[data-page]')) section.hidden=section.dataset.page!==page;
  for(const link of document.querySelectorAll('nav a')) {
    if(link.hash==='#'+page) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  if(hash==='support') get('support').open=true;
  notice('');
  updateCartBar();
  window.scrollTo(0,0);
  if(page==='orders') loadOrders();
}
drawCart();
loadProfile().then(()=>{
  window.addEventListener('hashchange',showPage);
  showPage();
});
