const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const image=n=>'/review-images/'+String(n).padStart(32,'0')+'.webp';
const OWNER={id:91,productId:17,isOwner:true,rating:4,comment:'Cảm nhận thật từ API',variant:{id:701,size:'M',color:'Đen lúc mua'},
  images:[{id:81,url:image(1)},{id:82,url:image(2)}],createdAt:'2026-10-15T10:00:00Z',updatedAt:'2026-10-15T10:00:00Z'};
const purchased=[{variant_id:701,size_snapshot:'M',color_snapshot:'Đen lúc mua'},{variant_id:702,size_snapshot:'L',color_snapshot:'Trắng'}];
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
function deferred(){let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};}
function setup(options={}){
  const doc=makeDoc(),get=id=>doc.getElementById(id),calls=[],publicCalls=[],urls=[],revoked=[],writes=[],stars=[];
  let backend=options.none?null:structuredClone(OWNER),uid=options.guest?null:'owner';
  doc._qs['.pd-add']=El('button');get('pd-review-overlay').hidden=get('pd-review-delete-overlay').hidden=true;
  Object.defineProperty(get('pd-review-variant'),'options',{get(){return this.children;}});
  for(let n=1;n<=5;n++){const b=El('button'),span=El('span');b.setAttribute('data-review-rating',n);b.querySelector=()=>span;b._closest={'[data-review-rating]':b};stars.push(b);}
  get('pd-review-stars').querySelectorAll=()=>stars;
  const filters=['all','5','4','3','2','1','images'].map(key=>{const b=El('button');b.setAttribute('data-review-filter',key);return b;});doc._qsa['#pd-reviews-filters [data-review-filter]']=filters;
  const i18n=load('i18n.js').win.__i18n;i18n.current='vi';
  const r=load('page-product-reviews.js',{doc,deps:['routes.js','utils-format.js','utils-i18n.js','page-product.js'],
    globals:{localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},sessionStorage:{setItem:(...args)=>writes.push(args)},
      URL:{createObjectURL:()=>{const value='blob:owner-api-'+urls.length;urls.push(value);return value;},revokeObjectURL:url=>revoked.push(url)},
      fetch:async(url,settings)=>{
        if(!url.includes('/reviews?'))return response(url.endsWith('/17')?{id:17,name_vi:'Áo thật từ API',name_en:'API shirt',price:100,images:[],size_configured:true,variants:[{id:171,size:'XL',available:true}],category_slug:'sanpham-ao'}:[]);
        publicCalls.push(url);const query=new URL(url,'http://test').searchParams,visible=backend&&!options.hidden;
        const rows=visible&&(!query.has('rating')||Number(query.get('rating'))===backend.rating)?[backend]:[];
        return response({reviews:rows,summary:{averageRating:visible?backend.rating:null,totalReviews:visible?1:0,
          ratingCounts:Object.fromEntries([1,2,3,4,5].map(n=>[n,visible&&n===backend.rating?1:0])),reviewsWithImages:visible&&backend.images.length?1:0},page:1,limit:10,total:rows.length,totalPages:rows.length?1:0});
      }},window:{location:{search:'?id=17',href:'product.html?id=17'},__i18n:i18n,
      AuthHelper:{getUser:()=>uid?{uid}:null,isLoggedIn:()=>!!uid,apiFetch:async(url,settings={})=>{
        calls.push({url,settings});
        if(url.endsWith('/reviews/me'))return options.ownerGet?options.ownerGet(url,settings):response({review:uid==='owner'?backend:null,purchasedVariants:purchased});
        if(url.endsWith('/review-eligibility'))return response({canReview:true,hasReviewed:!!backend,purchasedVariants:purchased});
        if(settings.method==='PATCH')return options.patch?options.patch(url,settings):response({message:'PRIVATE SQL',code:'REVIEW_SERVER_ERROR'},500);
        if(settings.method==='DELETE')return options.remove?options.remove(url,settings):response({message:'PRIVATE path',code:'REVIEW_SERVER_ERROR'},500);
        throw Error('Unexpected test endpoint '+url);
      }}}});
  return {...r,get,stars,filters,calls,publicCalls,urls,revoked,writes,i18n,setBackend(value){backend=value;},setUser(value){uid=value;doc.fire('authchange');}};
}
const apiCalls=(r,method)=>r.calls.filter(c=>c.settings.method===method);
const cards=r=>r.get('pd-reviews-list').children;
const actions=r=>cards(r)[0]?.children.find(c=>c.className==='pd-review-actions');
async function open(r){r.get('pd-review-open').click();await wait();}
function files(r,n){r.get('pd-review-files').files=Array.from({length:n},(_,i)=>({name:'new-'+i+'.png',type:'image/png',size:100}));r.get('pd-review-files').fire('change');}
(async()=>{
  let r=setup({none:true});await wait();eq('no owner review produces Create CTA',r.get('pd-review-open').textContent,'Đánh giá sản phẩm');
  r=setup({guest:true});await wait();eq('guest never requests owner endpoint',r.calls.length,0);check('guest cannot get actions from public isOwner-looking data',!actions(r));
  const saved=deferred();r=setup({patch:()=>saved.promise});await wait();
  eq('page load fetches authenticated owner review',r.calls[0].url,'/api/products/17/reviews/me');
  eq('real owner response produces Edit CTA',r.get('pd-review-open').textContent,'Chỉnh sửa đánh giá');
  check('only matched owner gets Edit and Delete card actions',actions(r)?.children.length===2);
  r.filters[1].click();await wait();check('rating filter may hide owner card without clearing Edit CTA',!cards(r).length&&r.get('pd-review-open').textContent==='Chỉnh sửa đánh giá');
  await open(r);eq('click Edit fetches fresh owner data',r.calls.filter(c=>c.url.endsWith('/reviews/me')).length,2);
  eq('Edit uses existing modal mode',r.get('pd-review-form').getAttribute('data-review-mode'),'edit');
  eq('rating is prefilled from API',r.stars.map(b=>b.getAttribute('aria-checked')),['false','false','false','true','false']);
  eq('variant prefill uses stored purchase reference',r.get('pd-review-variant').value,'701');
  eq('Edit offers exactly real purchased variants',r.get('pd-review-variant').options.map(o=>o.value),['','701','702']);
  eq('comment prefill comes from API',r.get('pd-review-comment').value,OWNER.comment);
  eq('existing image previews come from API',r.get('pd-review-previews').children.map(c=>c.children[0].src),OWNER.images.map(i=>i.url));
  eq('existing images allocate no Blob URL',r.urls.length,0);
  r.get('pd-review-previews').children[0].children[1].click();files(r,2);
  r.get('pd-review-stars').fire('click',{target:r.stars[4]});r.get('pd-review-variant').value='702';r.get('pd-review-variant').fire('change');r.get('pd-review-comment').value='  Mới 😀  ';
  r.get('pd-review-form').fire('submit');r.get('pd-review-form').fire('submit');
  eq('double Save sends one PATCH',apiCalls(r,'PATCH').length,1);
  const patch=apiCalls(r,'PATCH')[0];eq('PATCH targets the owned review',patch.url,'/api/products/17/reviews/91');
  eq('PATCH sends rating/comment/variant/removal IDs',patch.settings.body._d.slice(0,4),[['rating','5'],['variant_id','702'],['comment','  Mới 😀  '],['remove_image_ids','[81]']]);
  eq('PATCH uploads only newly selected files',patch.settings.body._d.filter(([key])=>key==='images').length,2);
  check('Save loading disables inputs and duplicate submission',r.get('pd-review-submit').disabled&&r.get('pd-review-comment').disabled&&r.get('pd-review-variant').disabled&&r.stars.every(s=>s.disabled));
  const updated={...OWNER,rating:5,comment:'Mới từ API',variant:{id:702,size:'L',color:'Trắng'},images:[OWNER.images[1],{id:83,url:image(3)},{id:84,url:image(4)}]};
  const beforeReads=r.publicCalls.length;r.setBackend(updated);saved.resolve(response(updated));await wait();
  check('update success closes and clears the draft',r.get('pd-review-overlay').hidden&&r.get('pd-review-comment').value===''&&!r.get('pd-review-previews').children.length);
  check('update cleans only local preview URLs',r.urls.length===2&&r.urls.every(u=>r.revoked.filter(v=>v===u).length===1));
  eq('update reloads public data once',r.publicCalls.length,beforeReads+1);
  eq('update preserves current filter',new URL(r.publicCalls.at(-1),'http://test').searchParams.get('rating'),'5');
  eq('summary refreshes from server',r.get('pd-reviews-score').textContent,'5.0 / 5');
  eq('new matching review appears from list API',cards(r).length,1);
  check('update reloads owner source as well',r.calls.filter(c=>c.url.endsWith('/reviews/me')).length===3);
  eq('owner cache uses refreshed server comment',r.win.BreezeProductReviews.getOwnerReview().comment,'Mới từ API');
  eq('update success message is real',r.get('pd-review-access').textContent,r.i18n.t('pd.reviewUpdated'));
  actions(r).children[0].click();await wait();eq('card Edit uses the same fresh owner flow',r.get('pd-review-comment').value,'Mới từ API');r.get('pd-review-close').click();
  actions(r).children[1].click();r.get('pd-review-delete-cancel').click();eq('Cancel never sends DELETE',apiCalls(r,'DELETE').length,0);
  r=setup();await wait();await open(r);r.get('pd-review-form').fire('submit');await wait();
  check('failed PATCH keeps form/data without false success',!r.get('pd-review-overlay').hidden&&r.get('pd-review-comment').value===OWNER.comment&&!r.get('pd-review-feedback').textContent.includes('PRIVATE'));
  r.get('pd-review-close').click();actions(r).children[1].click();r.get('pd-review-delete-confirm').click();await wait();
  check('failed DELETE keeps confirmation and original server card',!r.get('pd-review-delete-overlay').hidden&&cards(r).length===1&&!r.get('pd-review-delete-feedback').textContent.includes('PRIVATE'));
  check('failed DELETE re-enables cancellation and retry',!r.get('pd-review-delete-cancel').disabled&&!r.get('pd-review-delete-confirm').disabled);
  const deleted=deferred();r=setup({remove:()=>deleted.promise});await wait();actions(r).children[1].click();r.get('pd-review-delete-confirm').click();r.get('pd-review-delete-confirm').click();
  eq('double Confirm sends one DELETE',apiCalls(r,'DELETE').length,1);
  eq('DELETE targets owned review only',apiCalls(r,'DELETE')[0].url,'/api/products/17/reviews/91');
  check('in-flight Delete locks confirmation controls',r.get('pd-review-delete-confirm').disabled&&r.get('pd-review-delete-cancel').disabled);
  r.doc.fire('keydown',{key:'Escape'});check('Escape cannot imply cancelling an in-flight delete',!r.get('pd-review-delete-overlay').hidden);
  r.setBackend(null);const beforeDelete=r.publicCalls.length;deleted.resolve(response({status:'success'}));await wait();
  check('delete success closes confirmation and resets owner state',r.get('pd-review-delete-overlay').hidden&&r.win.BreezeProductReviews.getOwnerReview()===null);
  eq('delete returns CTA to Create',r.get('pd-review-open').textContent,'Đánh giá sản phẩm');
  eq('delete refreshes public list and summary',r.publicCalls.length,beforeDelete+1);
  check('last review deletion yields actual empty state',!r.get('pd-reviews-empty').hidden&&cards(r).length===0&&r.get('pd-reviews-score').textContent==='— / 5');
  eq('filter counts refresh after deletion',r.filters[0].textContent,'Tất cả (0)');
  await open(r);check('buyer can open a fresh Create form after delete',!r.get('pd-review-overlay').hidden&&r.get('pd-review-form').getAttribute('data-review-mode')==='create');
  eq('owner edits/deletes write no local/session storage',r.writes.length,0);
  const stale=deferred();r=setup({patch:()=>stale.promise});await wait();await open(r);r.get('pd-review-form').fire('submit');const signal=apiCalls(r,'PATCH')[0].settings.signal;r.setUser('other');stale.resolve(response(OWNER));await wait();
  check('account switch aborts pending edit and closes draft',signal.aborted&&r.get('pd-review-overlay').hidden);
  check('stale edit success cannot affect new account CTA/actions',r.get('pd-review-open').textContent==='Đánh giá sản phẩm'&&!actions(r));
  const staleDelete=deferred();r=setup({remove:()=>staleDelete.promise});await wait();actions(r).children[1].click();r.get('pd-review-delete-confirm').click();const deleteSignal=apiCalls(r,'DELETE')[0].settings.signal;r.setUser(null);staleDelete.resolve(response({status:'success'}));await wait();
  check('logout aborts delete UI request and clears owner actions',deleteSignal.aborted&&r.get('pd-review-delete-overlay').hidden&&!actions(r));
  r=setup({hidden:true});await wait();check('hidden review can be edited through CTA while remaining absent publicly',r.get('pd-review-open').textContent==='Chỉnh sửa đánh giá'&&cards(r).length===0);await open(r);check('hidden owner data prefills real Edit form',!r.get('pd-review-overlay').hidden&&r.get('pd-review-comment').value===OWNER.comment);
})().catch(e=>{console.error(e);process.exitCode=1;});
