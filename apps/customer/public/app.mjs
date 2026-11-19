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
  else {
    // Re-insert so this item is placed at the end of the Map (latest added)
    cart.delete(product.id);
    cart.set(product.id,{product,quantity});
  }
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
    bar.hidden=!hasOffer || bar.closest('#cart-bar, #cart-checkout-bar')?.hidden;
    if(bar.hidden) continue;
    // Prices are in paise and the subtotal must exceed the published threshold.
    const goal=threshold+1;
    const amount=Math.max(0,discountedSubtotal());
    const remaining=Math.max(0,goal-amount);
    const progress=bar.querySelector('progress');
    if(progress) {
      progress.max=goal;
      progress.value=Math.min(amount,goal);
    }
    const status=bar.querySelector('.delivery-progress-status');
    const message=remaining ? 'Add '+money(remaining)+' more for free delivery' : '🎉 Free delivery unlocked!';
    if(status && status.textContent!==message) status.textContent=message;
    const fill=bar.querySelector('.cart-bar-progress-fill');
    if(fill) {
      const pct=Math.min(100,Math.round((amount/goal)*100));
      fill.style.width=pct+'%';
      fill.classList.toggle('unlocked',!remaining);
    }
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
  const items=[...cart.values()];
  const count=items.reduce((sum,item)=>sum+item.quantity,0);
  get('cart-bar-count').textContent=count+' '+(count===1 ? 'item' : 'items')+' · '+money(subtotal());
  const onShopView = !['#cart','#orders','#profile','#welcome','#login','#signup'].includes(location.hash);
  get('cart-bar').hidden=!count || !onShopView;
  get('cart-checkout-bar').hidden=!count || location.hash!=='#cart';
  get('cart-pay-total').textContent=count ? money(payable()) : '';

  const thumbsContainer=get('cart-pill-thumbs');
  if(thumbsContainer) {
    if(count>0) {
      // Up to latest 3 unique products added (natural DOM stacking order matches reference)
      const latestItems=items.slice(-3);
      thumbsContainer.replaceChildren(
        ...latestItems.map(({ product })=>{
          const img=document.createElement('img');
          img.className='cart-pill-thumb';
          img.alt=product.name;
          img.src=productPhotoUrl(product);
          img.onerror=()=>{
            if (!img.dataset.fallback) {
              img.dataset.fallback = '1';
              img.src = '/logo.jpg';
            } else {
              img.style.display = 'none';
            }
          };
          return img;
        })
      );
      thumbsContainer.hidden=false;
    } else {
      thumbsContainer.replaceChildren();
      thumbsContainer.hidden=true;
    }
  }

  const cartBarVisible=!get('cart-bar').hidden || !get('cart-checkout-bar').hidden;
  updateDeliveryProgress(cartBarVisible);
  document.body.classList.toggle('has-cart-bar',cartBarVisible || !deliveryOfferBanner.hidden);
}
get('cart-continue').onclick=()=>{
  checkout.scrollIntoView({block:'start'});
  checkout.elements.address.focus({preventScroll:true});
};
const staticProducePhotos=new Set([
  'aalu','beans','beetroot','bendakaya','black-mirchi','black-vankaya',
  'cabbage','capsicum','carrot','cauliflower','chamagada','chikudukaya',
  'dondakaya','kira','munakaya','onion','podugu-vankaya','sweet-potato',
  'tomato','white-mirchi','white-vankaya'
]);
function productPhotoUrl(product) {
  if(!product) return '';
  const photo = typeof product === 'object' ? (product.photo || product.id) : product;
  const slug = String(photo).replace(/-(?:250g|500g|1kg)$/, '').toLowerCase();
  if (staticProducePhotos.has(slug)) {
    return '/photos/' + slug + '.jpg';
  }
  const id = typeof product === 'object' ? product.id : product;
  return '/api/photos/' + encodeURIComponent(id);
}
function drawCart() {
  const count=[...cart.values()].reduce((sum,item)=>sum+item.quantity,0);
  get('cart-count').textContent=count ? String(count) : '';
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
      image.alt=product.name;
      image.decoding='async';
      image.src=productPhotoUrl(product);
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
  const itemsWrap=node('div','','cart-items-card');
  const itemsHeader=node('div','','cart-items-card-header');
  itemsHeader.append(
    node('h2',`Items in cart (${cart.size})`),
    node('span',`${count} ${count===1 ? 'pack' : 'packs'} total`,'cart-items-total-pill')
  );
  itemsWrap.append(itemsHeader,...rows);
  const billWrap=node('div','','bill-summary-card');
  billWrap.append(node('h2','Bill summary'));
  const breakdown=node('dl','','cart-breakdown');
  for(const [label,value] of [['Subtotal',subtotal()],...(coupon ? [['Coupon ('+coupon.code+')',-coupon.discount]] : []),['Delivery',deliveryFee()],['Total payable',payable()]]) {
    const dt=node('dt',label);
    const dd=node('dd',label==='Delivery' && value===0 ? 'FREE' : money(value));
    if(label==='Delivery' && value===0) dd.className='free-pill';
    if(value<0) dd.className='savings-value';
    breakdown.append(dt,dd);
  }
  const thresholdNote=node('p',deliveryFee()===0
    ? '✓ Free delivery unlocked on this order!'
    : 'Free delivery on subtotals above '+money(catalog.freeDeliveryThreshold)+' after discounts.','bill-note');
  billWrap.append(breakdown,thresholdNote);
  get('cart').replaceChildren(itemsWrap,billWrap);
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
  const photoVariant=variants.find(option=>option.has_photo);
  if(photoVariant) {
    const image=document.createElement('img');
    image.alt=product.name;
    image.decoding='async';
    image.src=productPhotoUrl(photoVariant);
    image.onerror=()=>{
      if(!image.dataset.retried) {
        image.dataset.retried='1';
        image.src='/api/photos/'+encodeURIComponent(photoVariant.id);
        return;
      }
      image.remove();
      media.append(node('span','Photo unavailable'));
    };
    media.append(image);
  } else {
    media.append(node('span','Photo unavailable'));
  }
  card.append(media);
  const allTags = JSON.parse(product.tags ?? '[]');
  const hasTagOffer = allTags.some(t => typeof t === 'string' && t.toLowerCase() === 'offer');
  const tags = allTags
    .filter(t => typeof t === 'string' && t.toLowerCase() !== 'offer')
    .sort((a,b) => Number(b === "Today's special") - Number(a === "Today's special"));
  let maxDiscount = 0;
  for (const option of variants) {
    if (option.original_price > option.price) {
      const pct = Math.round(((option.original_price - option.price) / option.original_price) * 100);
      if (pct > maxDiscount) maxDiscount = pct;
    }
  }
  const hasOffer = maxDiscount > 0 || hasTagOffer;
  if(tags.length) {
    const badges=node('div','','photo-tags');
    for(const tag of tags) {
      const tagSlug = tag.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const isSpecial = tag === "Today's special";
      badges.append(node('span', tag, 'tag-badge tag-badge-' + tagSlug + (isSpecial ? ' featured' : '')));
    }
    media.append(badges);
  }
  if(hasOffer) {
    const offerLabel = maxDiscount > 0 ? `${maxDiscount}% OFF` : 'Offer';
    const offerBadge = node('span', offerLabel, 'product-offer-badge');
    media.append(offerBadge);
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
  if(!catalog) return;
  const query=get('shop-search').value.trim();
  const list=query ? catalog.products : catalog.products.filter(product=>product.category==='Vegetables');
  drawProductResults(get('products'),list.length ? list : catalog.products,query);
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
  if(slots) {
    if(slots.tagName==='SELECT') {
      const selectedSlot=slots.value;
      slots.replaceChildren(...catalog.slots.map(slot=>new Option(slot.label,slot.id)));
      if(catalog.slots.some(slot=>slot.id===selectedSlot)) slots.value=selectedSlot;
    } else {
      if(catalog.slots && catalog.slots.length>0) slots.value=catalog.slots[0].id;
    }
  }
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
  const displayName=profile ? (profile.name || profile.username || 'My profile') : 'Welcome!';
  get('profile-name').textContent=displayName;
  get('profile-avatar').textContent=(profile ? (profile.name || profile.username || profile.email) : 'M').trim().charAt(0).toUpperCase() || 'M';
  const badge=get('profile-badge');
  badge.textContent=profile ? '✓ Verified' : 'Guest';
  badge.classList.toggle('signed-in',Boolean(profile));
  get('account').textContent=profile ? (profile.username && profile.name && profile.username !== profile.name ? profile.username + ' · ' + profile.email : profile.email) : 'Sign in to save your delivery details and track orders.';
  get('logout').hidden=!profile;
  get('profile-signin').hidden=Boolean(profile);
  get('checkout-signin').hidden=Boolean(profile);
  get('place-order').hidden=!profile;
  profileForm.hidden=!profile;
  get('use-saved').disabled=!profile?.address;
  for(const field of ['username','name','phone','address','lat','lon']) profileForm.elements[field].value=profile?.[field] ?? '';
  get('profile-location-status').textContent=profile?.lat!=null && profile?.lon!=null ? 'Delivery location saved.' : 'Pin your GPS location for 1-tap checkout.';
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
  const el=get(status);
  el.classList.remove('status-ok','status-error');
  try {
    const {eligible,distanceKm}=await api('delivery/check',point);
    const current=coordinates(form);
    if(point.lat!==current.lat || point.lon!==current.lon) return;
    const dist=Number.isFinite(distanceKm) ? ` (${distanceKm.toFixed(1)} km)` : '';
    el.textContent=eligible ? '✓ Delivery available'+dist : 'Outside our delivery area'+dist+'.';
    el.classList.add(eligible ? 'status-ok' : 'status-error');
    if(copyToCheckout && eligible) {
      checkout.elements.lat.value=point.lat;
      checkout.elements.lon.value=point.lon;
      const checkoutStatus=get('delivery-status');
      checkoutStatus.textContent='✓ Delivery available'+dist;
      checkoutStatus.classList.remove('status-error');
      checkoutStatus.classList.add('status-ok');
    }
  } catch(error) {
    el.textContent=error.message;
    el.classList.add('status-error');
  }
}
const preview=get('delivery-preview');
preview.onsubmit=event=>event.preventDefault();
locate('preview-locate',preview,'preview-status',()=>checkDelivery(preview,'preview-status',true));
locate('locate',checkout,'delivery-status',()=>checkDelivery(checkout,'delivery-status'));
locate('profile-locate',profileForm,'profile-location-status',async()=>{
  await checkDelivery(profileForm,'profile-location-status');
  const status=get('profile-location-status');
  status.textContent+=' Save your profile to keep it.';
});
checkout.elements.coupon.oninput=()=>{
  coupon=undefined;
  const status=get('coupon-status');
  status.textContent='';
  status.classList.remove('status-ok','status-error');
  drawCart();
};
get('apply-coupon').onclick=async event=>{
  if(!profile) return signInFrom('cart');
  const button=event.currentTarget;
  const status=get('coupon-status');
  const code=checkout.elements.coupon.value;
  const amount=subtotal();
  status.classList.remove('status-ok','status-error');
  button.disabled=true;
  try {
    const quote=await api('coupons/quote',{code,items:[...cart.values()].map(({product,quantity})=>({id:product.id,quantity}))});
    if(code!==checkout.elements.coupon.value || amount!==subtotal() || !profile) return;
    coupon=quote;
    status.textContent='✓ '+quote.code+' applied — saved '+money(quote.discount);
    status.classList.add('status-ok');
    drawCart();
  } catch(error) {
    status.textContent=error.message;
    status.classList.add('status-error');
  }
  finally { button.disabled=false; }
};
let lastPlacedOrderId = null;
bind('checkout',async data=>{
  if(!cart.size) throw new Error('Add products before placing an order.');
  if(!profile) return signInFrom('cart');
  const point=coordinates(checkout);
  if(point.lat===null || point.lon===null) throw new Error('Use your current location or a saved address before placing an order.');
  const slotVal=data.get('slot') || get('slots')?.value || catalog?.slots?.[0]?.id || 'morning-slot';
  const order={...coordinates(checkout),address:data.get('address'),phone:data.get('phone'),slot:slotVal,
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
  const orderedLines=[...cart.values()].map(({product,quantity})=>`• ${product.name} (${product.unit}) × ${quantity} = ${money(product.price*quantity)}`);
  const slotLabel='Next day delivery';
  const appliedCoupon=coupon;
  const placedOrderId=result.order.id;
  const shortId=String(placedOrderId).slice(0,8).toUpperCase();
  cart.clear();
  coupon=undefined;
  checkout.elements.coupon.value='';
  get('coupon-status').textContent='';
  pending=null;
  drawCart();
  lastPlacedOrderId = placedOrderId;
  notice('🎉 Order #' + shortId + ' placed successfully! Delivery next day.');
  location.hash = '#orders';
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
    const adminWa=catalog?.adminWhatsApp || '919398750721';
    const cards=result.orders.map(order=>{
      const isJustPlaced = order.id === lastPlacedOrderId;
      const statusClass = ' order-status-' + (order.status || '').toLowerCase();
      const card=node('article','','card order-card' + (isJustPlaced ? ' order-newly-placed' : '') + statusClass);
      const shortId=String(order.id).slice(0,8).toUpperCase();
      const statusIcon = { Placed:'🟠', Confirmed:'🟢', Delivered:'✅', Rejected:'❌' }[order.status] ?? '📦';
      const statusText = {
        Placed: 'Waiting for Admin Acceptance',
        Confirmed: 'Order Accepted · Delivery Tomorrow',
        Delivered: 'Order Delivered',
        Rejected: 'Order Rejected'
      }[order.status] ?? order.status;

      // Banner for newly placed order
      if (isJustPlaced) {
        const justPlacedBanner = node('div', '', 'order-newly-placed-banner');
        justPlacedBanner.append(node('span', '🟠 Order placed! Waiting for admin acceptance. Delivery tomorrow.'));
        card.append(justPlacedBanner);
      }

      // 1. Head (Status badge + Total payable)
      const head=node('div','','order-card-head');
      const badge=node('div','','order-status-badge order-status-'+(order.status || '').toLowerCase());
      badge.append(node('span', statusIcon + ' ' + statusText));

      const priceWrap=node('div','','order-card-price-wrap');
      priceWrap.append(node('small','Total payable:'), node('strong',money(order.total),'order-card-total'));
      head.append(badge, priceWrap);

      // 2. Meta bar (Order ID, Date, Delivery schedule)
      const dateStr = new Date(order.created).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
      const meta=node('div','','order-card-meta-bar');
      meta.append(
        node('span','Order #' + shortId,'order-card-id'),
        node('span',' · ' + dateStr),
        node('span',' · 🚚 Next day delivery','order-card-delivery-tag')
      );

      // Parse items
      const items=JSON.parse(order.items || '[]');
      const totalPacks = items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);

      // 3. Count summary pill
      const countPill=node('div','','order-count-summary');
      countPill.append(
        node('span', `📦 ${items.length} ${items.length===1 ? 'item' : 'items'} · ${totalPacks} ${totalPacks===1 ? 'pack' : 'packs'} total`)
      );

      // 4. Structured Itemized List with S.No. and Quantity
      const itemsTable=node('div','','order-items-table');
      items.forEach((item, index) => {
        const row=node('div','','order-item-row');
        const sno=node('span', `${index + 1}.`, 'order-item-sno');
        
        const details=node('div','','order-item-details');
        details.append(
          node('strong', item.name || 'Vegetable', 'order-item-name'),
          node('span', item.unit ? ` (${item.unit})` : '', 'order-item-unit')
        );

        const qtyBadge=node('span', `Qty: ${item.quantity || 1}`, 'order-item-qty');
        
        const itemPrice = Number(item.price || 0);
        const priceSpan=node('span', itemPrice > 0 ? money(itemPrice * (item.quantity || 1)) : '', 'order-item-price');

        row.append(sno, details, qtyBadge, priceSpan);
        itemsTable.append(row);
      });

      // 5. Bill summary
      const subtotal = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1), 0);
      const fee = Number(order.fee || 0);
      const discount = Math.max(0, (subtotal + fee) - Number(order.total || 0));

      const billBox=node('div','','order-bill-box');
      const billDl=node('dl','','order-bill-dl');
      if (subtotal > 0) {
        billDl.append(node('dt','Items subtotal:'), node('dd',money(subtotal)));
      }
      if (discount > 0) {
        billDl.append(node('dt','Coupon discount:'), node('dd','-' + money(discount)));
      }
      billDl.append(
        node('dt','Delivery fee:'), node('dd',fee === 0 ? 'FREE' : money(fee)),
        node('dt','Total payable:'), node('dd',money(order.total))
      );
      billBox.append(billDl);

      // 6. Delivery Address Box
      const addressBox=node('div','','order-address-box');
      addressBox.append(
        node('p', `📍 Delivery address: ${order.address || 'Standard address'}`),
        node('p', `📞 Mobile: ${order.phone || ''}`)
      );

      // 7. Footer (WhatsApp Store Button with itemized message)
      const foot=node('div','','order-card-foot');
      const isSent = localStorage.getItem('wa_sent_' + order.id) === '1';

      const waItemLines = items.map((item, idx) => `${idx + 1}. ${item.name} (${item.unit}) × ${item.quantity} = ${money((item.price || 0) * (item.quantity || 1))}`);
      const waInvoiceText = [
        '*Manankuragayalu — Order Invoice*',
        `Order ID: #${shortId} (${order.id})`,
        `Date: ${dateStr}`,
        `Status: ${statusText}`,
        `Phone: ${order.phone}`,
        `Delivery Address: ${order.address}`,
        `Delivery Schedule: Next day delivery`,
        '',
        `*Ordered Items (${items.length} items · ${totalPacks} packs):*`,
        ...waItemLines,
        '',
        ...(subtotal > 0 ? [`Subtotal: ${money(subtotal)}`] : []),
        ...(discount > 0 ? [`Coupon Discount: -${money(discount)}`] : []),
        `Delivery Fee: ${fee === 0 ? 'FREE' : money(fee)}`,
        `*Total Payable on Delivery: ${money(order.total)}*`,
        'Payment Method: Cash on Delivery / UPI',
        '',
        'Hi Manankuragayalu, here are my complete order details. Please confirm delivery for tomorrow!'
      ].join('\n');
      const waUrl = 'https://wa.me/' + adminWa + '?text=' + encodeURIComponent(waInvoiceText);

      const waBtn = node('button', isSent ? '✓ Sent to WhatsApp' : '📲 WhatsApp Store', 'wa-btn' + (isSent ? ' wa-btn-disabled' : ''));
      waBtn.type = 'button';
      if (isSent) {
        waBtn.disabled = true;
      } else {
        waBtn.onclick = () => {
          window.open(waUrl, '_blank', 'noopener,noreferrer');
          localStorage.setItem('wa_sent_' + order.id, '1');
          waBtn.textContent = '✓ Sent to WhatsApp';
          waBtn.classList.add('wa-btn-disabled');
          waBtn.disabled = true;
        };
      }

      foot.append(node('small', 'Cash / UPI on delivery'), waBtn);
      card.append(head, meta, countPill, itemsTable, billBox, addressBox, foot);
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
  currentCustomerPage = page;
  if(page==='orders') loadOrders();
}

let currentCustomerPage = 'home';
function navigateTab(targetHref) {
  const aliases = {'categories-nav':'categories','cart-section':'cart','my-orders':'orders','catalog':'home','support':'profile'};
  const cleanTarget = targetHref.replace(/^#/, '');
  const targetPage = aliases[cleanTarget] ?? cleanTarget;
  const tabPages = ['home','categories','cart','orders','profile','delivery'];
  if (tabPages.includes(targetPage)) {
    if (targetPage === 'home') {
      window.history.replaceState(null, '', '#home');
    } else if (currentCustomerPage === 'home') {
      window.history.pushState(null, '', '#' + targetPage);
    } else {
      window.history.replaceState(null, '', '#' + targetPage);
    }
    showPage();
    return true;
  }
  return false;
}

document.addEventListener('click', event => {
  const anchor = event.target.closest('a[href^="#"]');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href || href === '#') return;
  if (navigateTab(href)) {
    event.preventDefault();
  }
});

drawCart();
loadProfile().then(()=>{
  window.addEventListener('hashchange',showPage);
  showPage();
});
