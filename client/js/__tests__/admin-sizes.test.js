/* Exercise real admin listeners, API payloads and rendering with the shared DOM harness. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
const doc = makeDoc();
const product = { id: 5, name_vi: 'Áo', slug: 'ao-nam', price: 100, stock: 10, category_id: 1,
  size_kind: 'apparel', size_configured: true, is_active: true };
const sizeData = { product, allowed_sizes: ['S','M','L','XL'], variants: [
  { id: 50, size: null, is_base: true, stock: 5, is_active: true },
  { id: 51, size: 'M', is_base: false, stock: 3, is_active: true },
  { id: 52, size: 'L', is_base: false, stock: 2, is_active: false },
] };
const colorData = { product, allowed_sizes:['S','M','L','XL'], variants:[
  { id:50, size:null, color:null, is_base:true, stock:5, is_active:true },
  { id:51, size:'M', color:null, is_base:false, stock:3, is_active:true },
  { id:61, size:'M', color:'den', is_base:false, stock:0, is_active:true, sku:'BR-P5-DEN-M' },
], colors:[{ id:7, color_key:'den', label:'Đen', swatch_hex:'#000000', is_active:true,
  variants:[{ id:61, size:'M', color:'den', stock:0, is_active:true, sku:'BR-P5-DEN-M' }], images:[] }] };
const calls = [];
const buttons = {};
for (const kind of ['edit','sizes','colors','inventory']) {
  const btn = El('button'); btn.setAttribute('data-' + kind, '5');
  buttons['[data-' + kind + ']'] = [btn];
}
doc.getElementById('prod-body').querySelectorAll = s => buttons[s] || [];
let auth;
const r = load('admin.js', { doc, deps: ['routes.js','utils-format.js'],
  globals: { setTimeout: () => 0, clearTimeout() {}, fetch: async () => ({ json: async () => [] }) },
  window: { __i18n: { current:'vi', t: k => 'T:' + k }, AuthHelper: {
    onChange(fn) { auth = fn; },
    apiFetch(url, options) {
      calls.push({ url, options, body: options && options.body ? JSON.parse(options.body) : null });
      let data = {};
      if (url === '/api/me') data = { role:'admin' };
      else if (url === '/api/categories') data = [];
      else if (url === '/api/admin/products') data = { products:[product] };
      else if (url.includes('inventory-movements')) data = { movements:[{ id:1, size:'M', movement_type:'VARIANT_OPENING', quantity_delta:0, stock_before:3, stock_after:3 }], total_pages:1 };
      else if (url.includes('/colors') || url.includes('/color-allocation')) data = colorData;
      else if (url.includes('/sizes') || url.includes('/size-allocation')) data = sizeData;
      return Promise.resolve({ ok:true, status:200, json:async () => data });
    }
  } }
});
const g = id => doc.getElementById(id);
(async function () {
  console.log('admin-sizes.js');
  doc.fire('DOMContentLoaded'); auth({ uid:'admin' }); await wait(50);
  buttons['[data-edit]'][0].fire('click');
  eq('size configured -> aggregate input read-only', g('f-stock').readOnly, true);
  eq('size configured -> direct adjustment reason hidden', g('stock-reason-field').hidden, true);
  eq('size configured -> management hint visible', g('size-stock-hint').hidden, false);
  g('f-stock').value = '999';
  g('f-price').value = '100'; g('f-sale').value = ''; g('f-category').value = '1';
  g('prod-form').fire('submit'); await wait();
  const edit = calls.find(c => c.url === '/api/admin/products/5' && c.options.method === 'PUT');
  check('product edit omits aggregate even if DOM value tampered', edit && !Object.hasOwn(edit.body,'stock'));
  buttons['[data-sizes]'][0].fire('click'); await wait();
  check('size management opens existing-style modal', g('sizes-modal').classList.contains('open'));
  check('admin sees inactive size stock', g('sizes-body').innerHTML.includes('data-size-stock="52" value="2"'));
  check('add select contains only missing whitelist sizes', /value="S"/.test(g('sizes-add').innerHTML) && /value="XL"/.test(g('sizes-add').innerHTML) && !/value="M"/.test(g('sizes-add').innerHTML));
  g('sizes-create-all').fire('click'); await wait();
  eq('create uses missing whitelist, no stock guessing', calls.find(c => c.url.endsWith('/sizes') && c.options).body, { sizes:['S','XL'] });
  const stock = El('input'); stock.value = '4';
  const active = El('input'); active.checked = true;
  g('sizes-body').querySelector = s => s.includes('data-size-stock') ? stock : active;
  g('sizes-reason').value = 'Nhập thêm';
  const save = El('button'); save.setAttribute('data-size-save','51'); save._closest = { '[data-size-save]':save };
  g('sizes-body').fire('click',{ target:save }); await wait();
  eq('admin size save includes SQL snapshot for stale check', calls.find(c => c.url.endsWith('/sizes/51')).body,
    { stock:4,expected_stock:3,is_active:true,reason:'Nhập thêm' });
  const allocation = El('input'); allocation.value='2'; allocation.setAttribute('data-size-allocation','51');
  g('sizes-body').querySelectorAll = () => [allocation];
  g('sizes-allocate').fire('click');
  check('allocation waits for confirmation', g('confirm-modal').classList.contains('open'));
  check('no allocation API before confirmation', !calls.some(c => c.url.endsWith('/size-allocation')));
  g('confirm-ok').fire('click'); await wait();
  eq('allocation sends variant and delta only', calls.find(c => c.url.endsWith('/size-allocation')).body,
    { allocations:[{variant_id:51,quantity:2}] });
  g('sizes-close').fire('click');
  check('close restores focus', buttons['[data-sizes]'][0]._focused);
  buttons['[data-inventory]'][0].fire('click'); await wait();
  check('inventory renders size metadata', g('inventory-body').innerHTML.includes('pd.thSize: M'));
  check('inventory uses opening i18n mapping', g('inventory-body').innerHTML.includes('adm.inv.VARIANT_OPENING'));
  buttons['[data-colors]'][0].fire('click'); await wait();
  check('color management opens existing modal style', g('colors-modal').classList.contains('open'));
  check('admin color row shows exact SKU and source stock', g('colors-body').innerHTML.includes('BR-P5-DEN-M') &&
    g('colors-body').innerHTML.includes('data-color-allocation="61"'));
  check('admin warns missing color images', g('colors-body').innerHTML.includes('adm.noColorImages'));
  g('colors-name').value='Trắng'; g('colors-hex').value='#FFFFFF';
  g('colors-create').fire('click'); await wait();
  eq('create color sends label and optional swatch', calls.find(c => c.url.endsWith('/colors') && c.options && c.options.method==='POST').body,
    { label:'Trắng', swatch_hex:'#FFFFFF' });
  const colorAllocation=El('input'); colorAllocation.value='2'; colorAllocation.setAttribute('data-color-allocation','61');
  g('colors-body').querySelectorAll=()=>[colorAllocation];
  g('colors-allocate').fire('click');
  check('color allocation waits for confirmation', g('confirm-modal').classList.contains('open'));
  g('confirm-ok').fire('click'); await wait();
  eq('color allocation carries exact source/target and SQL snapshots', calls.find(c => c.url.endsWith('/color-allocation')).body,
    { allocations:[{source_variant_id:51,target_variant_id:61,quantity:2,expected_source_stock:3,expected_target_stock:0}] });
  g('colors-close').fire('click');
  check('color modal returns focus', buttons['[data-colors]'][0]._focused);
})();
