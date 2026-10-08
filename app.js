const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const LS={users:'velora_users_v1',session:'velora_session_v1',products:'velora_products_v1',orders:'velora_orders_v1',tickets:'velora_tickets_v1'};
const get=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}},set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=m=>{const t=document.createElement('div');t.className='toast';t.textContent=m;$('#toasts').append(t);setTimeout(()=>t.remove(),3200)};
const hash=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return 'h'+h};
const faNum=n=>Number(n).toLocaleString('fa-IR');
const normPhone=p=>(p||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\D/g,'');
function seedProducts(){if(localStorage.getItem(LS.products))return;set(LS.products,[
{id:'p1',title:'Vehicle Plate',value:'TURK',cat:'plate',price:1000,rare:'LEGENDARY',sold:false},
{id:'p2',title:'Phone Number',value:'9122064055',cat:'phone',price:700,rare:'LEGENDARY',sold:true},
{id:'p3',title:'Phone Number',value:'9123333444',cat:'phone',price:875,rare:'LEGENDARY',sold:true},
{id:'p4',title:'Vehicle Plate',value:'VELORA',cat:'plate',price:1500,rare:'EPIC',sold:false},
{id:'p5',title:'Phone Number',value:'9120001122',cat:'phone',price:120,rare:'RARE',sold:false},
])}
seedProducts();
const session=()=>get(LS.session,null);
const currentUser=()=>{const s=session();if(!s)return null;return get(LS.users,[]).find(u=>u.id===s.id)||null};
function requireAuth(action='خرید'){const u=currentUser();if(!u){toast('برای '+action+' باید وارد حساب شوید — انتقال به ساخت اکانت');location.hash='#/auth';return null}return u}
// ROUTER
const pages={home:'page-home',shop:'page-shop',auth:'page-auth',dashboard:'page-dashboard',team:'page-team',blog:'page-blog',streamers:'page-streamers'};
function router(){let h=(location.hash||'#/home').replace('#/','').split('?')[0];if(!pages[h])h='home';
if(h==='dashboard'&&!currentUser()){toast('اول وارد حساب شوید');h='auth'}
$$('.page').forEach(p=>p.classList.remove('active'));$('#page-'+h).classList.add('active');
$$('#mainNav a').forEach(a=>a.classList.toggle('active',a.dataset.nav===h));
if(h==='auth'&&currentUser()){location.hash='#/dashboard';return}
if(h==='dashboard')renderMe();if(h==='shop')renderShop();updateNotif();
window.scrollTo({top:0});}
window.addEventListener('hashchange',router);
// NAV
$$('[data-go]').forEach(b=>b.onclick=()=>location.hash=b.dataset.go);
$('#menuBtn').onclick=()=>$('#mainNav').classList.toggle('open');
$('#avatarBtn').onclick=()=>{location.hash=currentUser()?'#/dashboard':'#/auth'};
$('#enterCityBtn').onclick=()=>{if(!requireAuth('ورود به شهر'))return;location.hash='#/dashboard'};
$('#notifBtn').onclick=()=>{const p=$('#notifPanel');p.classList.toggle('hidden');p.innerHTML=currentUser()?`<b>اعلان‌ها</b><p class="muted">به ولورا خوش برگشتید، ${esc(currentUser().user)} ♠</p><p class="muted">ایونت هفتگی جمعه ساعت ۲۰</p>`:`<b>اعلان‌ها</b><p class="muted">وارد شوید تا اعلان‌ها را ببینید.</p>`};
function updateNotif(){$('#notifDot').classList.toggle('hidden',!!currentUser())}
// AUTH TABS
$$('.tab').forEach(t=>t.onclick=()=>{$$('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');
const isR=t.dataset.tab==='register';$('#registerForm').classList.toggle('hidden',!isR);$('#loginForm').classList.toggle('hidden',isR);$('#authTitle').textContent=isR?'ثبت نام':'ورود';});
$('#swapToLogin').onclick=e=>{e.preventDefault();document.querySelector('[data-tab="login"]').click()};
$('#registerForm').onsubmit=e=>{e.preventDefault();
const user=$('#rUser').value.trim(),phone=normPhone($('#rPhone').value),email=$('#rEmail').value.trim().toLowerCase(),p1=$('#rPass').value,p2=$('#rPass2').value;
const err=$('#rErr');const fail=m=>err.textContent=m;
if(user.length<3) return fail('نام کاربری حداقل ۳ کاراکتر باشد');
if(!/^[a-zA-Z0-9._-]{3,20}$/.test(user)) return fail('نام کاربری فقط حروف انگلیسی، عدد و . _ -');
if(!/^09\d{9}$/.test(phone)) return fail('شماره موبایل معتبر نیست (مثل 09123456789)');
if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('ایمیل معتبر نیست');
if(p1.length<6) return fail('رمز حداقل ۶ کاراکتر باشد');
if(p1!==p2) return fail('تکرار رمز مطابقت ندارد');
const users=get(LS.users,[]);
if(users.some(u=>u.user.toLowerCase()===user.toLowerCase())) return fail('این نام کاربری قبلا ثبت شده');
if(users.some(u=>u.email===email)) return fail('این ایمیل قبلا ثبت شده');
const nu={id:'u'+Date.now(),user,phone,email,pass:hash(p1),created:new Date().toISOString(),avatar:''};
users.push(nu);set(LS.users,users);set(LS.session,{id:nu.id});
err.textContent='';toast('حساب ولورا ساخته شد ♠');location.hash='#/dashboard';};
$('#loginForm').onsubmit=e=>{e.preventDefault();
const id=$('#lUser').value.trim().toLowerCase(),p=$('#lPass').value;const err=$('#lErr');
if(!id||!p) return err.textContent='نام کاربری و رمز را وارد کنید';
const u=get(LS.users,[]).find(u=>u.user.toLowerCase()===id||u.email===id);
if(!u||u.pass!==hash(p)) return err.textContent='نام کاربری یا رمز اشتباه است';
set(LS.session,{id:u.id});err.textContent='';toast('خوش برگشتید '+u.user);location.hash='#/dashboard';};
// DASHBOARD
$$('.side-btn[data-dash]').forEach(b=>b.onclick=()=>{$$('.side-btn[data-dash]').forEach(x=>x.classList.remove('active'));b.classList.add('active');
$$('.dash-pane').forEach(p=>p.classList.remove('active'));$('#dash-'+b.dataset.dash).classList.add('active')});
function renderMe(){const u=currentUser();if(!u)return;$('#meName').textContent=u.user;$('#meRole').textContent='عضو ولورا';
$('#meAvatar').innerHTML=u.avatar?`<img src="${u.avatar}"/>`:'V';
$('#accInfo').textContent=JSON.stringify({user:u.user,phone:u.phone,email:u.email,created:u.created},null,2);
const orders=get(LS.orders,[]).filter(o=>o.uid===u.id);
$('#myOrders').innerHTML=orders.length?orders.map(o=>`<div>✔ ${esc(o.title)} — ${faNum(o.price)} تومان</div>`).join(''):'هنوز خریدی ثبت نشده.';
const tk=get(LS.tickets,[]).filter(t=>t.uid===u.id);$('#ticketList').innerHTML=tk.map(t=>`<div class="card" style="margin-top:8px"><b>${esc(t.sub)}</b><p class="muted">${esc(t.msg)}</p></div>`).join('');}
$('#logoutBtn').onclick=()=>{localStorage.removeItem(LS.session);toast('خارج شدید');location.hash='#/home'};
$$('.queueBtn').forEach(b=>b.onclick=()=>{const u=requireAuth('ورود به صف');if(u)toast('در صف قرار گرفتید — موقعیت ۱۲');});
$$('.linkBtn').forEach(b=>b.onclick=()=>toast('به‌زودی: اتصال حساب'));
$('#toggleInfo').onclick=()=>$('#accInfo').classList.toggle('hidden');
$('#avatarSave').onclick=()=>{const u=currentUser();const f=$('#avatarInp').files[0];if(!f)return toast('فایلی انتخاب نشده');
if(f.size>500*1024)return toast('حجم عکس حداکثر ۵۰۰ کیلوبایت');
const r=new FileReader();r.onload=()=>{const users=get(LS.users,[]);const i=users.findIndex(x=>x.id===u.id);users[i].avatar=r.result;set(LS.users,users);renderMe();toast('عکس پروفایل ذخیره شد')};r.readAsDataURL(f)};
$('#ticketBtn').onclick=()=>{const u=requireAuth('ثبت تیکت');if(!u)return;const sub=$('#ticketSub').value.trim(),msg=$('#ticketMsg').value.trim();
if(!sub||!msg)return toast('موضوع و متن تیکت الزامی است');const all=get(LS.tickets,[]);all.push({uid:u.id,sub,msg,at:Date.now()});set(LS.tickets,all);$('#ticketSub').value='';$('#ticketMsg').value='';renderMe();toast('تیکت ارسال شد')};
// SHOP
function cardHTML(p){return `<div class="p-card ${p.cat==='plate'?'plate':''}"><span class="rare">♠ ${esc(p.rare)}</span>
<div class="p-visual"><div class="sub">— FOR SALE —</div><div class="neon">${esc(p.value)}</div></div>
<div class="p-body"><h4>${esc(p.title)}</h4><small>${esc(p.value)}</small>
<div class="p-foot">${p.sold?`<button class="sold" disabled>فروخته شد</button>`:`<button class="btn primary small" onclick="buyItem('${p.id}')">خرید</button>`}<span class="p-price">${faNum(p.price)} <small>تومان</small></span></div></div></div>`}
window.buyItem=id=>{const u=requireAuth('خرید آیتم');if(!u)return;
const all=get(LS.products,[]);const p=all.find(x=>x.id===id);if(!p||p.sold)return toast('این آیتم فروخته شده');
if(!confirm(`خرید «${p.title} ${p.value}» به مبلغ ${p.price} تومان؟`))return;
p.sold=true;set(LS.products,all);const o=get(LS.orders,[]);o.push({uid:u.id,title:p.title+' '+p.value,price:p.price,at:Date.now()});set(LS.orders,o);renderShop();toast('خرید با موفقیت ثبت شد ♠')};
function renderShop(){const all=get(LS.products,[]);
$('#featuredRow').innerHTML=all.slice(0,3).map(cardHTML).join('');
let list=[...all];
const q=($('#searchInp').value||'').trim().toLowerCase();
const cat=document.querySelector('input[name=cat]:checked').value;
const pf=$$('.priceF').filter(c=>c.checked).map(c=>c.value.split('-').map(Number));
const sort=$('#sortSel').value;
if(cat!=='all')list=list.filter(p=>p.cat===cat);
if(q)list=list.filter(p=>(p.title+p.value).toLowerCase().includes(q));
if(pf.length)list=list.filter(p=>pf.some(([a,b])=>p.price>=a&&p.price<=b));
if(sort==='cheap')list.sort((a,b)=>a.price-b.price);if(sort==='exp')list.sort((a,b)=>b.price-a.price);
$('#filterCount').textContent=(cat!=='all'?1:0)+pf.length+(q?1:0);
$('#productGrid').innerHTML=list.length?list.map(cardHTML).join(''):'<p class="muted">محصولی یافت نشد.</p>';}
['searchInp','sortSel'].forEach(id=>$('#'+id).addEventListener('input',renderShop));
$$('input[name=cat]').forEach(r=>r.onchange=renderShop);$$('.priceF').forEach(c=>c.onchange=renderShop);
$('#clearFilters').onclick=()=>{$('#searchInp').value='';document.querySelector('input[name=cat][value=all]').checked=true;$$('.priceF').forEach(c=>c.checked=false);renderShop()};
// ADD ITEM (requires auth -> else redirect to register)
$('#openAddBtn').onclick=()=>{if(!requireAuth('افزودن آیتم'))return;$('#addModal').classList.remove('hidden')};
$('#addCancel').onclick=()=>$('#addModal').classList.add('hidden');
$('#addSave').onclick=()=>{const u=currentUser();if(!u){$('#addModal').classList.add('hidden');return requireAuth('افزودن آیتم')};
const t=$('#nTitle').value.trim(),v=$('#nValue').value.trim(),c=$('#nCat').value,pr=Number($('#nPrice').value),r=$('#nRare').value;
const err=$('#nErr');
if(t.length<2)return err.textContent='عنوان معتبر نیست';
if(v.length<2)return err.textContent='مقدار / شماره معتبر نیست';
if(!Number.isFinite(pr)||pr<=0)return err.textContent='قیمت باید عدد مثبت باشد';
if(pr>1000000)return err.textContent='قیمت خیلی بالاست';
const all=get(LS.products,[]);
if(all.some(p=>p.value.toLowerCase()===v.toLowerCase()))return err.textContent='این مقدار قبلا ثبت شده (تکراری)';
all.unshift({id:'p'+Date.now(),title:esc(t),value:esc(v),cat:c,price:Math.floor(pr),rare:r,sold:false,by:u.user});
set(LS.products,all);err.textContent='';$('#addModal').classList.add('hidden');
$('#nTitle').value='';$('#nValue').value='';$('#nPrice').value='';
renderShop();toast('آیتم جدید با موفقیت اضافه شد')};
router();renderShop();
