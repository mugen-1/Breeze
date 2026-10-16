const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const fs=require('fs'),path=require('path');
const view=fs.readFileSync(path.join(__dirname,'../../../server/views/pages/product.ejs'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../../../server/views/partials/product-style.ejs'),'utf8');
const P={id:17,name_vi:'Áo từ API',name_en:'API shirt',category_slug:'sanpham-ao',images:['shirt.png'],price:100000,
  size_configured:true,color_configured:false,variants:[{id:171,size:'M',available:true}]};
function setup(){
  const doc=makeDoc(),calls=[],writes=[],urls=[],revoked=[];
  const get=id=>doc.getElementById(id),stars=[];
  doc._qs['.pd-add']=El('button');
  for(let n=1;n<=5;n++){
    const b=El('button'),span=El('span');b.setAttribute('data-review-rating',n);
    b.querySelector=()=>span;b._closest={'[data-review-rating]':b};
    b.focus=()=>{doc.activeElement=b;};stars.push(b);
  }
  get('pd-review-stars').querySelectorAll=()=>stars;
  get('pd-review-overlay').hidden=true;get('pd-review-feedback').hidden=true;
  Object.defineProperty(get('pd-review-variant'),'options',{get(){return this.children;}});
  const focusable=['pd-review-close','pd-review-comment','pd-review-add-image','pd-review-submit'];
  for(const id of focusable.concat('pd-review-open','pd-review-variant'))get(id).focus=()=>{doc.activeElement=get(id);};
  get('pd-review-dialog').querySelectorAll=()=>[get('pd-review-close'),...stars,get('pd-review-variant'),get('pd-review-comment'),get('pd-review-add-image'),
    ...get('pd-review-previews').children.map(c=>c.children[1]),get('pd-review-submit')].filter(el=>!el.disabled);
  const createElement=doc.createElement;doc.createElement=tag=>{const el=createElement(tag);el.focus=()=>{doc.activeElement=el;};return el;};
  const i18n=load('i18n.js').win.__i18n;i18n.current='vi';
  const reviewCalls=[];
  const AuthHelper={getUser:()=>({uid:'test-owner'}),isLoggedIn:()=>true,apiFetch:async(url,options={})=>{
    reviewCalls.push({url,options});if(url.endsWith('/reviews/me'))return {ok:true,status:200,json:async()=>({review:null,purchasedVariants:[]})};return options.method==='POST'
      ? {ok:false,status:500,json:async()=>({code:'REVIEW_SERVER_ERROR'})}
      : {ok:true,status:200,json:async()=>({canReview:true,hasReviewed:false,purchasedVariants:[{variant_id:171,size_snapshot:'M',color_snapshot:null}]})};
  }};
  const r=load('page-product.js',{doc,deps:['routes.js','utils-format.js','utils-i18n.js'],
    globals:{localStorage:{getItem:()=>null,setItem:(k,v)=>writes.push([k,v])},
      URL:{createObjectURL(file){if(file.fail)throw Error('cannot preview');const url='blob:local-'+(urls.length+1);urls.push({file,url});return url;},revokeObjectURL:url=>revoked.push(url)},
      fetch:async url=>{calls.push(url);return {ok:true,status:200,json:async()=>url.endsWith('/17')?P:[]};}},
    window:{AuthHelper,location:{search:'?id=17',href:'product.html?id=17'},__i18n:i18n}});
  return {...r,get,stars,calls,reviewCalls,writes,urls,revoked,i18n};
}
function star(r,event,n,extra={}){r.get('pd-review-stars').fire(event,{target:r.stars[n-1],...extra});}
function paint(r){return r.stars.map(b=>b.querySelector('span').textContent).join('');}
function files(r,list){r.get('pd-review-files').files=list;r.get('pd-review-files').value='chosen';r.get('pd-review-files').fire('change');}
const image=n=>({name:'local-'+n+'.png',type:'image/png'});
(async()=>{
  eq('markup supplies five star controls',Array.from(view.matchAll(/data-review-rating="(\d)"/g),m=>m[1]),['1','2','3','4','5']);
  check('rating has required accessible radio group',/id="pd-review-stars"[^>]*role="radiogroup"[^>]*aria-required="true"/.test(view));
  check('purchased select is disabled with only a placeholder',/id="pd-review-variant" required disabled/.test(view)&&/value="" selected disabled data-i18n="pd.reviewChooseVariant"/.test(view));
  const section=view.slice(view.indexOf('id="pd-review-variant"'),view.indexOf('id="pd-review-variant-error"'));
  eq('no invented purchased options',(section.match(/<option /g)||[]).length,1);
  check('comment optional with 1000 native limit',/<textarea id="pd-review-comment"[^>]*maxlength="1000"/.test(view)&&!/<textarea[^>]*required/.test(view));
  check('image picker accepts the supported formats and multiple selection',/type="file" id="pd-review-files" accept="image\/png,image\/jpeg,image\/webp" multiple/.test(view));
  check('Submit is centered inside the form footer',/class="pd-review-footer">\s*<button type="submit"/.test(view)&&/\.pd-review-footer\s*\{[^}]*justify-content: center/.test(css));
  check('previews cover uniformly and wrap; stars are touch sized',/\.pd-review-preview img\s*\{[^}]*object-fit: cover/.test(css)&&/\.pd-review-images\s*\{[^}]*flex-wrap: wrap/.test(css)&&/width: 44px; height: 44px/.test(css));
  const r=setup();await wait();r.get('pd-review-open').click();await wait();
  eq('all five stars begin outline without a rating',paint(r),'☆☆☆☆☆');
  check('no radio is checked by default',r.stars.every(b=>b.getAttribute('aria-checked')==='false'));
  check('purchased selector is enabled but Submit requires a selection',!r.get('pd-review-variant').disabled&&r.get('pd-review-submit').disabled);
  check('validation is hidden before interaction',r.get('pd-review-rating-error').hidden&&r.get('pd-review-variant-error').hidden);
  let pickerClicks=0;r.get('pd-review-files').click=()=>{pickerClicks++;};r.get('pd-review-add-image').click();
  eq('Add Image opens the local file picker',pickerClicks,1);
  star(r,'mouseover',4);eq('hover previews first through fourth star',paint(r),'★★★★☆');
  check('hover never commits a rating',r.stars.every(b=>b.getAttribute('aria-checked')==='false')&&r.get('pd-review-submit').disabled);
  r.get('pd-review-stars').fire('mouseleave');eq('leaving unselected stars clears preview',paint(r),'☆☆☆☆☆');
  star(r,'click',4);eq('click chooses four stars',paint(r),'★★★★☆');
  eq('selected rating is represented by one checked radio',r.stars.map(b=>b.getAttribute('aria-checked')),['false','false','false','true','false']);
  check('rating alone cannot enable Submit',r.get('pd-review-submit').disabled);
  star(r,'mouseover',2);eq('hover can preview a different rating',paint(r),'★★☆☆☆');
  r.get('pd-review-stars').fire('mouseleave');eq('mouseleave restores selected rating',paint(r),'★★★★☆');
  star(r,'click',1);eq('click updates selected rating',paint(r),'★☆☆☆☆');
  star(r,'keydown',1,{key:'ArrowRight'});eq('keyboard ArrowRight selects next rating',paint(r),'★★☆☆☆');
  check('keyboard moves focus to selected star',r.doc.activeElement===r.stars[1]);
  star(r,'keydown',2,{key:'End'});eq('End selects five',paint(r),'★★★★★');
  star(r,'keydown',5,{key:'ArrowRight'});eq('arrow navigation wraps to one',paint(r),'★☆☆☆☆');
  star(r,'keydown',1,{key:'ArrowLeft'});eq('reverse arrow navigation wraps to five',paint(r),'★★★★★');
  star(r,'keydown',5,{key:'Home'});eq('Home selects one',paint(r),'★☆☆☆☆');
  r.get('pd-review-comment').value='Cảm nhận';r.get('pd-review-comment').fire('input');eq('comment counter updates immediately',r.get('pd-review-comment-count').textContent,'8 / 1000');
  r.get('pd-review-comment').value='a'.repeat(1010);r.get('pd-review-comment').fire('input');
  eq('programmatic or pasted overflow is trimmed to 1000',r.get('pd-review-comment').value.length,1000);
  eq('counter respects the same maximum',r.get('pd-review-comment-count').textContent,'1000 / 1000');
  r.get('pd-review-comment').value='a'.repeat(999)+'😀';r.get('pd-review-comment').fire('input');
  check('trimming at the limit never leaves half an emoji',r.get('pd-review-comment').value==='a'.repeat(999)&&r.get('pd-review-comment-count').textContent==='999 / 1000');
  r.get('pd-review-comment').value='';r.get('pd-review-comment').fire('input');
  r.get('pd-review-variant').value='not-an-option';r.get('pd-review-variant').fire('change');check('unrecognized selected option cannot enable Submit',r.get('pd-review-submit').disabled);
  r.get('pd-review-variant').value='171';r.get('pd-review-variant').fire('change');
  check('rating and a supplied option permit UI submit without comment or images',!r.get('pd-review-submit').disabled);
  const calls=r.calls.length;let prevented=false;
  r.get('pd-review-form').fire('submit',{preventDefault(){prevented=true;}});
  await wait();
  check('failed API submit prevents navigation and reports translated error',prevented&&!r.get('pd-review-feedback').hidden&&r.get('pd-review-feedback').textContent===r.i18n.t('pd.reviewRequestError'));
  eq('submit sends one authenticated backend request',r.reviewCalls.filter(c=>c.options.method==='POST').length,1);eq('submit writes no persistent review/draft',r.writes.length,0);
  r.get('pd-review-close').click();r.get('pd-review-open').click();await wait();
  check('close/open resets comment, rating and selected option',paint(r)==='☆☆☆☆☆'&&r.get('pd-review-comment').value===''&&r.get('pd-review-variant').value==='');
  r.get('pd-review-variant').value='171';r.get('pd-review-variant').fire('change');check('variant alone cannot enable Submit',r.get('pd-review-submit').disabled);
  r.get('pd-review-variant').disabled=true;r.get('pd-review-form').fire('submit');
  check('attempted submit validates missing rating and variant',!r.get('pd-review-rating-error').hidden&&!r.get('pd-review-variant-error').hidden);
  star(r,'click',3);check('selecting rating clears only its validation error',r.get('pd-review-rating-error').hidden&&!r.get('pd-review-variant-error').hidden);
  files(r,[{name:'notes.txt',type:'text/plain'},image(1),{name:'unknown',type:''}]);
  eq('only images are accepted',r.get('pd-review-previews').children.length,1);
  check('invalid file receives translated feedback',r.get('pd-review-images-error').textContent.includes(r.i18n.t('pd.reviewInvalidImage')));
  eq('preview uses local Blob URL',r.get('pd-review-previews').children[0].children[0].src,r.urls[0].url);
  eq('file input is cleared to allow selecting again',r.get('pd-review-files').value,'');
  files(r,Array.from({length:8},(_,i)=>image(i+2)));
  eq('one batch cannot exceed five total images',r.get('pd-review-previews').children.length,5);
  check('overflow is explained and picker disabled',r.get('pd-review-images-error').textContent.includes(r.i18n.t('pd.reviewImageLimit'))&&r.get('pd-review-add-image').disabled&&r.get('pd-review-files').disabled);
  eq('no excess object URLs allocated',r.urls.length,5);
  r.get('pd-review-add-image').click();eq('full picker cannot open another selection',pickerClicks,1);
  const firstUrl=r.urls[0].url;r.get('pd-review-previews').children[0].children[1].click();
  eq('remove deletes one preview',r.get('pd-review-previews').children.length,4);
  eq('removed Blob URL released once',r.revoked.filter(u=>u===firstUrl).length,1);
  check('remove restores picker and useful focus',!r.get('pd-review-add-image').disabled&&r.doc.activeElement===r.get('pd-review-add-image'));
  files(r,[image(20)]);eq('removed slot can be reused',r.get('pd-review-previews').children.length,5);
  r.i18n.current='en';r.doc.fire('langchange');
  eq('star labels follow VI/EN',r.stars[0].getAttribute('aria-label'),'1 out of 5 stars');
  eq('preview removal label follows VI/EN',r.get('pd-review-previews').children[0].children[1].getAttribute('aria-label'),'Remove image 1');
  eq('language change preserves Blob URLs',r.urls.length,6);
  r.get('pd-review-close').click();
  check('closing releases every remaining Blob URL exactly once',r.urls.every(({url})=>r.revoked.filter(u=>u===url).length===1));
  check('closing clears previews/input and re-enables picker',!r.get('pd-review-previews').children.length&&r.get('pd-review-files').value===''&&!r.get('pd-review-add-image').disabled);
  eq('closing resets comment counter',r.get('pd-review-comment-count').textContent,'0 / 1000');
  r.get('pd-review-open').click();await wait();files(r,[{...image(21),fail:true}]);check('preview allocation failure does not crash or retain files',r.get('pd-review-previews').children.length===0&&r.get('pd-review-images-error').textContent===r.i18n.t('pd.reviewPreviewError'));
  files(r,[image(22)]);const stale=r.get('pd-review-previews').children[0].children[0];stale.fire('error');
  check('broken image releases its URL and reports failure',!r.get('pd-review-previews').children.length&&r.get('pd-review-images-error').textContent===r.i18n.t('pd.reviewPreviewError'));
  files(r,[image(23)]);r.doc.fire('keydown',{key:'Escape'});
  check('Escape also cleans up previews and restores scroll',r.get('pd-review-overlay').hidden&&!r.get('pd-review-previews').children.length&&r.doc.body.style.overflow==='');
  stale.fire('error');check('stale image error after close cannot change new form state',r.get('pd-review-images-error').hidden);
  r.get('pd-review-open').click();await wait();files(r,[image(24)]);r.get('pd-review-overlay').fire('click',{target:r.get('pd-review-overlay')});
  check('backdrop closes and releases images',r.get('pd-review-overlay').hidden&&!r.get('pd-review-previews').children.length&&r.urls.every(({url})=>r.revoked.filter(u=>u===url).length===1));
  r.get('pd-review-open').click();await wait();r.get('pd-review-close').focus();let tabPrevented=false;
  r.doc.fire('keydown',{key:'Tab',preventDefault(){tabPrevented=true;}});check('Tab can reach form controls instead of staying on X',!tabPrevented);
  r.doc.fire('keydown',{key:'Tab',shiftKey:true});eq('Shift+Tab wraps from X to last enabled form control',r.doc.activeElement,r.get('pd-review-add-image'));
  r.doc.fire('keydown',{key:'Tab'});eq('Tab wraps back to X from last control',r.doc.activeElement,r.get('pd-review-close'));
  eq('all interactions leave route unchanged',r.win.location.href,'product.html?id=17');
  eq('review interactions do not refetch product/gallery APIs',r.calls.length,calls);eq('no review storage was written',r.writes.length,0);
})().catch(e=>{console.error(e);process.exitCode=1;});
