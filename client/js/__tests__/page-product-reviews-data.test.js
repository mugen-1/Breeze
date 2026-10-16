const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const fs=require('fs'),path=require('path'),vm=require('vm');
const image=n=>'/review-images/'+String(n).padStart(32,'0')+'.webp';
// API fixtures exist only in this test file, never in the product script or production DB.
const review={id:91,productId:17,displayName:'Tên <script>người mua</script>',rating:4,comment:'Đẹp <img onerror=bad>\nDòng hai',
  variant:{id:701,size:'M',color:'Đen lúc mua'},images:[{url:image(1)},{url:image(2)}],createdAt:'2026-10-15T10:16:00Z',updatedAt:'2026-10-15T10:16:00Z'};
const stats={averageRating:3.6,totalReviews:12,ratingCounts:{1:1,2:1,3:4,4:2,5:4},reviewsWithImages:4};
const payload=(patch={})=>({reviews:[review],summary:stats,page:1,limit:10,total:12,totalPages:2,...patch});
const empty=()=>payload({reviews:[],summary:{averageRating:null,totalReviews:0,ratingCounts:{1:0,2:0,3:0,4:0,5:0},reviewsWithImages:0},total:0,totalPages:0});
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
function deferred(){let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};}
function setup(options={}){
  const doc=makeDoc(),get=id=>doc.getElementById(id),calls=[],writes=[],authCalls=[],stars=[];
  doc._qs['.pd-add']=El('button');get('pd-review-overlay').hidden=true;
  Object.defineProperty(get('pd-review-variant'),'options',{get(){return this.children;}});
  for(let n=1;n<=5;n++){const b=El('button'),span=El('span');b.setAttribute('data-review-rating',n);b.querySelector=()=>span;b._closest={'[data-review-rating]':b};stars.push(b);}
  get('pd-review-stars').querySelectorAll=()=>stars;
  const filters=['all','5','4','3','2','1','images'].map(key=>{const b=El('button');b.setAttribute('data-review-filter',key);return b;});
  doc._qsa['#pd-reviews-filters [data-review-filter]']=filters;
  const i18n=load('i18n.js').win.__i18n;i18n.current='vi';
  const deps=['routes.js','utils-format.js','utils-i18n.js'];if(!options.late)deps.push('page-product.js');
  const r=load(options.late?'page-product.js':'page-product-reviews.js',{doc,deps,
    globals:{localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},sessionStorage:{setItem:(...args)=>writes.push(args)},
      fetch:async(url,settings={})=>{
        calls.push({url,settings});if(url.includes('/reviews?'))return options.reviews?options.reviews(new URL(url,'http://test'),settings):response(empty());
        return response(url.endsWith('/17')?{id:17,name_vi:'Áo từ API',name_en:'API shirt',price:100,images:[],category_slug:'sanpham-ao',size_configured:true,variants:[{id:171,size:'XL',available:true}]}:[]);
      }},window:{location:{search:'?id=17',href:'product.html?id=17'},__i18n:i18n,AuthHelper:{getUser:()=>({uid:'owner'}),isLoggedIn:()=>true,apiFetch:async(url,settings={})=>{
        authCalls.push({url,settings});if(url.endsWith('/reviews/me'))return response({review:null,purchasedVariants:[]});return settings.method==='POST'?options.post():response({canReview:true,hasReviewed:false,purchasedVariants:[{variant_id:701,size_snapshot:'M',color_snapshot:'Đen lúc mua'}]});
      }}}});
  return {...r,get,filters,calls,writes,authCalls,stars,i18n,loadList(){vm.runInContext(fs.readFileSync(path.join(__dirname,'../page-product-reviews.js'),'utf8'),r.sandbox);}};
}
const requests=r=>r.calls.filter(c=>c.url.includes('/reviews?'));
const cards=r=>r.get('pd-reviews-list').children;
const part=(card,name)=>card.children.find(c=>c.className===name);
(async()=>{
  let r=setup();await wait();
  eq('Product load fetches page one reviews without authentication',requests(r).map(c=>c.url),['/api/products/17/reviews?page=1&limit=10']);
  eq('empty SQL summary stays unscored',r.get('pd-reviews-score').textContent,'— / 5');
  eq('empty summary stars stay outlines',r.get('pd-reviews-stars').textContent,'☆☆☆☆☆');
  eq('empty summary says no reviews',r.get('pd-reviews-total').textContent,'Chưa có đánh giá');
  check('confirmed empty state is distinct from loading/error',!r.get('pd-reviews-empty').hidden&&r.get('pd-reviews-loading').hidden&&r.get('pd-reviews-error').hidden);
  eq('empty filter counts are all actual zero',r.filters.map(b=>b.textContent),['Tất cả (0)','5 sao (0)','4 sao (0)','3 sao (0)','2 sao (0)','1 sao (0)','Có hình ảnh (0)']);
  check('empty list has no card or pagination',cards(r).length===0&&r.get('pd-reviews-pagination').hidden);
  r=setup({reviews:()=>response(payload({reviews:[review,{...review,id:90,displayName:null,comment:null,images:[],variant:{id:702,size:null,color:null},createdAt:'2026-10-15T18:10:00Z'}]}))});await wait();
  eq('API review rows render cards',cards(r).length,2);
  eq('numeric summary comes from average, not hardcoded five',r.get('pd-reviews-score').textContent,'3.6 / 5');
  eq('visual summary reflects actual average',r.get('pd-reviews-stars').textContent,'★★★☆☆');
  eq('summary count uses global API count',r.get('pd-reviews-total').textContent,'12 đánh giá');
  eq('filter counts use global API summary',r.filters.map(b=>b.textContent),['Tất cả (12)','5 sao (4)','4 sao (2)','3 sao (4)','2 sao (1)','1 sao (1)','Có hình ảnh (4)']);
  const first=cards(r)[0],head=part(first,'pd-review-card-header');
  eq('reviewer display name is safe text',head.children[0].textContent,review.displayName);
  eq('card stars use its own rating',head.children[1].textContent,'★★★★☆');
  eq('timestamp uses explicit Vietnam date/time format',head.children[2].textContent,'15/10/2026 - 17:16');
  eq('timestamp retains machine-readable UTC value',head.children[2].dateTime,'2026-10-15T10:16:00.000Z');
  eq('UTC+7 date rollover is correct',part(cards(r)[1],'pd-review-card-header').children[2].textContent,'16/10/2026 - 01:10');
  eq('historical variant is used instead of current XL product size',part(first,'pd-review-card-variant').textContent,'Phân loại: Đen lúc mua / Size M');
  eq('comment is text without HTML interpolation',part(first,'pd-review-card-comment').textContent,review.comment);
  check('absent comment adds no fake comment',!part(cards(r)[1],'pd-review-card-comment'));
  eq('absent display name uses a neutral role label',part(cards(r)[1],'pd-review-card-header').children[0].textContent,'Người đánh giá');
  eq('missing snapshot is not replaced with current variant',part(cards(r)[1],'pd-review-card-variant').textContent,'Phân loại: —');
  const images=part(first,'pd-review-card-images').children;
  eq('API images render in order',images.map(a=>a.children[0].src),[image(1),image(2)]);
  check('image links are keyboard accessible with safe new-tab behavior',images.every(a=>a.target==='_blank'&&a.rel.includes('noopener')&&a.children[0].loading==='lazy'));
  images[0].children[0].fire('error');check('broken review image is hidden without an inline handler',images[0].hidden);
  check('no public card claims owner actions',cards(r).every(c=>!part(c,'pd-review-actions')));
  check('initial pagination has previous disabled and next enabled',!r.get('pd-reviews-pagination').hidden&&r.get('pd-reviews-prev').disabled&&!r.get('pd-reviews-next').disabled);
  eq('page indicator uses API metadata',r.get('pd-reviews-page').textContent,'1 / 2');
  r.get('pd-reviews-next').click();await wait();eq('Next requests page two',new URL(requests(r).at(-1).url,'http://test').searchParams.get('page'),'2');
  r.filters[1].click();await wait();let query=new URL(requests(r).at(-1).url,'http://test').searchParams;
  eq('rating filter resets page and requests exact rating',[query.get('page'),query.get('rating'),query.get('hasImages')],['1','5',null]);
  r.filters[6].click();await wait();query=new URL(requests(r).at(-1).url,'http://test').searchParams;
  eq('images filter requests only reviews with images',[query.get('page'),query.get('rating'),query.get('hasImages')],['1',null,'true']);
  r.i18n.current='en';r.doc.fire('langchange');
  eq('dynamic counts survive translation',r.filters[6].textContent,'With images (4)');
  eq('variant label translates without replacing purchase snapshot',part(cards(r)[0],'pd-review-card-variant').textContent,'Variant: Đen lúc mua / Size M');
  eq('language change preserves selected filter',r.filters[6].getAttribute('aria-pressed'),'true');
  eq('all interactions preserve page route',r.win.location.href,'product.html?id=17');eq('no local/session review state is written',r.writes.length,0);
  // Real page metadata drives Next/Previous independently of data fixtures on other tests.
  r=setup({reviews:url=>response(payload({page:Number(url.searchParams.get('page'))}))});await wait();
  r.get('pd-reviews-next').click();await wait();check('page two disables Next',r.get('pd-reviews-next').disabled&&!r.get('pd-reviews-prev').disabled);
  r.get('pd-reviews-prev').click();await wait();eq('Previous requests page one',new URL(requests(r).at(-1).url,'http://test').searchParams.get('page'),'1');
  r=setup({reviews:()=>response(payload({reviews:[],total:0,totalPages:0}))});await wait();
  eq('empty filtered result is described separately from no product reviews',r.get('pd-reviews-empty-description').textContent,'Không có đánh giá phù hợp bộ lọc.');
  let attempt=0;r=setup({reviews:()=>++attempt===1?response({message:'PRIVATE SQL'},500):response(empty())});await wait();
  check('API error is not a false empty state',!r.get('pd-reviews-error').hidden&&r.get('pd-reviews-empty').hidden&&r.get('pd-reviews-summary').hidden);
  r.get('pd-reviews-retry').click();await wait();check('Retry reloads and can reach confirmed empty state',requests(r).length===2&&r.get('pd-reviews-error').hidden&&!r.get('pd-reviews-empty').hidden);
  r=setup({reviews:()=>{throw Error('network');}});await wait();check('network rejection uses error state',!r.get('pd-reviews-error').hidden&&r.get('pd-reviews-empty').hidden);
  const old=deferred(),latest=deferred();let requestsMade=0;r=setup({reviews:()=>++requestsMade===1?old.promise:latest.promise});await wait();
  check('pending initial request shows loading only',!r.get('pd-reviews-loading').hidden&&r.get('pd-reviews-empty').hidden&&cards(r).length===0);
  r.filters[1].click();check('changing filter aborts previous request',requests(r)[0].settings.signal.aborted);
  latest.resolve(response(payload({reviews:[{...review,comment:'Newest filter result'}]})));await wait();
  old.resolve(response(payload({reviews:[{...review,comment:'STALE result'}]})));await wait();
  eq('late old response cannot overwrite current filter',part(cards(r)[0],'pd-review-card-comment').textContent,'Newest filter result');
  const busy=deferred();r=setup({reviews:()=>++attempt>3?busy.promise:response(payload())});attempt=2;await wait();r.filters[2].click();
  check('new-filter loading removes previous cards',cards(r).length===0&&!r.get('pd-reviews-loading').hidden);
  busy.resolve(response(empty()));await wait();
  r=setup({late:true});await wait();eq('before list script downloads only product endpoints ran',requests(r).length,0);r.loadList();await wait();
  eq('late script still loads reviews using current product getter',requests(r).length,1);
  const posted=deferred(),reloaded=deferred();let submitted=false;
  r=setup({post:async()=>{const value=await posted.promise;submitted=true;return value;},reviews:()=>submitted?reloaded.promise:response(empty())});await wait();
  r.get('pd-review-open').click();await wait();r.get('pd-review-stars').fire('click',{target:r.stars[3]});r.get('pd-review-variant').value='701';r.get('pd-review-variant').fire('change');r.get('pd-review-form').fire('submit');
  posted.resolve(response({id:91},201));await wait();
  check('real Submit success reloads list API without appending its payload',requests(r).length===2&&cards(r).length===0&&!r.get('pd-reviews-loading').hidden);
  reloaded.resolve(response(payload()));await wait();eq('public card appears only after API reload',cards(r).length,1);
})().catch(e=>{console.error(e);process.exitCode=1;});
