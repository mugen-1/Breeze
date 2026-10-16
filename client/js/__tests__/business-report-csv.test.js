const {check,eq}=require('./helpers/assert');
const {load}=require('./helpers/sandbox');
const r=load('business-report-csv.js',{deps:['i18n.js']});
r.win.__i18n.current='vi';
const fixture=require('../../../server/__tests__/helpers/business-report');
const data={range:{from:'2026-10-01',to:'2026-10-07'},summary:fixture.summary,topProducts:fixture.top,
  dailyRevenue:[{date:'2026-10-01',revenue:880,orders:2,completedOrders:1,cancelledOrders:0},{date:'2026-10-07',revenue:220,orders:1,completedOrders:1,cancelledOrders:0}]};
function parse(content){
  const rows=[];let row=[],cell='',quoted=false;content=content.replace(/^\uFEFF/,'');
  for(let i=0;i<content.length;i++){
    const c=content[i];if(c==='"'){if(quoted&&content[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if(c==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';}
    else if(c!=='\r'||quoted)cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
const csv=r.win.BreezeBusinessCsv.create(data,r.win.__i18n.t),rows=parse(csv.content);
eq('filename captures exact selected dates',csv.filename,'breeze-business-report-2026-10-01-to-2026-10-07.csv');
eq('UTF-8 BOM byte sequence',Buffer.from(csv.content,'utf8').subarray(0,3).toString('hex'),'efbbbf');
check('Vietnamese headings survive UTF-8 encoding',Buffer.from(csv.content,'utf8').toString('utf8').includes('Số khách hàng mua hàng')&&csv.content.includes('Tổng sản phẩm đã bán'));
check('summary, dates, daily and Top 10 sections exist',rows.some(x=>x[0]==='CHỈ SỐ')&&rows.some(x=>x[0]==='DOANH THU THEO NGÀY')&&rows.some(x=>x[0]==='TOP 10 SẢN PHẨM BÁN CHẠY'));
for(const [label,value]of [['Tổng doanh thu (VND)','1750'],['Tổng số đơn','7'],['Đơn hoàn thành','3'],['Đơn bị hủy','1'],['Số khách hàng mua hàng','2'],['Giá trị đơn trung bình (VND)','583'],['Tổng sản phẩm đã bán','6']])eq('KPI '+label,rows.find(x=>x[0]===label)?.[1],value);
eq('comma, quotes and multiline product name remain one CSV cell',rows.find(x=>x[0]===fixture.top[1].name),[fixture.top[1].name,'3','571']);
eq('daily section retains revenue and total/completed/cancelled order counts',rows.find(x=>x[0]==='2026-10-01'),['2026-10-01','880','2','1','0']);
check('CSV never exports IDs or personal/payment metadata',!csv.content.includes('firebase_uid')&&!csv.content.includes('transaction_code')&&!rows.some(x=>x[0]==='id'));
check('revenue definitions explain shipping and completed orders',csv.content.includes('chỉ tính đơn hoàn thành')&&csv.content.includes('chưa gồm phí vận chuyển'));
const empty=r.win.BreezeBusinessCsv.create({...data,summary:Object.fromEntries(Object.keys(fixture.summary).map(k=>[k,0])),topProducts:[],dailyRevenue:[]},r.win.__i18n.t);
check('empty period has a real report with zero KPI and product headers',empty.content.includes('Giá trị đơn trung bình (VND),0')&&empty.content.includes('TOP 10 SẢN PHẨM BÁN CHẠY'));
r.win.__i18n.current='en';
const english=r.win.BreezeBusinessCsv.create(data,r.win.__i18n.t);
check('English report translates all headings',english.content.includes('BREEZE BUSINESS REPORT')&&!english.content.includes('report.')&&!english.content.includes('adm.'));
r.win.__i18n.current='vi';
for(const name of ['=HYPERLINK("http://example.test")','+1+1','-1+1','@SUM(1,2)',' \t=1+1']){
  const result=r.win.BreezeBusinessCsv.create({...data,topProducts:[{...fixture.top[0],name}]},r.win.__i18n.t);
  eq('spreadsheet formula neutralized '+name,parse(result.content).at(-1)[0],"'"+name);
}
for(const value of [null,{}, {...data,summary:{...data.summary,aov:NaN}}, {...data,summary:{...data.summary,revenue:Infinity}},
  {...data,summary:{...data.summary,orders:-1}}, {...data,range:{from:'2026-02-30',to:'2026-10-07'}}, {...data,topProducts:null}]){
  let rejected=false;try{r.win.BreezeBusinessCsv.create(value,r.win.__i18n.t);}catch(_){rejected=true;}check('invalid report data cannot generate a false successful CSV',rejected);
}
