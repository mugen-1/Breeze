const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const fs=require('fs'),path=require('path');
const view=fs.readFileSync(path.join(__dirname,'../../../server/views/pages/product.ejs'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../../../server/views/partials/product-style.ejs'),'utf8');
const P={id:17,name_vi:'Áo BREEZE <Sport>',name_en:'BREEZE shirt <Sport>',price:100000,sale_price:null,
  description_vi:'Áo thật từ API',category_slug:'sanpham-ao',images:['shirt.png','shirt-back.png'],
  size_configured:true,color_configured:false,variants:[{id:171,size:'M',available:true}]};
function setup(product=P,search='?id=17'){
  const doc=makeDoc(),calls=[],created=[],storage={};
  const add=El('button');add.setAttribute('data-action','add-to-cart');
  doc._qs['.pd-add']=add;
  const get=id=>doc.getElementById(id),root=get('pd-root'),review=get('pd-review-open');
  get('pd-review-overlay').hidden=true;review.disabled=true;get('pd-review-img').hidden=true;
  root.querySelector=selector=>({'.product-name':get('pd-name'),'.product-price':get('pd-price'),img:get('pd-main-img')})[selector]||null;
  const main=get('pd-main-img'),getAttribute=main.getAttribute;
  main.getAttribute=k=>k==='src'?main.src:getAttribute(k);
  add._closest={'.product-item':root,'[data-action]':add};
  for(const button of [review,get('pd-review-close')])button.focus=()=>{doc.activeElement=button;};
  const createElement=doc.createElement;doc.createElement=tag=>{created.push(tag);return createElement(tag);};
  const reviewCalls=[];
  const AuthHelper={getUser:()=>({uid:'owner'}),isLoggedIn:()=>true,apiFetch:async url=>{
    if(url.endsWith('/reviews/me'))return {ok:true,status:200,json:async()=>({review:null,purchasedVariants:[]})};
    reviewCalls.push(url);return {ok:true,status:200,json:async()=>({canReview:true,hasReviewed:false,purchasedVariants:[{variant_id:171,size_snapshot:'M'}]})};
  }};
  const i18n=load('i18n.js').win.__i18n;i18n.current='vi';
  const r=load('page-product.js',{doc,deps:['routes.js','utils-format.js','utils-i18n.js','cart.js'],
    globals:{setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>{storage[k]=v;}},
      fetch:async url=>{calls.push(url);const detail=/\/api\/products\/17$/.test(url);
        return {ok:product!==404,status:product===404?404:200,json:async()=>detail?product:[]};}},
    window:{AuthHelper,API_BASE:'',location:{search,href:'product.html?id=17'},__i18n:i18n,_injectAddToCartButtons(){}}});
  r.win.addToCart=r.sandbox.addToCart;
  return {...r,get,add,calls,reviewCalls,created,review,root,i18n};
}
(async()=>{
  check('Review CTA is directly below Add to Cart in product info',/<button[^>]*class="pd-add"[^>]*>[\s\S]*?<\/button>\s*<button[^>]*id="pd-review-open"/.test(view));
  eq('one static review modal instance', (view.match(/id="pd-review-overlay"/g)||[]).length,1);
  check('accessible dialog links title and subtitle',/id="pd-review-dialog"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="pd-review-title"[^>]*aria-describedby="pd-review-subtitle"/.test(view));
  check('content now contains UI-2 form without public review records',/id="pd-review-content"[\s\S]*id="pd-review-form"/.test(view)&&!/\breview-(?:card|average|count)\b/.test(view.slice(view.indexOf('id="pd-review-overlay"'))));
  check('modal is hidden initially, bounded in viewport and has mobile spacing',/id="pd-review-overlay" hidden/.test(view)&&/\.pd-review-overlay\[hidden\]\s*\{\s*display: none/.test(css)&&/max-width: 800px/.test(css)&&/100dvh - 24px/.test(css));
  check('CTA and close button have focus styles and a 44px close target',/\.pd-review:focus-visible/.test(css)&&/\.pd-review-close:focus-visible/.test(css)&&/width: 44px; height: 44px/.test(css));
  let r=setup();r.review.click();await wait();eq('loading product cannot open blank identity',r.get('pd-review-overlay').hidden,true);
  await wait();
  eq('product loaded enables Review independently of unselected size', [r.review.disabled,r.add.disabled],[false,true]);
  const initialCalls=r.calls.length,initialOverlay=r.get('pd-review-overlay');
  r.doc.body.style.overflow='auto';r.review.click();await wait();
  eq('eligible click opens overlay',r.get('pd-review-overlay').hidden,false);
  eq('modal name is current API product, as safe text',r.get('pd-review-name').textContent,P.name_vi);
  eq('modal image is current product gallery image',r.get('pd-review-img').src,'shirt.png');
  eq('modal image alt uses product name',r.get('pd-review-img').alt,P.name_vi);
  eq('opening locks body scroll',r.doc.body.style.overflow,'hidden');
  eq('opening focuses close control',r.doc.activeElement,r.get('pd-review-close'));
  eq('opening does not navigate',r.win.location.href,'product.html?id=17');
  eq('opening requests real eligibility once',r.reviewCalls.length,1);
  eq('opening does not refetch product APIs',r.calls.length,initialCalls);
  r.doc.fire('click',{target:r.review});eq('Review click does not add to cart',r.sandbox.getCart().length,0);
  const listeners=(r.doc._l.keydown||[]).length;
  r.review.click();await wait();const openedCreated=r.created.length;r.review.click();await wait();eq('opening twice does not construct another modal',r.created.length,openedCreated);
  let prevented=false;r.doc.fire('keydown',{key:'Tab',preventDefault(){prevented=true;}});
  check('Tab stays inside the shell',prevented&&r.doc.activeElement===r.get('pd-review-close'));
  r.doc.fire('keydown',{key:'Tab',shiftKey:true});eq('Shift+Tab stays inside shell',r.doc.activeElement,r.get('pd-review-close'));
  r.get('pd-review-overlay').fire('click',{target:r.get('pd-review-dialog')});eq('clicking modal contents does not close',r.get('pd-review-overlay').hidden,false);
  r.get('pd-review-close').click();
  eq('X closes overlay',r.get('pd-review-overlay').hidden,true);
  eq('close restores prior scroll value',r.doc.body.style.overflow,'auto');
  eq('close returns focus to Review CTA',r.doc.activeElement,r.review);
  r.review.click();await wait();r.doc.fire('keydown',{key:'Escape'});
  check('Escape closes and restores scroll/focus',r.get('pd-review-overlay').hidden&&r.doc.body.style.overflow==='auto'&&r.doc.activeElement===r.review);
  r.review.click();await wait();r.get('pd-review-overlay').fire('click',{target:r.get('pd-review-overlay')});
  check('backdrop closes and restores scroll',r.get('pd-review-overlay').hidden&&r.doc.body.style.overflow==='auto');
  for(let i=0;i<20;i++){r.review.click();await wait();r.get('pd-review-close').click();}
  eq('reopening never registers duplicate key listeners',(r.doc._l.keydown||[]).length,listeners);
  check('reopening keeps the same modal instance',r.get('pd-review-overlay')===initialOverlay);
  eq('each reopening checks eligibility again',r.reviewCalls.length,23);
  r.get('pd-next').click();r.review.click();await wait();eq('modal reflects gallery image currently viewed',r.get('pd-review-img').src,'shirt-back.png');
  r.i18n.current='en';r.doc.fire('langchange');
  eq('open modal name follows language change',r.get('pd-review-name').textContent,P.name_en);
  eq('open modal alt follows language change',r.get('pd-review-img').alt,P.name_en);
  eq('three Review labels have English translations',['pd.reviewProduct','pd.writeReview','pd.reviewExperience'].map(k=>r.i18n.t(k)),['Review product','Write a review','Share your experience']);
  r.i18n.current='vi';eq('three Review labels have Vietnamese translations',['pd.reviewProduct','pd.writeReview','pd.reviewExperience'].map(k=>r.i18n.t(k)),['Đánh giá sản phẩm','Viết đánh giá','Chia sẻ trải nghiệm của bạn']);
  r.get('pd-review-close').click();
  const size=El('button');size.setAttribute('data-variant-id','171');size._closest={'.pd-size':size};
  r.get('pd-sizes').fire('click',{target:size});
  const attrs=JSON.stringify(r.root._attrs);r.review.click();await wait();r.get('pd-review-close').click();
  eq('Review preserves selected variant, size and stock metadata',JSON.stringify(r.root._attrs),attrs);
  eq('Add to Cart still enabled after modal interaction',r.add.disabled,false);
  r.doc.fire('click',{target:r.add});
  eq('real cart delegation still adds exact selected product/variant',r.sandbox.getCart().map(it=>[it.id,it.variant_id,it.size,it.qty]),[[17,171,'M',1]]);
  r.review.click();await wait();r.get('pd-review-close').click();eq('Review preserves existing cart quantity',r.sandbox.getCart()[0].qty,1);
  r.get('sg-open').click();r.review.click();await wait();
  check('opening Review closes existing size overlay and keeps scroll locked',!r.get('sg-overlay').classList.contains('open')&&!r.get('pd-review-overlay').hidden&&r.doc.body.style.overflow==='hidden');
  r.get('pd-review-close').click();r.get('sg-open').click();r.doc.fire('keydown',{key:'Escape'});
  check('size guide still opens/closes normally',!r.get('sg-overlay').classList.contains('open')&&r.doc.body.style.overflow==='');
  r=setup({...P,images:[]});await wait();r.review.click();await wait();
  check('product without image uses existing BREEZE placeholder, not a fake image',r.get('pd-review-img').hidden&&!r.get('pd-review-image-empty').hidden&&r.get('pd-review-img').getAttribute('src')===null);
  r=setup();await wait();r.review.click();await wait();r.get('pd-review-img').fire('error');
  check('failed modal image is hidden without retry loop',r.get('pd-review-img').hidden&&!r.get('pd-review-image-empty').hidden&&r.get('pd-review-img').getAttribute('src')===null);
  r=setup({...P,color_configured:true,colors:[{key:'black',label:'Đen',images:['black-shirt.png'],available:true}],
    variants:[{id:171,size:'M',color:'black',available:true}]});await wait();
  const color=El('button');color.setAttribute('data-color-key','black');color._closest={'.pd-color':color};
  r.get('pd-colors').fire('click',{target:color});r.review.click();await wait();
  eq('modal uses gallery image of the currently selected color',r.get('pd-review-img').src,'black-shirt.png');
  r=setup({...P,variants:[{id:171,size:'M',available:false}]});await wait();r.review.click();await wait();
  check('sold out product still permits an eligible past buyer',!r.get('pd-review-overlay').hidden);
  for(const [product,url]of[[404,'?id=17'],[P,'']]){r=setup(product,url);await wait();r.review.click();await wait();check('missing product cannot open a fake review modal',r.review.disabled&&r.get('pd-review-overlay').hidden);}
})().catch(e=>{console.error(e);process.exitCode=1;});
