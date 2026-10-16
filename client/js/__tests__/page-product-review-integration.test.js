const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const purchased=[{variant_id:701,order_item_id:41,size_snapshot:'M',color_snapshot:'Đen lúc mua'},
  {variant_id:702,order_item_id:42,size_snapshot:'L',color_snapshot:'<Trắng>'}];
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const eligible=()=>response({canReview:true,hasReviewed:false,purchasedVariants:purchased});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function setup(options={}){
  const doc=makeDoc(),get=id=>doc.getElementById(id),calls=[],writes=[],urls=[],revoked=[],stars=[];
  let user=options.guest?null:{uid:'owner'};
  doc._qs['.pd-add']=El('button');get('pd-review-overlay').hidden=true;
  Object.defineProperty(get('pd-review-variant'),'options',{get(){return this.children;}});
  for(let n=1;n<=5;n++){const b=El('button');b.setAttribute('data-review-rating',n);const span=El('span');b.querySelector=()=>span;b._closest={'[data-review-rating]':b};stars.push(b);}
  get('pd-review-stars').querySelectorAll=()=>stars;
  const i18n=load('i18n.js').win.__i18n;i18n.current='vi';
  const helper={getUser:()=>user,isLoggedIn:()=>!!user,apiFetch:async(url,settings={})=>{
    calls.push({url,settings});if(url.endsWith('/reviews/me'))return response({review:options.owner||null,purchasedVariants:purchased});return (settings.method==='POST'?options.post:options.eligibility)?.(url,settings)||eligible();
  }};
  const r=load('page-product.js',{doc,deps:['routes.js','utils-format.js','utils-i18n.js'],
    globals:{localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},sessionStorage:{setItem:(...args)=>writes.push(args)},
      URL:{createObjectURL:file=>{const url='blob:integration-'+urls.length;urls.push(url);return url;},revokeObjectURL:url=>revoked.push(url)},
      fetch:async url=>response(url.endsWith('/17')?{id:17,name_vi:'Sản phẩm thật',name_en:'API product',price:100,images:[],
        size_configured:true,variants:[{id:171,size:'XL',available:true}],category_slug:'sanpham-ao'}:[])},
    window:{AuthHelper:helper,__i18n:i18n,location:{search:'?id=17',href:'product.html?id=17'}}});
  return {...r,get,stars,calls,writes,urls,revoked,i18n,setOwner(value){options.owner=value;},setUser(value){user=value;doc.fire('authchange');}};
}
async function open(r){await wait();r.get('pd-review-open').click();await wait();}
function valid(r){r.get('pd-review-stars').fire('click',{target:r.stars[3]});r.get('pd-review-variant').value='702';r.get('pd-review-variant').fire('change');}
function files(r,count=5){r.get('pd-review-files').files=Array.from({length:count},(_,i)=>({name:'image-'+i+'.png',type:'image/png',size:32}));r.get('pd-review-files').fire('change');}
const postCalls=r=>r.calls.filter(c=>c.settings.method==='POST');
(async()=>{
  let r=setup({guest:true});await open(r);
  check('guest never opens usable form',r.get('pd-review-overlay').hidden);
  eq('guest sees login reminder',r.get('pd-review-access').textContent,r.i18n.t('pd.reviewLoginRequired'));
  check('guest has route-helper login link',!r.get('pd-review-login').hidden&&r.get('pd-review-login').href==='login.html');
  eq('guest sends no eligibility request',r.calls.length,0);
  r=setup({eligibility:()=>response({canReview:false,hasReviewed:false,purchasedVariants:[]})});await open(r);
  eq('ineligible wording is exact',r.get('pd-review-access').textContent,'Bạn không thể đánh giá nếu chưa từng mua');
  check('ineligible form stays hidden',r.get('pd-review-overlay').hidden);
  eq('CTA calls correct authenticated eligibility endpoint',r.calls.find(c=>c.url.endsWith('/review-eligibility')).url,'/api/products/17/review-eligibility');
  r=setup({owner:{id:91,productId:17,isOwner:true,rating:4,comment:'',variant:{id:701,size:'M',color:'Đen'},images:[]},eligibility:()=>response({canReview:true,hasReviewed:true,purchasedVariants:purchased})});await open(r);
  check('existing review opens Edit from the real owner endpoint',!r.get('pd-review-overlay').hidden&&r.get('pd-review-form').getAttribute('data-review-mode')==='edit');
  eq('existing review sends no create request',postCalls(r).length,0);
  for(const eligibility of [()=>response({},401),()=>{throw Error('network');}]){
    r=setup({eligibility});await open(r);check('eligibility failure keeps form hidden with feedback',r.get('pd-review-overlay').hidden&&!r.get('pd-review-access').hidden);
  }
  const pendingEligibility=deferred();r=setup({eligibility:()=>pendingEligibility.promise});await open(r);r.get('pd-review-open').click();
  eq('repeated click during eligibility sends one request',r.calls.filter(c=>c.url.endsWith('/review-eligibility')).length,1);
  check('eligibility displays loading state',r.get('pd-review-open').getAttribute('aria-busy')==='true');
  r.setUser(null);pendingEligibility.resolve(eligible());await wait();
  check('late eligibility cannot open a logged-out form',r.get('pd-review-overlay').hidden&&r.get('pd-review-open').getAttribute('aria-busy')===null);
  const pending=deferred();r=setup({post:()=>pending.promise});await open(r);
  check('eligible user opens modal',!r.get('pd-review-overlay').hidden);
  eq('selector has exactly API variants plus placeholder',r.get('pd-review-variant').options.map(o=>o.value),['','701','702']);
  check('option uses safe purchase snapshots, not current product size',r.get('pd-review-variant').options[2].textContent.includes('<Trắng>')&&!r.get('pd-review-variant').options.some(o=>o.value==='171'));
  valid(r);r.get('pd-review-comment').value='  Rất đẹp 😀  ';files(r,6);
  eq('local image draft is capped at five',r.get('pd-review-previews').children.length,5);
  r.get('pd-review-form').fire('submit');r.get('pd-review-form').fire('submit');
  eq('double submit produces one POST',postCalls(r).length,1);
  const call=postCalls(r)[0],fields=call.settings.body._d;
  eq('POST targets real create endpoint',call.url,'/api/products/17/reviews');
  eq('FormData sends selected rating, purchased ID and optional comment',fields.slice(0,3),[['rating','4'],['variant_id','702'],['comment','  Rất đẹp 😀  ']]);
  eq('FormData contains exactly five selected files',fields.filter(([key])=>key==='images').length,5);
  check('AuthHelper controls multipart headers',!call.settings.headers);
  check('loading disables Submit, variant, comment, rating and picker',r.get('pd-review-submit').disabled&&r.get('pd-review-variant').disabled&&r.get('pd-review-comment').disabled&&r.stars.every(b=>b.disabled)&&r.get('pd-review-files').disabled);
  eq('loading label is translated',r.get('pd-review-submit').textContent,r.i18n.t('pd.reviewSubmitting'));
  check('valid request does not display false variant error',r.get('pd-review-variant-error').hidden);
  r.setOwner({id:99,productId:17,isOwner:true,rating:4,comment:'Rất đẹp 😀',variant:{id:702,size:'L',color:'Trắng'},images:[]});
  pending.resolve(response({id:99,rating:4,images:[]},201));await wait();
  check('success closes modal and resets all draft fields',r.get('pd-review-overlay').hidden&&r.get('pd-review-comment').value===''&&r.get('pd-review-variant').value===''&&!r.get('pd-review-previews').children.length);
  check('success revokes every local preview once',r.urls.length===5&&r.urls.every(url=>r.revoked.filter(v=>v===url).length===1));
  eq('success changes CTA',r.get('pd-review-open').textContent,r.i18n.t('pd.editReview'));
  eq('success displays translated feedback',r.get('pd-review-access').textContent,r.i18n.t('pd.reviewCreated'));
  check('success never invents public review cards',!r.get('pd-reviews-list').children.length&&r.get('pd-reviews-list').innerHTML==='');
  eq('no review draft is persisted client-side',r.writes.length,0);
  r.get('pd-review-form').fire('submit');eq('closed success form cannot create again',postCalls(r).length,1);
  for(const code of ['REVIEW_ALREADY_EXISTS','REVIEW_INVALID_RATING','REVIEW_INVALID_VARIANT','REVIEW_INVALID_COMMENT','REVIEW_TOO_MANY_IMAGES','REVIEW_INVALID_IMAGE','REVIEW_IMAGE_TOO_LARGE','REVIEW_SERVER_ERROR']){
    r=setup({post:()=>response({code,message:'PRIVATE SQL/path/stack'},code==='REVIEW_ALREADY_EXISTS'?409:400)});await open(r);valid(r);files(r,1);
    r.get('pd-review-form').fire('submit');await wait();
    check(code+' displays safe feedback and preserves draft',!r.get('pd-review-feedback').hidden&&!r.get('pd-review-feedback').textContent.includes('PRIVATE')&&r.get('pd-review-previews').children.length===1);
    if(code==='REVIEW_ALREADY_EXISTS'){r.get('pd-review-form').fire('submit');eq('duplicate blocks second create',postCalls(r).length,1);check('duplicate disables create Submit',r.get('pd-review-submit').disabled);}
    r.get('pd-review-close').click();check(code+' closes with preview cleanup',r.revoked.length===1);
  }
  for(const [code,status,key]of[['REVIEW_NOT_ELIGIBLE',403,'pd.reviewNotEligible'],['AUTH',401,'pd.reviewLoginRequired']]){
    r=setup({post:()=>response({code},status)});await open(r);valid(r);files(r,1);r.get('pd-review-form').fire('submit');await wait();
    check(code+' closes stale eligibility form and cleans previews',r.get('pd-review-overlay').hidden&&r.revoked.length===1);
    eq(code+' explains next action',r.get('pd-review-access').textContent,r.i18n.t(key));
  }
  const stale=deferred();r=setup({post:()=>stale.promise});await open(r);valid(r);files(r,1);r.get('pd-review-form').fire('submit');
  const signal=postCalls(r)[0].settings.signal;r.setUser({uid:'different-owner'});stale.resolve(response({id:100},201));await wait();
  check('account change aborts pending request and clears local draft',signal.aborted&&r.get('pd-review-overlay').hidden&&r.revoked.length===1);
  eq('stale success cannot label new account as owner',r.get('pd-review-open').textContent,r.i18n.t('pd.reviewProduct'));
  eq('stale success cannot show previous account result',r.get('pd-review-access').textContent,'');
})().catch(e=>{console.error(e);process.exitCode=1;});
