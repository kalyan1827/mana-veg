const get=id=>document.getElementById(id);
const notice=message=>{get('notice').textContent=message;};
const money=value=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(value/100);
const checkout=get('checkout');
const profileForm=get('profile-form');
const cart=new Map();
const refreshCartButtons=new WeakMap();
let catalog, profile, pending;
let loginEmail, loginUsername, coupon;
let authMode='login';
let returnPage='home';
let catalogLoading;
let category, nextOffset=null, orderRequest=0;

async function api(path,data,headers={}) {
  const response=await fetch('/api/'+path,data===undefined ? {} : {
    method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)
  });
  const result=await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error),{status:response.status,field:result.field});
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
function bind(id,handler,onError=error=>notice(error.message)) {
  const form=get(id);
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=event.submitter;
    if(button) button.disabled=true;
    notice('');
    try { await handler(new FormData(form)); }
    catch(error) { onError(error); }
    finally { if(button) button.disabled=false; }
  };
}
const authFields={
  username:get('send').elements.username,
  email:get('send').elements.email,
  code:get('verify').elements.code
};
function setAuthError(name,message='') {
  get(name+'-error').textContent=message;
  if(message) authFields[name].setAttribute('aria-invalid','true');
  else authFields[name].removeAttribute('aria-invalid');
}
function clearAuthErrors() {
  for(const name of Object.keys(authFields)) setAuthError(name);
}
const requiredAuthMessages={
  username:'Enter a username.',
  email:'Enter your email address.',
  code:'Enter your six-digit code.'
};
const invalidAuthMessages={
  username:'Use 3–24 letters, numbers, or underscores.',
  email:'Enter a valid email address.',
  code:'Enter exactly six digits.'
};
function validateAuthForm(form) {
  let firstInvalid;
  for(const [name,input] of Object.entries(authFields)) {
    if(input.form!==form || input.disabled || input.validity.valid) continue;
    setAuthError(name,input.validity.valueMissing ? requiredAuthMessages[name] : invalidAuthMessages[name]);
    firstInvalid ??= input;
  }
  firstInvalid?.focus();
  return !firstInvalid;
}
for(const [name,input] of Object.entries(authFields)) {
  input.addEventListener('input',()=>setAuthError(name));
}
function change(product,quantity) {
  if(quantity>Math.min(product.stock,50)) return notice('No more packs available.');
  if(quantity<=0) cart.delete(product.id);
  else cart.set(product.id,{product,quantity});
  coupon=undefined;
  get('coupon-status').textContent=checkout.elements.coupon.value ? 'Cart changed. Apply the coupon again.' : '';
  drawCart();
}
const discountedSubtotal=()=>subtotal()-(coupon?.discount ?? 0);
const deliveryFee=()=>discountedSubtotal()>catalog.freeDeliveryThreshold ? 0 : catalog.fee;
const payable=()=>discountedSubtotal()+deliveryFee();
const subtotal=()=>[...cart.values()].reduce((sum,{product,quantity})=>sum+product.price*quantity,0);
const deliveryProgressBars=document.querySelectorAll('.delivery-progress');
const deliveryOfferBanner=get('delivery-offer-banner');
function updateDeliveryProgress(cartBarVisible) {
  const threshold=catalog?.freeDeliveryThreshold;
  const hasOffer=Number.isSafeInteger(threshold) && threshold>=0 && catalog.fee>0;
  for(const bar of deliveryProgressBars) {
    bar.hidden=!hasOffer || bar.parentElement.hidden;
    if(bar.hidden) continue;
    // Prices are in paise and the subtotal must exceed the published threshold.
    const goal=threshold+1;
    const amount=Math.max(0,discountedSubtotal());
    const remaining=Math.max(0,goal-amount);
    const progress=bar.querySelector('progress');
    progress.max=goal;
    progress.value=Math.min(amount,goal);
    const status=bar.querySelector('.delivery-progress-status');
    const message=remaining ? 'Add '+money(remaining)+' more for free delivery' : 'Free delivery unlocked';
    if(status.textContent!==message) status.textContent=message;
  }
  document.body.classList.toggle('has-delivery-progress',cartBarVisible && hasOffer);
  deliveryOfferBanner.hidden=!hasOffer || cartBarVisible || document.querySelector('header nav').hidden;
  if(!deliveryOfferBanner.hidden) {
    const amount=new Intl.NumberFormat('en-IN',{
      style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2
    }).format(threshold/100);
    get('delivery-offer-message').textContent='Shop over '+amount+' to unlock free delivery';
  }
}
function updateCartBar() {
  const count=[...cart.values()].reduce((sum,item)=>sum+item.quantity,0);
  get('cart-bar-count').textContent=count+' '+(count===1 ? 'pack' : 'packs')+' added';
  get('cart-bar').hidden=!count || !['#home','#categories'].includes(location.hash);
  get('cart-checkout-bar').hidden=!count || location.hash!=='#cart';
  get('cart-pay-total').textContent=count ? money(payable()) : '';
  const cartBarVisible=!get('cart-bar').hidden || !get('cart-checkout-bar').hidden;
  updateDeliveryProgress(cartBarVisible);
  document.body.classList.toggle('has-cart-bar',cartBarVisible || !deliveryOfferBanner.hidden);
}
get('cart-continue').onclick=()=>{
  checkout.scrollIntoView({block:'start'});
  checkout.elements.address.focus({preventScroll:true});
};
function productPhotoUrl(id) {
  const demoPhoto=catalog.demo && /^[a-z-]+-\d+(?:g|kg)$/.test(id);
  return '/api/photos/'+encodeURIComponent(id)+(demoPhoto ? '?demo=1' : '');
}
function drawCart() {
  const count=[...cart.values()].reduce((sum,item)=>sum+item.quantity,0);
  get('cart-count').textContent=count ? '('+count+')' : '';
  updateCartBar();
  for(const button of document.querySelectorAll('.add-to-cart')) {
    refreshCartButtons.get(button)?.();
  }
  checkout.hidden=!count;
  get('empty-cart').hidden=Boolean(count);
  if(!count) {
    get('cart').replaceChildren();
    return;
  }
  const rows=[...cart.values()].map(({product,quantity})=>{
    const row=node('article','','cart-item');
    const thumbnail=node('div','','cart-thumbnail');
    if(product.has_photo) {
      const image=node('img','');
      image.alt='';
      image.src=productPhotoUrl(product.id);
      image.onerror=()=>image.remove();
      thumbnail.append(image);
    }
    const details=node('div','','cart-item-details');
    details.append(node('h3',product.name),node('p',product.unit));
    const controls=node('div','','cart-item-controls');
    const stepper=node('div','','cart-stepper');
    for(const [delta,label,symbol] of [[-1,'Remove one','−'],[1,'Add one','+']]) {
      const button=action(symbol,()=>{
        change(product,quantity+delta);
        const next=[...get('cart').querySelectorAll('button')].find(item=>!item.disabled && item.getAttribute('aria-label')===button.getAttribute('aria-label'));
        (next ?? get('cart').querySelector('button:not(:disabled)') ?? (cart.size ? get('cart-continue') : get('browse'))).focus();
      });
      button.setAttribute('aria-label',label+' '+product.name+' '+product.unit);
      if(delta===1) {
        button.disabled=quantity>=Math.min(product.stock,50);
        stepper.append(node('span',String(quantity)));
      }
      stepper.append(button);
    }
    const price=node('p','','cart-item-price');
    if(product.original_price>product.price) price.append(node('s',money(product.original_price*quantity)));
    price.append(node('strong',money(product.price*quantity)));
    controls.append(stepper,price);
    row.append(thumbnail,details,controls);
    return row;
  });
  const breakdown=node('dl','','cart-breakdown');
  for(const [label,value] of [['Subtotal',subtotal()],...(coupon ? [['Coupon',-coupon.discount]] : []),['Delivery',deliveryFee()],['Total',payable()]]) {
    breakdown.append(node('dt',label),node('dd',label==='Delivery' && value===0 ? 'Free' : money(value)));
  }
  get('cart').replaceChildren(...rows,breakdown,node('p','Free delivery on subtotals above '+money(catalog.freeDeliveryThreshold)+' after discounts.'));
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
    image.src=productPhotoUrl(photoVariant.id);
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
  });
  button.className='add-to-cart';
  function updateCartButton() {
    const quantity=cart.get(variant.id)?.quantity ?? 0;
    const remaining=Math.min(variant.stock,50)-quantity;
    button.disabled=remaining<=0;
    button.classList.toggle('in-cart',quantity>0);
    button.textContent=!variant.stock ? 'Sold out' : button.disabled ? 'Pack limit reached' : 'Add to cart';
  }
  refreshCartButtons.set(button,updateCartButton);
  function updateTotal() {
    packButtons.forEach((choice,index)=>choice.setAttribute('aria-pressed',String(variants[index]===variant)));
    total.textContent=money(variant.price)+' per pack';
    updateCartButton();
  }
  updateTotal();
  card.append(node('h3',product.name));
  if(hasOffer) card.append(node('span','Offer','product-offer'));
  card.append(pack,total,button);
  return card;
}
function drawProductResults(container,products,search) {
  const query=search.trim().toLowerCase();
  const results=products.filter(({name,category})=>(name+' '+category).toLowerCase().includes(query));
  container.replaceChildren(...(results.length ? productCards(results) :
    [node('p',query ? 'No products found.' : 'No products available yet.')]));
}
function drawShop() {
  if(catalog) drawProductResults(get('products'),catalog.products,get('shop-search').value);
}
function drawCategory() {
  if(!catalog) return;
  get('category-title').textContent=category;
  for(const button of get('category-filter').children) button.setAttribute('aria-pressed',String(button.textContent===category));
  const products=catalog.products.filter(product=>product.category===category);
  drawProductResults(get('category-products'),products,get('category-search').value);
}
get('shop-search').oninput=drawShop;
get('category-search').oninput=drawCategory;
async function loadCatalog() {
  catalog=await api('catalog');
  get('catalog-mode').hidden=!catalog.demo;
  drawShop();
  const names=catalog.categories.map(item=>item.name);
  if(!names.includes(category)) category=names[0];
  get('category-filter').replaceChildren(...names.map(name=>action(name,()=>{category=name; drawCategory();})));
  const slots=get('slots');
  const selectedSlot=slots.value;
  slots.replaceChildren(...catalog.slots.map(slot=>new Option(slot.label,slot.id)));
  if(catalog.slots.some(slot=>slot.id===selectedSlot)) slots.value=selectedSlot;
  drawCategory();
  drawCart();
}
function refreshCatalog() {
  if(!catalogLoading) catalogLoading=loadCatalog().catch(error=>notice(error.message)).finally(()=>{catalogLoading=null;});
  return catalogLoading;
}
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden && document.querySelector('[data-page="home"]:not([hidden]), [data-page="categories"]:not([hidden]), [data-page="cart"]:not([hidden])')) refreshCatalog();
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
  for(const field of ['username','name','phone','address','lat','lon']) profileForm.elements[field].value=profile?.[field] ?? '';
  get('profile-location-status').textContent=profile?.lat!=null && profile?.lon!=null ? 'Delivery location saved.' : '';
}
async function loadProfile() {
  try { showProfile((await api('profile')).profile); }
  catch { showProfile(null); }
}
bind('send',async data=>{
  clearAuthErrors();
  if(!validateAuthForm(get('send'))) return;
  const email=data.get('email');
  const mode=authMode;
  const username=mode==='signup' ? data.get('username') : undefined;
  loginEmail=undefined;
  get('verify').hidden=true;
  get('verify').reset();
  get('login-status').textContent='';
  await api('auth/otp/request',{email,mode,username});
  if(mode!==authMode) return;
  loginEmail=email;
  loginUsername=username;
  get('verify').reset();
  get('verify').hidden=false;
  get('login-status').textContent='Code sent to '+email+'.';
  get('verify').elements.code.focus();
},error=>setAuthError(error.field==='username' ? 'username' : 'email',error.message));
bind('verify',async data=>{
  setAuthError('code');
  if(!validateAuthForm(get('verify'))) return;
  await api('auth/otp/verify',{email:loginEmail,username:loginUsername,code:data.get('code'),mode:authMode});
  await loadProfile();
  if (!profile) throw new Error('The browser could not save your session. Try again.');
  get('verify').hidden=true;
  get('verify').reset();
  get('send').reset();
  get('login-status').textContent='';
  location.replace('#'+returnPage);
},error=>setAuthError('code',error.message));
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
    coupon=undefined;
    get('coupon-status').textContent='';
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
  const status=get('profile-save-status');
  status.classList.remove('auth-field-error');
  status.textContent='';
  const result=await api('profile',{...Object.fromEntries(data),...coordinates(profileForm)});
  showProfile(result.profile);
  status.textContent='Profile saved.';
},error=>{
  const status=get('profile-save-status');
  status.classList.add('auth-field-error');
  status.textContent=error.message;
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
checkout.elements.coupon.oninput=()=>{
  coupon=undefined;
  get('coupon-status').textContent='';
  drawCart();
};
get('apply-coupon').onclick=async event=>{
  if(!profile) return signInFrom('cart');
  const button=event.currentTarget;
  const code=checkout.elements.coupon.value;
  const amount=subtotal();
  button.disabled=true;
  try {
    const quote=await api('coupons/quote',{code,items:[...cart.values()].map(({product,quantity})=>({id:product.id,quantity}))});
    if(code!==checkout.elements.coupon.value || amount!==subtotal() || !profile) return;
    coupon=quote;
    get('coupon-status').textContent=quote.code+' applied';
    drawCart();
  } catch(error) { get('coupon-status').textContent=error.message; }
  finally { button.disabled=false; }
};
bind('checkout',async data=>{
  if(!cart.size) throw new Error('Add products before placing an order.');
  if(!profile) return signInFrom('cart');
  const point=coordinates(checkout);
  if(point.lat===null || point.lon===null) throw new Error('Use your current location or a saved address before placing an order.');
  const order={...coordinates(checkout),address:data.get('address'),phone:data.get('phone'),slot:data.get('slot'),
    consent:data.has('consent'),coupon:coupon?.code,total:payable(),items:[...cart.values()].map(({product,quantity})=>({id:product.id,quantity}))};
  const fingerprint=JSON.stringify(order);
  if(pending?.fingerprint!==fingerprint) pending={fingerprint,key:crypto.randomUUID()};
  let result;
  try { result=await api('orders',order,{'Idempotency-Key':pending.key}); }
  catch(error) {
    if(error.status!==401) {
      if(error.status===409) await refreshCatalog();
      throw error;
    }
    showProfile(null);
    return signInFrom('cart');
  }
  cart.clear();
  coupon=undefined;
  checkout.elements.coupon.value='';
  get('coupon-status').textContent='';
  pending=null;
  drawCart();
  get('receipt').textContent='Order placed · '+result.order.id+' · '+money(result.order.total);
  loadCatalog().catch(error=>notice(error.message));
});
async function loadOrders(offset=0) {
  const request=++orderRequest;
  const history=get('history');
  get('more-orders').hidden=true;
  get('empty-orders').hidden=true;
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
    else {
      history.replaceChildren(...cards);
      get('empty-orders').hidden=cards.length>0;
    }
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
  clearAuthErrors();
  get('profile-save-status').textContent='';
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
    get('signup-username').hidden=mode!=='signup';
    get('send').elements.username.disabled=mode!=='signup';
    get('auth-title').textContent=mode==='signup' ? 'Create your account' : 'Sign in';
    get('auth-description').textContent=mode==='signup' ? 'Choose a username and verify your email to get started.' : 'We’ll email you a six-digit sign-in code.';
    get('send-auth-code').textContent=mode==='signup' ? 'Send verification code' : 'Send sign-in code';
    const link=node('a',mode==='signup' ? 'Sign in' : 'Create an account');
    link.href=mode==='signup' ? '#login' : '#signup';
    get('auth-alternative').replaceChildren(mode==='signup' ? 'Already have an account? ' : 'New here? ',link);
    get('auth-back').href='#'+returnPage;
    get('auth-back').textContent=returnPage==='cart' ? 'Back to cart' : 'Back to shopping';
  } else if(!catalog || page==='home' || page==='categories' || page==='cart') {
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
