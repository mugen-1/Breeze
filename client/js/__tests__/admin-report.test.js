const {check,eq}=require('./helpers/assert');
const {load,wait}=require('./helpers/sandbox');
const {makeDoc,El}=require('./helpers/dom');
const fixture=require('../../../server/__tests__/helpers/business-report');
const i18n=load('i18n.js').win.__i18n;
i18n.current='vi';
const doc=makeDoc(),calls=[],downloads=[],blobs=[],charts=[],timers=[];
const button=doc.getElementById('dash-export'),label=El('span');
button.querySelector=()=>label;
doc.getElementById('dash-preset').value='30';
doc.getElementById('revenue-chart').getContext=()=>({});
let login,mode='ok',pending;
const response=data=>({ok:true,json:async()=>data});
function report(url){const q=new URL(url,'http://test').searchParams;return {
  range:{from:q.get('from'),to:q.get('to')},summary:fixture.summary,topProducts:fixture.top,
  dailyRevenue:[{date:q.get('to'),revenue:1750,orders:7,completedOrders:3,cancelledOrders:1}]};}
const createElement=doc.createElement;
doc.createElement=tag=>{const el=createElement(tag);if(tag==='a')el.click=()=>downloads.push({name:el.download,href:el.href});return el;};
const r=load('admin.js',{doc,deps:['routes.js','utils-format.js','utils-i18n.js','order-shipping.js','order-payment.js','business-report-csv.js'],
  globals:{Blob:class{constructor(parts,options){blobs.push({content:parts.join(''),type:options.type});}},
    setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},
    getComputedStyle:()=>({getPropertyValue:()=>''}),
    Chart:class{constructor(ctx,options){this.data=options.data;charts.push(this);}update(){}destroy(){}},
    fetch:async()=>({json:async()=>[]})},
  window:{__i18n:i18n,AuthHelper:{onChange(fn){login=fn;},async apiFetch(url){
    calls.push(url);
    if(url==='/api/me')return response({role:'admin'});
    if(url==='/api/admin/stats/anchor')return response({anchor:'2026-10-07'});
    if(url.startsWith('/api/admin/stats/business-report?')){
      const data=report(url);
      if(mode==='pending')return new Promise(resolve=>{pending=()=>resolve(response(data));});
      if(mode==='http')return {ok:false,status:500};
      if(mode==='network')throw Error('offline');
      if(mode==='invalid')return response({...data,summary:{}});
      if(mode==='mismatch')return response({...data,range:{from:'2026-01-01',to:'2026-01-07'}});
      if(mode==='empty')return response({...data,summary:Object.fromEntries(Object.keys(fixture.summary).map(k=>[k,0])),dailyRevenue:[],topProducts:[]});
      return response(data);
    }
    if(url.startsWith('/api/admin/stats?'))return response({current:fixture.summary,previous:{},dailyRevenue:report(url).dailyRevenue});
    if(url==='/api/categories'||url.startsWith('/api/admin/stats/top-products')||url.startsWith('/api/admin/stats/order-status'))return response([]);
    return response({orders:[],products:[],users:[],items:[],total:0,total_pages:1});
  }}}});
const reportCalls=()=>calls.filter(u=>u.startsWith('/api/admin/stats/business-report?'));
(async()=>{
  doc.fire('DOMContentLoaded');button.fire('click');eq('export before authentication sends no report request',reportCalls().length,0);
  login({uid:'admin'});await wait(40);
  eq('existing four Dashboard KPI still render', ['revenue','orders','customers','aov'].map(k=>doc.getElementById('kpi-'+k+'-val').textContent),['1.750₫','7','2','583₫']);
  eq('revenue chart still uses Dashboard daily revenue',charts[0].data.datasets[0].data,[1750]);
  for(const [preset,from]of[['7','2026-10-01'],['30','2026-09-08'],['month','2026-10-01'],['year','2026-01-01']]){
    doc.getElementById('dash-preset').value=preset;doc.getElementById('dash-preset').fire('change');await wait();
    mode='ok';button.fire('click');await wait();
    eq('export '+preset+' uses selected dates',reportCalls().at(-1),'/api/admin/stats/business-report?from='+from+'&to=2026-10-07');
    eq('filename '+preset+' uses exact range',downloads.at(-1).name,'breeze-business-report-'+from+'-to-2026-10-07.csv');
    check('CSV '+preset+' uses same KPI and daily values',blobs.at(-1).content.includes('Tổng doanh thu (VND),1750')&&blobs.at(-1).content.includes('2026-10-07,1750,7,3,1'));
  }
  check('download links removed from page',!doc.body.children.some(el=>el.tagName==='A'));
  check('Blob URLs are released after browser download starts',timers.filter(t=>t.ms===1000).length===4);
  timers.filter(t=>t.ms===1000).forEach(t=>t.fn());eq('all downloaded Blob URLs released',r.log.filter(x=>x[0]==='revokeObjectURL').length,4);
  mode='pending';const before=reportCalls().length;button.fire('click');button.fire('click');
  check('export loading disables button and shows translated label',button.disabled&&button.getAttribute('aria-busy')==='true'&&label.textContent===i18n.t('report.exporting'));
  eq('double click sends one report request',reportCalls().length,before+1);pending();await wait();
  check('success restores button and label',!button.disabled&&button.getAttribute('aria-busy')===null&&label.textContent===i18n.t('adm.exportCsv'));
  for(const error of ['http','network','invalid','mismatch']){
    mode=error;const count=downloads.length;button.fire('click');await wait();
    eq(error+' failure cannot download false report',downloads.length,count);
    check(error+' failure displays error and restores control',doc.getElementById('toast').textContent===i18n.t('report.error')&&!button.disabled&&button.getAttribute('aria-busy')===null);
  }
  mode='empty';button.fire('click');await wait();check('empty period downloads valid zero report',blobs.at(-1).content.includes('Tổng doanh thu (VND),0')&&blobs.at(-1).content.includes('TOP 10 SẢN PHẨM BÁN CHẠY'));
  mode='pending';const count=downloads.length;button.fire('click');
  doc.getElementById('dash-preset').value='7';doc.getElementById('dash-preset').fire('change');await wait();pending();await wait();
  check('changing range discards pending old report and explains retry',downloads.length===count&&doc.getElementById('toast').textContent===i18n.t('report.rangeChanged'));
  mode='pending';button.fire('click');login(null);pending();await wait();
  check('logout prevents pending report download',downloads.length===count&&!doc.body.classList.contains('adm-authed'));
})().catch(e=>{console.error(e);process.exitCode=1;});
