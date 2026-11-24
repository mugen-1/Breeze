// Form sửa đánh giá với ảnh đang xử lý nền: ảnh pending/failed hiện ô chữ (không <img>), có nút ×,
// tính vào giới hạn 5 ảnh; lỗi tải ảnh chỉ gỡ ảnh ready. Dữ liệu chủ review đi qua đúng API giả
// /reviews/me như page-product-review-owner-api.test.js.
const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const fs=require('fs'),path=require('path');
const css=fs.readFileSync(path.join(__dirname,'../../../server/views/partials/product-style.ejs'),'utf8');
const image=n=>'/review-images/'+String(n).padStart(32,'0')+'.webp';
const OWNER={id:91,productId:17,isOwner:true,rating:4,comment:'Có ảnh đang xử lý',variant:{id:701,size:'M',color:'Đen'},
  images:[{id:81,url:image(1),status:'ready'},{id:82,url:image(2),status:'pending'},{id:83,url:image(3),status:'failed'}],
  createdAt:'2026-11-24T10:00:00Z',updatedAt:'2026-11-24T10:00:00Z'};
const purchased=[{variant_id:701,size_snapshot:'M',color_snapshot:'Đen'}];
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
function setup(owner){
  const doc=makeDoc(),get=id=>doc.getElementById(id),calls=[],urls=[],stars=[];
  doc._qs['.pd-add']=El('button');get('pd-review-overlay').hidden=get('pd-review-delete-overlay').hidden=true;
  Object.defineProperty(get('pd-review-variant'),'options',{get(){return this.children;}});
  for(let n=1;n<=5;n++){const b=El('button'),span=El('span');b.setAttribute('data-review-rating',n);b.querySelector=()=>span;b._closest={'[data-review-rating]':b};stars.push(b);}
  get('pd-review-stars').querySelectorAll=()=>stars;
  doc._qsa['#pd-reviews-filters [data-review-filter]']=['all','images'].map(key=>{const b=El('button');b.setAttribute('data-review-filter',key);return b;});
  const i18n=load('i18n.js').win.__i18n;i18n.current='vi';
  const r=load('page-product-reviews.js',{doc,deps:['routes.js','utils-format.js','utils-i18n.js','page-product.js'],
    globals:{localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{setItem(){}},
      URL:{createObjectURL:()=>{const value='blob:image-status-'+urls.length;urls.push(value);return value;},revokeObjectURL(){}},
      fetch:async url=>{
        if(!url.includes('/reviews?'))return response(url.endsWith('/17')?{id:17,name_vi:'Áo',name_en:'Shirt',price:100,images:[],size_configured:true,variants:[{id:171,size:'M',available:true}],category_slug:'sanpham-ao'}:[]);
        return response({reviews:[],summary:{averageRating:null,totalReviews:0,ratingCounts:{1:0,2:0,3:0,4:0,5:0},reviewsWithImages:0},page:1,limit:10,total:0,totalPages:0});
      }},window:{location:{search:'?id=17',href:'product.html?id=17'},__i18n:i18n,
      AuthHelper:{getUser:()=>({uid:'owner'}),isLoggedIn:()=>true,apiFetch:async(url,settings={})=>{
        calls.push({url,settings});
        if(url.endsWith('/reviews/me'))return response({review:structuredClone(owner),purchasedVariants:purchased});
        if(url.endsWith('/review-eligibility'))return response({canReview:true,hasReviewed:true,purchasedVariants:purchased});
        if(settings.method==='PATCH')return response({code:'REVIEW_SERVER_ERROR'},500);
        throw Error('Unexpected test endpoint '+url);
      }}}});
  return {...r,get,calls,urls,i18n};
}
const previews=r=>r.get('pd-review-previews').children;
const kind=card=>card.getAttribute('data-status')||(card.children[0].tagName==='IMG'?'img':'?');
function files(r,n){r.get('pd-review-files').files=Array.from({length:n},(_,i)=>({name:'new-'+i+'.png',type:'image/png',size:100}));r.get('pd-review-files').fire('change');}
(async()=>{
  check('placeholder has its own styles; failed text uses the danger colour',/\.pd-review-preview-status\s*\{[^}]*display: flex/.test(css)&&
    /\.pd-review-preview-status\[data-status="failed"\] \.pd-review-preview-note \{ color: var\(--c-danger\); \}/.test(css));
  let r=setup(OWNER);await wait();r.get('pd-review-open').click();await wait();
  eq('edit form shows ready, pending and failed images in order',previews(r).map(kind),['img','pending','failed']);
  eq('ready image keeps its <img> preview',previews(r)[0].children[0].src,image(1));
  eq('pending image shows processing text instead of an image',previews(r)[1].children[0].textContent,'Đang xử lý ảnh…');
  eq('failed image shows failure text instead of an image',previews(r)[2].children[0].textContent,'Không xử lý được ảnh');
  check('placeholders never create an <img> (no load error can remove them)',previews(r).slice(1).every(c=>c.children[0].tagName==='SPAN'&&!c.children.some(x=>x.tagName==='IMG')));
  check('pending and failed images both have an × button',previews(r).every(c=>c.children[1].tagName==='BUTTON'&&c.children[1].className==='pd-review-remove-image'));
  eq('× buttons keep numbered accessible labels',previews(r).map(c=>c.children[1].getAttribute('aria-label')),
    [1,2,3].map(n=>r.i18n.t('pd.reviewRemoveImage',{n})));
  files(r,3);
  eq('pending and failed count toward the 5-image limit',previews(r).length,5);
  eq('only two free slots accept new files',r.urls.length,2);
  check('full draft disables the picker',r.get('pd-review-add-image').disabled);
  r.i18n.current='en';r.doc.fire('langchange');
  eq('placeholder text follows language change',[previews(r)[1].children[0].textContent,previews(r)[2].children[0].textContent],['Processing image…','Image could not be processed']);
  r.i18n.current='vi';r.doc.fire('langchange');
  previews(r)[0].children[0].fire('error');
  eq('load error removes only the ready image',previews(r).slice(0,2).map(kind),['pending','failed']);
  eq('load error explains the removed preview',r.get('pd-review-images-error').textContent,r.i18n.t('pd.reviewPreviewError'));
  previews(r)[0].children[1].click();
  eq('× removes the pending image from the draft',previews(r).slice(0,1).map(kind),['failed']);
  r.get('pd-review-form').fire('submit');await wait();
  const patch=r.calls.find(c=>c.settings.method==='PATCH');
  check('save sends a PATCH',!!patch);
  eq('PATCH removes exactly the ready (load error) and pending (×) images; failed is kept until removed',
    patch.settings.body._d.find(([k])=>k==='remove_image_ids')[1],'[81,82]');
  r=setup({...OWNER,images:[{id:81,url:image(1)}]});await wait();r.get('pd-review-open').click();await wait();
  eq('image without status (older API) is treated as ready',previews(r).map(kind),['img']);
})().catch(e=>{console.error(e);process.exitCode=1;});
