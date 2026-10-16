const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const fs=require('fs'),path=require('path');
const view=fs.readFileSync(path.join(__dirname,'../../../server/views/pages/product.ejs'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../../../server/views/partials/product-style.ejs'),'utf8');
const section=view.match(/<section class="pd-wrap pd-reviews"[\s\S]*?<\/section>/)[0];
const summary=section.match(/id="pd-reviews-summary"[\s\S]*?<\/div>/)[0];
const buttons=Array.from(section.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g),m=>({
  attrs:Object.fromEntries(Array.from(m[1].matchAll(/([\w-]+)="([^"]*)"/g),a=>[a[1],a[2]])),text:m[2]})).filter(b=>b.attrs['data-review-filter']);
(async()=>{
  check('semantic review section links to its heading',/<section[^>]*id="pd-reviews"[^>]*aria-labelledby="pd-reviews-heading"/.test(section));
  check('section is immediately before recommendations',/<\/section>\s*<!-- ===== CÓ THỂ BẠN THÍCH ===== -->/.test(view)&&view.indexOf('id="pd-reviews"')>view.indexOf('id="pd-detail"')&&view.indexOf('id="pd-reviews"')<view.indexOf('id="pd-related-list"'));
  check('heading is Product Reviews with a VI/EN section title',/<h2 id="pd-reviews-heading" data-i18n="pd.reviewSectionTitle">Đánh giá sản phẩm<\/h2>/.test(section));
  check('summary average is empty with only a maximum of five',/>— \/ 5<\/p>/.test(summary)&&!/[0-9]\.[0-9]|★/.test(summary));
  check('summary declares no reviews instead of a fabricated count',/data-i18n="pd.reviewNoReviews">Chưa có đánh giá/.test(summary)&&!/>\s*\d+\s*(?:đánh giá|reviews)/i.test(summary));
  eq('all seven expected filters are present in order',buttons.map(b=>b.attrs['data-review-filter']),['all','5','4','3','2','1','images']);
  eq('filter labels have no fabricated counts',buttons.map(b=>b.text),['Tất cả','5 sao','4 sao','3 sao','2 sao','1 sao','Có hình ảnh']);
  check('filters are native focusable buttons controlling the list',buttons.every(b=>b.attrs.type==='button'&&b.attrs['aria-controls']==='pd-reviews-list'&&!('disabled'in b.attrs)));
  eq('All is the only default pressed filter',buttons.filter(b=>b.attrs['aria-pressed']==='true').map(b=>b.attrs['data-review-filter']),['all']);
  check('empty state starts hidden until API confirms it',/id="pd-reviews-empty" role="status" hidden/.test(section)&&section.includes('Chưa có đánh giá nào cho sản phẩm này.')&&!/Hãy|Bạn có thể|đánh giá ngay/i.test(section));
  check('list container starts truly empty',/id="pd-reviews-list"><\/div>/.test(section));
  check('production section has no reviewer, comments, images, timestamps or seeded cards',!/<(?:article|img|time|blockquote|textarea)\b|data-user|data-rating|review-card|username|4\.9|128/.test(section));
  check('filters wrap at narrow widths without a fixed-width section',/\.pd-reviews-filters\s*\{[^}]*flex-wrap: wrap/.test(css)&&/<section class="pd-wrap pd-reviews"/.test(section));
  check('filter controls have focus-visible and touch targets',/\.pd-reviews-filter:focus-visible/.test(css)&&/\.pd-reviews-filter\s*\{[^}]*min-height: 44px/.test(css));
  const doc=makeDoc(),calls=[],writes=[],i18n=load('i18n.js').win.__i18n;i18n.current='vi';
  const controls=buttons.map(({attrs,text})=>{const b=El('button');b.textContent=text;
    for(const [k,v]of Object.entries(attrs))b.setAttribute(k,v);
    attrs.class.split(' ').forEach(c=>b.classList.add(c));return b;});
  doc._qsa['#pd-reviews-filters [data-review-filter]']=controls;doc._qs['.pd-add']=El('button');
  const product={id:17,name_vi:'Sản phẩm từ API',name_en:'API product',price:100000,images:[],category_slug:'sanpham-ao',size_configured:true,variants:[{id:171,size:'M',available:true}]};
  const r=load('page-product-reviews.js',{doc,deps:['routes.js','utils-format.js','utils-i18n.js','page-product.js'],
    globals:{localStorage:{getItem:()=>null,setItem:(k,v)=>writes.push([k,v])},fetch:async url=>{calls.push(url);return {ok:true,status:200,json:async()=>url.includes('/reviews?')?{reviews:[],summary:{averageRating:null,totalReviews:0,ratingCounts:{1:0,2:0,3:0,4:0,5:0},reviewsWithImages:0},page:1,limit:10,total:0,totalPages:0}:url.endsWith('/17')?product:[]};}},
    window:{location:{search:'?id=17',href:'product.html?id=17'},__i18n:i18n}});
  await wait();const initialCalls=calls.length,initialListeners=controls.map(b=>b._l.click.length);
  for(const [index,button]of controls.entries()){
    button.click();
    eq('click '+buttons[index].text+' selects exactly one filter',controls.map(b=>b.getAttribute('aria-pressed')),controls.map((_,i)=>i===index?'true':'false'));
    eq('active styling follows '+buttons[index].text,controls.filter(b=>b.classList.contains('is-active')).length,1);
    eq('filter '+buttons[index].text+' keeps the real review list empty',doc.getElementById('pd-reviews-list').innerHTML,'');
  }
  controls[0].focus();controls[0].click();check('native button activation supports focus without navigation',controls[0]._focused&&controls[0].getAttribute('aria-pressed')==='true'&&r.win.location.href==='product.html?id=17');
  for(let i=0;i<20;i++)controls[i%7].click();eq('repeated filter use adds no duplicate listeners',controls.map(b=>b._l.click.length),initialListeners);
  controls[3].click();i18n.current='en';doc.fire('langchange');eq('language change preserves selected filter',controls[3].getAttribute('aria-pressed'),'true');
  eq('English labels are complete',buttons.map(b=>i18n.t(b.attrs['data-i18n'])),['All','5 stars','4 stars','3 stars','2 stars','1 star','With images']);
  eq('English section heading describes reviews',i18n.t('pd.reviewSectionTitle'),'Product reviews');
  eq('English empty state is neutral',i18n.t('pd.reviewEmptyDescription'),'There are no reviews for this product yet.');
  i18n.current='vi';eq('Vietnamese labels match production buttons',buttons.map(b=>i18n.t(b.attrs['data-i18n'])),buttons.map(b=>b.text));
  eq('Vietnamese heading matches production',i18n.t('pd.reviewSectionTitle'),'Đánh giá sản phẩm');
  eq('all filter interactions load the public review API',calls.length,initialCalls+29);eq('filters persist no fake review state',writes.length,0);
  check('filters never create a public review DOM record',doc.getElementById('pd-reviews-list').innerHTML===''&&doc.getElementById('pd-reviews-list').children.length===0);
})().catch(e=>{console.error(e);process.exitCode=1;});
