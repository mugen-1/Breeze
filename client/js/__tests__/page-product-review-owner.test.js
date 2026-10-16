const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const fs=require('fs'),path=require('path');
const view=fs.readFileSync(path.join(__dirname,'../../../server/views/pages/product.ejs'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../../../server/views/partials/product-style.ejs'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../page-product.js'),'utf8');
// Owner fixtures exist ONLY in this test; production loads its authenticated owner API.
const REVIEW=Object.freeze({id:91,productId:17,isOwner:true,displayName:'Test owner',rating:4,
  variant:Object.freeze({id:777,label:'Purchased variant <M>'}),comment:'Cảm nhận từ review',
  images:Object.freeze([Object.freeze({id:81,url:'/uploads/review-one.png'}),Object.freeze({id:82,url:'/uploads/review-two.png'})])});
function setup(){
  const doc=makeDoc(),get=id=>doc.getElementById(id),calls=[],writes=[],urls=[],revoked=[],created=[],intents=[];
  let backendReview=null;const authCalls=[];
  const stars=[];doc._qs['.pd-add']=El('button');
  for(let n=1;n<=5;n++){
    const b=El('button'),span=El('span');b.setAttribute('data-review-rating',n);
    b.querySelector=()=>span;b._closest={'[data-review-rating]':b};
    b.focus=()=>{doc.activeElement=b;};stars.push(b);
  }
  get('pd-review-stars').querySelectorAll=()=>stars;
  for(const id of ['pd-review-overlay','pd-review-delete-overlay','pd-review-feedback','pd-review-delete-feedback'])get(id).hidden=true;
  const placeholder=El('option');placeholder.value='';placeholder.disabled=true;get('pd-review-variant').appendChild(placeholder);
  Object.defineProperty(get('pd-review-variant'),'options',{get(){return this.children;}});
  for(const id of ['pd-review-open','pd-review-close','pd-review-variant','pd-review-comment','pd-review-add-image','pd-review-submit','pd-review-delete-cancel','pd-review-delete-confirm'])get(id).focus=()=>{doc.activeElement=get(id);};
  get('pd-review-dialog').querySelectorAll=()=>[get('pd-review-close'),...stars,get('pd-review-variant'),get('pd-review-comment'),get('pd-review-add-image'),
    ...get('pd-review-previews').children.map(c=>c.children[1]),get('pd-review-submit')].filter(el=>!el.disabled);
  const createElement=doc.createElement;doc.createElement=tag=>{const el=createElement(tag);created.push(el);el.focus=()=>{doc.activeElement=el;};return el;};
  doc.addEventListener('breeze:review-delete-request',e=>intents.push(e.detail));
  const i18n=load('i18n.js').win.__i18n;i18n.current='vi';
  const product={id:17,name_vi:'Sản phẩm API',name_en:'API product',price:100000,images:[],category_slug:'sanpham-ao',
    size_configured:true,variants:[{id:171,size:'M',available:true}]};
  const r=load('page-product.js',{doc,deps:['routes.js','utils-format.js','utils-i18n.js'],
    globals:{localStorage:{getItem:()=>null,setItem:(k,v)=>writes.push(['local',k,v])},
      sessionStorage:{getItem:()=>null,setItem:(k,v)=>writes.push(['session',k,v])},confirm(){throw Error('native confirm is forbidden');},
      URL:{createObjectURL(file){const url='blob:owner-test-'+(urls.length+1);urls.push({file,url});return url;},revokeObjectURL:url=>revoked.push(url)},
      fetch:async url=>{calls.push(url);return {ok:true,status:200,json:async()=>url.endsWith('/17')?product:[]};}},
    window:{AuthHelper:{getUser:()=>({uid:'owner'}),isLoggedIn:()=>true,apiFetch:async(url,settings={})=>{
      authCalls.push({url,settings});
      const body=url.endsWith('/reviews/me')?{review:backendReview,purchasedVariants:backendReview&&backendReview.variant?[{variant_id:backendReview.variant.id,size_snapshot:'M',color_snapshot:'Đen'}]:[]}
        :settings.method?{code:'REVIEW_SERVER_ERROR'}:{canReview:true,hasReviewed:false,purchasedVariants:[{variant_id:171,size_snapshot:'M'}]};
      return {ok:!settings.method,status:settings.method?500:200,json:async()=>body};
    }},location:{search:'?id=17',href:'product.html?id=17'},__i18n:i18n}});
  return {...r,get,stars,calls,writes,urls,revoked,created,intents,i18n,api:r.win.BreezeProductReviews,authCalls,setBackendReview(value){backendReview=value;}};
}
const paint=r=>r.stars.map(b=>b.querySelector('span').textContent).join('');
function files(r,count){r.get('pd-review-files').files=Array.from({length:count},(_,i)=>({name:'test-'+i+'.png',type:'image/png'}));r.get('pd-review-files').fire('change');}
function key(r,key,shiftKey=false){let prevented=false;r.doc.fire('keydown',{key,shiftKey,preventDefault(){prevented=true;}});return prevented;}
(async()=>{
  eq('edit continues to use one review form',(view.match(/id="pd-review-form"/g)||[]).length,1);
  eq('edit continues to use one textarea',(view.match(/<textarea\b/g)||[]).length,1);
  check('delete confirmation starts hidden',/id="pd-review-delete-overlay" hidden/.test(view));
  check('delete confirmation has accessible title and description',/id="pd-review-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pd-review-delete-title" aria-describedby="pd-review-delete-description"/.test(view));
  check('delete confirmation has translated cancel and delete buttons',/id="pd-review-delete-cancel" data-i18n="com.cancel"/.test(view)&&/id="pd-review-delete-confirm" data-i18n="com.delete"/.test(view));
  check('owner and confirmation buttons have focus styles and touch targets',/\.pd-review-owner-action:focus-visible/.test(css)&&/\.pd-review-owner-action\s*\{[^}]*min-height: 44px/.test(css));
  check('confirmation is small and responsive',/\.pd-review-delete-modal\s*\{[^}]*width: 100%; max-width: 440px/.test(css)&&/\.pd-review-delete-actions\s*\{[^}]*flex-wrap: wrap/.test(css));
  const r=setup();await wait();const initialCalls=r.calls.length;
  eq('production default CTA stays create',r.get('pd-review-open').textContent,'Đánh giá sản phẩm');
  eq('production default form stays create',r.get('pd-review-form').getAttribute('data-review-mode'),'create');
  eq('production default contains no owner action',r.created.filter(el=>el.className==='pd-review-owner-action').length,0);
  check('production does not populate a review, rating, variant or image',!r.get('pd-reviews-list').children.length&&r.get('pd-reviews-list').innerHTML===''&&paint(r)==='☆☆☆☆☆'&&r.get('pd-review-comment').value===''&&r.get('pd-review-variant').options.length===1&&!r.get('pd-review-previews').children.length);
  check('production never calls its data seams with demo data',!/(?:BreezeProductReviews\.(?:setOwnerReview|renderActions)|populateReviewForm)\(\s*\{/.test(source));
  const created=r.created.length;
  for(const review of [null,{...REVIEW,isOwner:false},{...REVIEW,isOwner:undefined},{...REVIEW,isOwner:'true'},{...REVIEW,productId:999}]){
    eq('non-owner, unconfirmed or other-product review has no action DOM',r.api.renderActions(review),null);
  }
  eq('non-owner actions are absent rather than hidden or disabled',r.created.length,created);
  const actions=r.api.renderActions(REVIEW),[edit,remove]=actions.children;
  eq('confirmed owner gets Edit and Delete labels',actions.children.map(el=>el.textContent),['Sửa','Xóa']);
  check('owner actions are enabled native keyboard buttons',actions.children.every(el=>el.tagName==='BUTTON'&&el.type==='button'&&!el.disabled&&!el.hidden));
  eq('owner actions target the correct dialogs',actions.children.map(el=>el.getAttribute('aria-controls')),['pd-review-dialog','pd-review-delete-dialog']);
  // A test-only public card lets this test detect any unintended delete/update DOM change.
  const card=El('article');card.textContent='Test-only review card';card.appendChild(actions);r.get('pd-reviews-list').appendChild(card);
  const before=JSON.stringify(REVIEW),form=r.get('pd-review-form');
  r.doc.body.style.overflow='auto';r.setBackendReview(REVIEW);edit.click();await wait();
  check('Edit opens existing modal and form',!r.get('pd-review-overlay').hidden&&r.get('pd-review-form')===form&&r.get('pd-review-delete-overlay').hidden);
  eq('Edit explicitly switches mode',form.getAttribute('data-review-mode'),'edit');
  eq('Edit title is translated',r.get('pd-review-title').textContent,'Chỉnh sửa đánh giá');
  eq('Edit submit uses Save changes in the same footer',r.get('pd-review-submit').textContent,'Lưu thay đổi');
  eq('Edit prefills four stars on original component',paint(r),'★★★★☆');
  eq('Edit prefills the attached purchased variant',r.get('pd-review-variant').value,'777');
  eq('variant label is inserted as safe text',r.get('pd-review-variant').options[1].textContent,'Purchased variant <M>');
  check('edit does not infer purchase history from product variants',r.get('pd-review-variant').options.length===2&&r.get('pd-review-variant').value!=='171'&&r.get('pd-root').getAttribute('data-variant-id')===null);
  eq('Edit prefills existing comment',r.get('pd-review-comment').value,REVIEW.comment);
  eq('Edit counter follows existing comment',r.get('pd-review-comment-count').textContent,REVIEW.comment.length+' / 1000');
  eq('Edit prefills only supplied existing images',r.get('pd-review-previews').children.map(c=>c.children[0].src),REVIEW.images.map(i=>i.url));
  check('valid supplied review enables Save changes',!r.get('pd-review-submit').disabled);
  check('Edit locks scroll and focuses existing close button',r.doc.body.style.overflow==='hidden'&&r.doc.activeElement===r.get('pd-review-close'));
  eq('existing images allocate no local Blob URLs',r.urls.length,0);
  files(r,4);
  eq('old and new images together are capped at five',r.get('pd-review-previews').children.length,5);
  eq('only three available slots allocate local Blob URLs',r.urls.length,3);
  check('full mixed draft disables picker and explains limit',r.get('pd-review-add-image').disabled&&r.get('pd-review-images-error').textContent===r.i18n.t('pd.reviewImageLimit'));
  r.get('pd-review-previews').children[0].children[1].click();
  eq('existing image can be removed from draft',r.get('pd-review-previews').children.length,4);
  eq('removing an existing image never revokes its URL',r.revoked.length,0);
  eq('removing existing image leaves source review untouched',JSON.stringify(REVIEW),before);
  check('removing old image enables picker and focuses it',!r.get('pd-review-add-image').disabled&&r.doc.activeElement===r.get('pd-review-add-image'));
  r.get('pd-review-previews').children[1].children[1].click();
  eq('removing a new image revokes only its local URL',r.revoked,[r.urls[0].url]);
  files(r,2);eq('freed slots can be replaced without exceeding five',r.get('pd-review-previews').children.length,5);
  r.get('pd-review-comment').value='Changed in draft';r.get('pd-review-comment').fire('input');
  let prevented=false;form.fire('submit',{preventDefault(){prevented=true;}});await wait();
  check('failed Save reports error, never false success',prevented&&!r.get('pd-review-feedback').hidden&&r.get('pd-review-feedback').textContent===r.i18n.t('pd.reviewRequestError'));
  eq('Save changes does not refetch product APIs',r.calls.length,initialCalls);
  eq('Save changes cannot mutate supplied review',JSON.stringify(REVIEW),before);
  check('Save changes cannot update public review card',card.textContent==='Test-only review card'&&r.get('pd-reviews-list').children[0]===card);
  r.i18n.current='en';r.doc.fire('langchange');
  eq('Edit title and submit follow language change',[r.get('pd-review-title').textContent,r.get('pd-review-submit').textContent],['Edit review','Save changes']);
  eq('Edit feedback follows language change',r.get('pd-review-feedback').textContent,r.i18n.t('pd.reviewRequestError'));
  eq('language change preserves draft text',r.get('pd-review-comment').value,'Changed in draft');
  const staleImage=r.get('pd-review-previews').children[0].children[0];
  r.get('pd-review-close').click();
  check('closing Edit restores scroll and original Edit trigger focus',r.doc.body.style.overflow==='auto'&&r.doc.activeElement===edit&&r.get('pd-review-overlay').hidden);
  eq('closing Edit resets mode and labels',[form.getAttribute('data-review-mode'),r.get('pd-review-title').textContent,r.get('pd-review-submit').textContent],['create','Write a review','Submit review']);
  check('closing Edit clears comment, counter, rating and previews',r.get('pd-review-comment').value===''&&r.get('pd-review-comment-count').textContent==='0 / 1000'&&paint(r)==='☆☆☆☆☆'&&!r.get('pd-review-previews').children.length);
  check('closing Edit removes edit-only option and restores disabled select',r.get('pd-review-variant').options.length===1&&r.get('pd-review-variant').disabled&&r.get('pd-review-variant').value==='');
  check('all local Blob URLs are released exactly once',r.urls.every(({url})=>r.revoked.filter(u=>u===url).length===1));
  check('no existing URL was released',r.revoked.every(url=>url.startsWith('blob:owner-test-')));
  staleImage.fire('error');check('stale existing-image errors cannot modify closed draft',r.get('pd-review-images-error').hidden);
  r.setBackendReview(null);r.api.setOwnerReview(null);r.get('pd-review-open').click();await wait();
  check('create still opens cleanly after edit with no confirmed CTA state',!r.get('pd-review-overlay').hidden&&form.getAttribute('data-review-mode')==='create'&&paint(r)==='☆☆☆☆☆'&&!r.get('pd-review-variant').disabled);
  r.get('pd-review-close').click();
  r.setBackendReview(REVIEW);r.api.setOwnerReview(REVIEW);
  eq('confirmed real-data seam changes CTA to Edit review',r.get('pd-review-open').textContent,'Edit review');
  check('setting owner state does not open modal or render card',r.get('pd-review-overlay').hidden&&r.get('pd-reviews-list').children.length===1);
  r.get('pd-review-open').click();await wait();eq('one-owner-review CTA opens edit rather than create',form.getAttribute('data-review-mode'),'edit');
  eq('CTA edit repopulates original, unchanged comment',r.get('pd-review-comment').value,REVIEW.comment);
  key(r,'Escape');check('Escape closes edit and returns focus to CTA',r.get('pd-review-overlay').hidden&&r.doc.activeElement===r.get('pd-review-open'));
  r.get('pd-review-open').click();await wait();r.get('pd-review-overlay').fire('click',{target:r.get('pd-review-overlay')});
  check('edit backdrop cleanup restores disabled variant and scroll',r.get('pd-review-overlay').hidden&&r.get('pd-review-variant').disabled&&r.doc.body.style.overflow==='auto');
  r.api.setOwnerReview({...REVIEW,isOwner:false});eq('unconfirmed ownership clears Edit CTA',r.get('pd-review-open').textContent,'Review product');
  r.api.setOwnerReview({...REVIEW,productId:999});eq('another product cannot set owner CTA',r.get('pd-review-open').textContent,'Review product');
  r.i18n.current='vi';r.doc.fire('langchange');remove.click();
  check('Delete opens only small confirmation, not edit form',!r.get('pd-review-delete-overlay').hidden&&r.get('pd-review-overlay').hidden);
  check('Delete confirmation locks scroll and starts on Cancel',r.doc.body.style.overflow==='hidden'&&r.doc.activeElement===r.get('pd-review-delete-cancel'));
  eq('opening Delete does not emit request intent',r.intents.length,0);
  check('Shift+Tab wraps Cancel to Delete',key(r,'Tab',true)&&r.doc.activeElement===r.get('pd-review-delete-confirm'));
  check('Tab wraps Delete to Cancel',key(r,'Tab')&&r.doc.activeElement===r.get('pd-review-delete-cancel'));
  r.get('pd-review-delete-overlay').fire('click',{target:r.get('pd-review-delete-dialog')});check('clicking confirmation content keeps it open',!r.get('pd-review-delete-overlay').hidden);
  r.get('pd-review-delete-cancel').click();
  check('Cancel closes backdrop and restores scroll/focus',r.get('pd-review-delete-overlay').hidden&&r.doc.body.style.overflow==='auto'&&r.doc.activeElement===remove);
  remove.click();check('Escape closes confirmation',key(r,'Escape')&&r.get('pd-review-delete-overlay').hidden&&r.doc.body.style.overflow==='auto');
  remove.click();r.get('pd-review-delete-overlay').fire('click',{target:r.get('pd-review-delete-overlay')});
  check('confirmation backdrop closes with correct focus',r.get('pd-review-delete-overlay').hidden&&r.doc.activeElement===remove);
  eq('Cancel/Escape/backdrop never emit delete intent',r.intents.length,0);
  r.api.setOwnerReview(REVIEW);remove.click();r.get('pd-review-delete-confirm').click();r.get('pd-review-delete-confirm').click();await wait();
  eq('Confirm Delete sends one authenticated DELETE despite double click',r.authCalls.filter(c=>c.settings.method==='DELETE').length,1);
  check('Confirm Delete reports unavailable and keeps cancellation possible',!r.get('pd-review-delete-feedback').hidden&&r.get('pd-review-delete-feedback').textContent===r.i18n.t('pd.reviewRequestError')&&r.doc.activeElement===r.get('pd-review-delete-cancel'));
  eq('failed confirmation does not emit legacy mutation intent',r.intents.length,0);
  check('Confirm Delete does not remove or update public card',r.get('pd-reviews-list').children.length===1&&r.get('pd-reviews-list').children[0]===card&&card.textContent==='Test-only review card');
  eq('Confirm Delete leaves review data intact',JSON.stringify(REVIEW),before);
  eq('Confirm Delete does not pretend owner review was deleted',r.get('pd-review-open').textContent,'Chỉnh sửa đánh giá');
  r.i18n.current='en';r.doc.fire('langchange');eq('delete feedback follows language change',r.get('pd-review-delete-feedback').textContent,r.i18n.t('pd.reviewRequestError'));
  r.get('pd-review-delete-cancel').click();check('closing confirmed dialog resets feedback and confirm control',r.get('pd-review-delete-feedback').hidden&&!r.get('pd-review-delete-confirm').disabled&&r.doc.body.style.overflow==='auto');
  r.get('pd-review-delete-confirm').click();eq('closed dialog cannot send another DELETE',r.authCalls.filter(c=>c.settings.method==='DELETE').length,1);
  remove.click();r.api.setOwnerReview(null);check('clearing supplied owner state closes confirmation and restores create CTA',r.get('pd-review-delete-overlay').hidden&&r.doc.body.style.overflow==='auto'&&r.get('pd-review-open').textContent==='Review product');
  // Draft validation/cleanup also covers missing or malformed future fields.
  const malformed={...REVIEW,rating:9,variant:null,comment:'a'.repeat(999)+'😀',images:Array.from({length:6},(_,i)=>({id:100+i,url:'/uploads/test-'+i+'.png'}))};
  r.setBackendReview(malformed);r.api.renderActions(malformed).children[0].click();await wait();
  check('invalid supplied rating is not accepted',paint(r)==='☆☆☆☆☆'&&r.get('pd-review-submit').disabled);
  check('missing attached variant remains unavailable rather than using product selection',r.get('pd-review-variant').disabled&&r.get('pd-review-variant').options.length===1);
  eq('prefilled overflow is trimmed without half an emoji',r.get('pd-review-comment').value,'a'.repeat(999));
  eq('prefilled overflow counter matches trimmed text',r.get('pd-review-comment-count').textContent,'999 / 1000');
  check('even supplied existing images cannot exceed five',r.get('pd-review-previews').children.length===5&&!r.get('pd-review-images-error').hidden);
  r.get('pd-review-previews').children[0].children[0].fire('error');
  check('broken existing image is removed only from draft and not revoked',r.get('pd-review-previews').children.length===4&&r.get('pd-review-images-error').textContent===r.i18n.t('pd.reviewPreviewError'));
  r.get('pd-review-close').click();
  const listeners=r.doc._l.keydown.length;
  r.setBackendReview(REVIEW);for(let i=0;i<10;i++){edit.click();await wait();remove.click();r.get('pd-review-delete-cancel').click();}
  check('switching Edit to Delete leaves one overlay and restores scroll',r.get('pd-review-overlay').hidden&&r.get('pd-review-delete-overlay').hidden&&r.doc.body.style.overflow==='auto');
  eq('repeated mode changes never register duplicate keyboard listeners',r.doc._l.keydown.length,listeners);
  eq('owner interactions do not refetch product/gallery APIs',r.calls.length,initialCalls);
  eq('all owner interactions write no local/session storage',r.writes.length,0);
  eq('all owner interactions leave URL unchanged',r.win.location.href,'product.html?id=17');
  eq('VI/EN edit/delete strings are complete',['pd.editReview','pd.reviewSaveChanges','pd.reviewDeleteTitle','pd.reviewDeleteDescription','com.cancel','com.edit','com.delete'].map(k=>r.i18n.t(k)),['Edit review','Save changes','Delete review?','Are you sure you want to delete this review?','Cancel','Edit','Delete']);
})().catch(e=>{console.error(e);process.exitCode=1;});
