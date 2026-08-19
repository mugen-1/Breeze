/* filter-ui.js — toggleFilter, gộp từ 6 bản y hệt ở các trang danh mục (TASK 4). */
const { check, eq, note } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');
const { El } = require('./helpers/dom');

const { sandbox } = load('filter-ui.js', {});
const toggleFilter = sandbox.toggleFilter;

console.log('filter-ui.js');

// HTML goi truc tiep qua onclick="toggleFilter(this)" -> bat buoc phai global.
eq('toggleFilter la global (HTML goi qua onclick)', typeof toggleFilter, 'function');

const heading = El('div');
const list = El('ul');
heading.nextElementSibling = list;

toggleFilter(heading);
check('lan 1 -> danh dau collapsed', heading.classList.contains('collapsed'));
eq('lan 1 -> an danh sach', list.style.display, 'none');

toggleFilter(heading);
check('lan 2 -> bo collapsed', !heading.classList.contains('collapsed'));
eq('lan 2 -> hien lai danh sach', list.style.display, '');

toggleFilter(heading);
eq('lan 3 -> an lai (lat qua lat lai on dinh)', list.style.display, 'none');

/* Guard `if (list)` lay lai tu ban tung nam o index.html. 6 ban dang chay tren cac
   trang danh muc deu THIEU guard nay nen se nem TypeError. Case duoi khoa hanh vi
   an toan moi. */
const trong = El('div');
trong.nextElementSibling = null;
let nemLoi = false;
try { toggleFilter(trong); } catch (e) { nemLoi = true; }
check('khong co phan tu ke tiep -> KHONG nem loi (guard if(list))', !nemLoi);
check('van doi class collapsed du khong co danh sach', trong.classList.contains('collapsed'));

note('Dat o file rieng thay vi nhet vao filter.js: filter.js boc kin trong IIFE va');
note('khong lo gi ra global — giu nguyen tinh dong goi do.');
