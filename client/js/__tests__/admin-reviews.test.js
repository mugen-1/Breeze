const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../../admin.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../../css/admin.css'),'utf8');
const section=html.match(/<section id="view-reviews"[\s\S]*?<\/section>/)[0];
const navViews={dashboard:'view-dashboard',products:'tab-products',orders:'tab-orders',statistics:'view-statistics',users:'view-users',reviews:'view-reviews',blacklist:'view-blacklist'};
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const VISIBLE=freeze({id:51,user:{displayName:'Reviewer <script>'},product:{name:'Product <img>',imageUrl:'img/ao1.png'},rating:4,
  comment:'Full comment <b>text</b> '+('Long comment. '.repeat(25)),createdAt:'2026-10-14T13:32:00Z',updatedAt:'2026-10-15T01:00:00Z',
  variant:{id:71,size:'M lúc mua',color:'Đen lúc mua'},verifiedPurchase:true,status:'visible',images:[{url:'/review-images/'+ 'a'.repeat(32)+'.webp'}]});
const HIDDEN=freeze({...VISIBLE,id:52,user:{displayName:'Other reviewer'},rating:2,comment:null,verifiedPurchase:false,status:'hidden',images:[],product:{name:'Other product'}});
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
function setup(){
  const doc=makeDoc(),get=id=>doc.getElementById(id),calls=[],requests=[],writes=[];
  const state={rows:[VISIBLE,HIDDEN],pending:[]};
  const navs=Object.keys(navViews).map((name,i)=>{const el=El('button');el.setAttribute('data-nav',name);if(!i)el.classList.add('active');el.focus=()=>{doc.activeElement=el;};return el;});
  doc._qsa['.adm-nav-item']=navs;navs.forEach(el=>doc._qs['.adm-nav-item[data-nav="'+el.getAttribute('data-nav')+'"]']=el);
  const qs=doc.querySelector;doc.querySelector=s=>s==='.adm-nav-item.active'?navs.find(el=>el.classList.contains('active')):qs(s);
  for(const id of ['admin-review-detail-close','admin-review-confirm-cancel','admin-review-confirm-ok','admin-review-confirm-modal'])get(id).focus=()=>{doc.activeElement=get(id);};
  const create=doc.createElement;doc.createElement=tag=>{const el=create(tag);el.focus=()=>{doc.activeElement=el;};return el;};
  const body=get('admin-reviews-body'),replace=body.replaceChildren,append=body.appendChild;
  function connect(el,on){el.isConnected=on;el.children.forEach(child=>connect(child,on));}
  body.replaceChildren=(...nodes)=>{body.children.forEach(el=>connect(el,false));replace(...nodes);nodes.forEach(el=>connect(el,true));};
  body.appendChild=el=>{append(el);connect(el,true);return el;};
  const i18n=load('i18n.js').win.__i18n;i18n.current='vi';let auth;
  function reviewResponse(url,opts={}){
    const parsed=new URL(url,'http://test'),id=Number(parsed.pathname.split('/')[4]);
    if(opts.method==='PATCH'){
      if(state.failMutation)return response({message:'PRIVATE_STACK'},500);
      const body=JSON.parse(opts.body);state.rows=state.rows.map(r=>r.id===id?{...r,status:body.isHidden?'hidden':'visible'}:r);
      return response({id,isHidden:body.isHidden});
    }
    if(id){if(state.failDetail)return response({},500);return response({...state.rows.find(r=>r.id===id),comment:'Full API detail <script>',privateToken:'NEVER-RENDER'});}
    if(state.failList)return response({},500);
    const status=parsed.searchParams.get('status'),rows=state.rows.filter(r=>status==='all'||r.status===status);
    const totalPages=Math.ceil(rows.length/20),page=Math.min(Number(parsed.searchParams.get('page')),Math.max(totalPages,1));
    return response({page,limit:20,total:rows.length,totalPages,reviews:rows.slice((page-1)*20,page*20)});
  }
  const r=load('admin.js',{doc,deps:['routes.js','utils-format.js','utils-i18n.js','order-shipping.js','order-payment.js','business-report-csv.js','admin-reviews.js'],
    globals:{localStorage:{getItem:()=>null,setItem:(...x)=>writes.push(x)},sessionStorage:{setItem:(...x)=>writes.push(x)},setTimeout:()=>0,clearTimeout(){},confirm(){throw Error('native confirm');},fetch:async url=>{calls.push(url);return response([]);}},
    window:{__i18n:i18n,AuthHelper:{onChange(fn){auth=fn;},apiFetch:async(url,opts)=>{
      calls.push(url);requests.push({url,opts});
      if(url.startsWith('/api/admin/reviews')){
        const kind=opts?.method==='PATCH'?'Mutation':/reviews\/\d+$/.test(url)?'Detail':'List';
        if(state['defer'+kind])return new Promise(resolve=>state.pending.push({url,release(data){resolve(data?response(data):reviewResponse(url,opts));}}));
        return reviewResponse(url,opts);
      }
      if(url==='/api/me')return response({role:'admin'});if(/order-status|top-products/.test(url))return response([]);
      return response({orders:[],products:[],users:[],items:[],total:0,total_pages:1,current:{},previous:{},dailyRevenue:[]});
    }}}});
  doc.fire('DOMContentLoaded');
  return {...r,get,navs,calls,requests,writes,state,i18n,login:user=>auth(user),api:r.win.BreezeAdminReviews};
}
const allText=el=>el.textContent+(el.children||[]).map(allText).join('');
const rows=r=>r.get('admin-reviews-body').children;
const buttons=row=>row.children[7].children[0].children;
const field=(r,key)=>r.get('admin-review-detail-fields').children.find(el=>el.children[0]?.textContent===r.i18n.t(key))?.children[1];
const mutations=r=>r.requests.filter(x=>x.opts?.method==='PATCH');
const lists=r=>r.calls.filter(url=>url.startsWith('/api/admin/reviews?'));
function key(el,key,extra={}){let prevented=false;el.fire('keydown',{key,...extra,preventDefault(){prevented=true;}});return prevented;}
(async()=>{
  check('Review view remains in the existing Admin panel',section.includes('admin-reviews-title')&&html.includes('data-nav="reviews"'));
  check('eight existing table columns remain',([...section.matchAll(/<th scope="col"/g)]).length===8);
  check('production static markup contains only empty state',!/data-admin-review-id|★|<img|data-admin-review-action/.test(section));
  check('filter exposes only all/visible/hidden',section.includes('value="all"')&&section.includes('value="visible"')&&section.includes('value="hidden"'));
  check('Review markup uses no inline handlers or scripts',!/<script\b(?![^>]*\bsrc=)|\son\w+=|javascript:/i.test(section+html.slice(html.indexOf('<!-- Review detail/confirmation'))));
  check('table scroll, comment clamp and keyboard button styles remain',/overflow-x:auto/.test(css)&&/-webkit-line-clamp:2/.test(css)&&/\.adm-review-actions \.adm-btn:focus-visible/.test(css));
  const r=setup(),original=JSON.stringify([VISIBLE,HIDDEN]);
  eq('startup performs no Review request',r.calls.length,0);
  await r.api.load(1);eq('loader cannot request before Admin authorization',r.calls.length,0);
  r.login({uid:'admin'});await wait(50);
  const nav=r.navs.find(x=>x.getAttribute('data-nav')==='reviews');nav.click();await wait();
  eq('Review tab loads real list API',lists(r).at(-1),'/api/admin/reviews?page=1&limit=20&status=all');
  eq('Review navigation opens only its own view',r.get('view-reviews').style.display,'block');
  check('Review navigation sets accessible current item',nav.getAttribute('aria-current')==='page');
  eq('real rows replace the empty state',rows(r).length,2);
  eq('names are text, not markup',rows(r)[0].children[0].textContent,VISIBLE.user.displayName);
  check('untrusted product name is not innerHTML',rows(r)[0].children[1].innerHTML==='');
  eq('ratings come from API',rows(r).map(row=>allText(row.children[2])),['★★★★☆','★★☆☆☆']);
  check('comment is truncated without mutating original',allText(rows(r)[0].children[3]).length===121&&allText(rows(r)[0].children[3]).endsWith('…'));
  eq('purchase badges use explicit backend booleans',rows(r).map(row=>row.children[4].textContent),['Có','Không']);
  eq('date is DD/MM/YYYY - HH:mm in Vietnam',rows(r)[0].children[5].textContent,'14/10/2026 - 20:32');
  eq('visible/hidden actions reflect real status',rows(r).map(row=>buttons(row).map(x=>x.textContent)),[['Xem chi tiết','Ẩn'],['Xem chi tiết','Hiện lại']]);
  check('there is no Admin delete button',rows(r).every(row=>buttons(row).every(b=>b.getAttribute('data-admin-review-action')!=='delete')));
  r.doc.body.style.overflow='auto';buttons(rows(r)[0])[0].click();await wait();
  check('detail calls dedicated API',r.calls.includes('/api/admin/reviews/51'));
  eq('detail renders full API comment, not cached row preview',field(r,'adm.reviewComment').textContent,'Full API detail <script>');
  eq('detail preserves purchased snapshots',field(r,'pd.reviewPurchasedVariant').textContent,'M lúc mua / Đen lúc mua');
  eq('detail displays update timestamp',field(r,'adm.reviewUpdatedAt').textContent,'15/10/2026 - 08:00');
  check('no private fields are dumped',!allText(r.get('admin-review-detail-fields')).includes('NEVER-RENDER'));
  eq('gallery uses actual review image',r.get('admin-review-gallery').children[0].src,VISIBLE.images[0].url);
  r.get('admin-review-gallery').children[0].fire('error');check('broken review image hides without a fabricated fallback',r.get('admin-review-gallery').children[0].hidden);
  r.get('admin-review-product-image').fire('error');check('broken product image clears its source',r.get('admin-review-product-image').hidden&&r.get('admin-review-product-image').getAttribute('src')===null);
  check('detail locks scroll and focuses Close',r.doc.body.style.overflow==='hidden'&&r.doc.activeElement===r.get('admin-review-detail-close'));
  check('detail traps Tab',key(r.get('admin-review-detail-modal'),'Tab'));
  r.get('admin-review-detail-close').fire('click');check('closing clears private detail and restores scroll',!r.get('admin-review-detail-fields').children.length&&r.doc.body.style.overflow==='auto');
  check('closing restores focus to detail opener',r.doc.activeElement===buttons(rows(r)[0])[0]);
  buttons(rows(r)[1])[0].click();await wait();check('review without images hides gallery and product image',r.get('admin-review-detail-images').hidden&&r.get('admin-review-product-image').hidden);
  check('email is absent when the API does not return it',!field(r,'adm.thEmail'));
  key(r.get('admin-review-detail-modal'),'Escape');check('detail Escape closes the modal',!r.get('admin-review-detail-modal').classList.contains('open'));
  buttons(rows(r)[0])[1].click();r.get('admin-review-confirm-cancel').fire('click');eq('Cancel does not call moderation API',mutations(r).length,0);
  buttons(rows(r)[0])[1].click();key(r.get('admin-review-confirm-modal'),'Escape');eq('Escape does not mutate',mutations(r).length,0);
  buttons(rows(r)[0])[1].click();r.get('admin-review-confirm-modal').fire('click',{target:r.get('admin-review-confirm-modal')});eq('backdrop cancel does not mutate',mutations(r).length,0);
  r.state.deferMutation=true;buttons(rows(r)[0])[1].click();r.get('admin-review-confirm-ok').fire('click');r.get('admin-review-confirm-ok').fire('click');
  eq('double confirm makes exactly one API request',mutations(r).length,1);
  eq('hide payload contains visibility only',JSON.parse(mutations(r)[0].opts.body),{isHidden:true});
  check('pending mutation disables corresponding actions',r.get('admin-review-confirm-ok').disabled&&buttons(rows(r)[0]).every(b=>b.disabled));
  eq('pending mutation does not fake visible status',allText(rows(r)[0].children[6]),'Hiển thị');
  check('keyboard trap handles disabled confirmation controls',key(r.get('admin-review-confirm-modal'),'Tab'));
  const before=lists(r).length;r.state.deferMutation=false;r.state.pending.shift().release();await wait();
  eq('success reloads list from API',lists(r).length,before+1);
  check('success closes confirmation and restores scroll',!r.get('admin-review-confirm-modal').classList.contains('open')&&r.doc.body.style.overflow==='auto');
  eq('reloaded status is persisted server state',allText(rows(r)[0].children[6]),'Đã ẩn');
  buttons(rows(r)[0])[1].click();r.get('admin-review-confirm-ok').fire('click');await wait();
  eq('unhide sends false',JSON.parse(mutations(r).at(-1).opts.body),{isHidden:false});
  eq('unhide is reloaded from backend',allText(rows(r)[0].children[6]),'Hiển thị');
  r.state.failMutation=true;buttons(rows(r)[0])[1].click();r.get('admin-review-confirm-ok').fire('click');await wait();
  eq('failed API does not fake status',allText(rows(r)[0].children[6]),'Hiển thị');
  check('failed mutation is retryable with safe error',!r.get('admin-review-confirm-ok').disabled&&r.get('admin-review-confirm-feedback').textContent===r.i18n.t('adm.reviewModerationError'));
  r.state.failMutation=false;r.get('admin-review-confirm-ok').fire('click');await wait();eq('retry persists visibility',allText(rows(r)[0].children[6]),'Đã ẩn');
  r.get('admin-review-status').value='visible';r.get('admin-review-status').fire('change');await wait();eq('filter resets to first page',lists(r).at(-1),'/api/admin/reviews?page=1&limit=20&status=visible');
  eq('empty filtered list uses empty state',allText(rows(r)[0]),'Chưa có đánh giá nào.');
  r.state.rows=Array.from({length:21},(_,i)=>({...VISIBLE,id:100+i,status:i===20?'hidden':'visible'}));r.get('admin-review-status').value='all';r.get('admin-review-status').fire('change');await wait();
  check('pagination has native bounded controls',r.get('admin-review-prev').disabled&&!r.get('admin-review-next').disabled);
  r.get('admin-review-next').fire('click');await wait();eq('next page fetches bounded API list',lists(r).at(-1),'/api/admin/reviews?page=2&limit=20&status=all');eq('last page has one real row',rows(r).length,1);
  // Simulate another admin removing the last filtered row while this page is open.
  r.state.rows=r.state.rows.slice(0,20);await r.api.load(2);eq('backend clamp is reflected in pager',r.get('admin-review-page').textContent,'Trang 1 / 1');
  r.state.rows.push({...VISIBLE,id:121});r.get('admin-review-status').value='visible';r.get('admin-review-status').fire('change');await wait();r.get('admin-review-next').fire('click');await wait();
  eq('last filtered page before mutation contains one row',rows(r).length,1);
  buttons(rows(r)[0])[1].click();r.get('admin-review-confirm-ok').fire('click');await wait();
  eq('hiding last filtered row reloads and clamps back to page one',r.get('admin-review-page').textContent,'Trang 1 / 1');eq('clamped filtered page contains remaining rows',rows(r).length,20);
  const beforeLang=r.calls.length;r.i18n.current='en';r.doc.fire('langchange');eq('language change does not refetch or mutate',r.calls.length,beforeLang);
  eq('loaded labels switch to English',buttons(rows(r)[0]).map(b=>b.textContent),['View details','Hide']);
  r.state.failList=true;await r.api.load(1);check('list failure has retry instead of a false empty state',allText(rows(r)[0]).includes(r.i18n.t('adm.reviewLoadError')));
  r.state.failList=false;rows(r)[0].children[0].children[0].fire('click');await wait();eq('list retry restores actual data',rows(r).length,20);
  r.state.failDetail=true;buttons(rows(r)[0])[0].click();await wait();check('detail failure does not reuse stale row object',allText(r.get('admin-review-detail-fields')).includes(r.i18n.t('adm.reviewLoadError'))&&!field(r,'adm.reviewComment'));
  r.state.failDetail=false;r.get('admin-review-detail-fields').children[0].children[0].children[0].fire('click');await wait();eq('detail retry loads fresh API data',field(r,'adm.reviewComment').textContent,'Full API detail <script>');
  r.get('admin-review-detail-close').fire('click');
  r.state.deferList=true;const old=r.api.load(1);r.get('admin-review-status').value='hidden';r.get('admin-review-status').fire('change');
  check('list loading is announced and controls disabled',r.get('admin-reviews-body').getAttribute('aria-busy')==='true'&&r.get('admin-review-status').disabled);
  const older=r.state.pending.shift(),newer=r.state.pending.shift();newer.release();await wait();older.release();await old;
  check('late previous filter cannot overwrite the newest filter',rows(r).every(row=>allText(row.children[6])==='Hidden'));
  r.state.deferList=false;r.get('admin-review-status').value='all';r.get('admin-review-status').fire('change');await wait();
  r.state.deferDetail=true;buttons(rows(r)[0])[0].click();r.get('admin-review-detail-close').fire('click');r.state.deferDetail=false;r.state.pending.shift().release();await wait();
  check('late detail cannot reopen a closed modal',!r.get('admin-review-detail-modal').classList.contains('open')&&!r.get('admin-review-detail-fields').children.length);
  r.state.deferList=true;const pending=r.api.load(1);r.login(null);r.state.deferList=false;r.state.pending.shift().release();await pending;
  eq('late list after logout cannot expose review data',allText(rows(r)[0]),'No reviews yet.');
  check('logout restores modal and scrolling state',!r.get('admin-review-confirm-modal').classList.contains('open')&&r.doc.body.style.overflow==='auto');
  const callsAfterLogout=r.calls.length;await r.api.load(1);eq('loader remains blocked after logout',r.calls.length,callsAfterLogout);
  r.login({uid:'admin'});await wait(50);nav.click();await wait();
  r.state.deferMutation=true;buttons(rows(r)[0])[1].click();r.get('admin-review-confirm-ok').fire('click');r.login(null);r.state.deferMutation=false;r.state.pending.shift().release();await wait();
  eq('late mutation cannot reload private rows after logout',allText(rows(r)[0]),'No reviews yet.');
  eq('source fixtures were never mutated',JSON.stringify([VISIBLE,HIDDEN]),original);eq('no review state written to browser storage',r.writes.length,0);
  check('no unexpected console errors',!r.log.some(x=>x[0]==='console.error'));
})().catch(e=>{console.error(e);process.exitCode=1;});
