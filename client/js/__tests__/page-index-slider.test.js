/* page-index-slider.js — slider hero trang chủ, chạy ngay lúc parse. */
const { check, eq } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');

function setup(nSlides) {
  const doc = makeDoc();
  const slides = []; const dots = [];
  for (let i = 0; i < nSlides; i++) { slides.push(El('div')); dots.push(El('span')); }
  const hero = El('div'); const scrollEl = El('div');
  doc.getElementsByClassName = function (c) {
    return c === 'mySlides' ? slides : c === 'dot' ? dots : [];
  };
  doc._qs['.hero'] = hero;
  doc._qs['.hero-scroll'] = scrollEl;

  let timers = [];
  const r = load('page-index-slider.js', {
    doc: doc,
    globals: {
      setInterval: function (fn, ms) { timers.push({ fn: fn, ms: ms, id: timers.length + 1 }); return timers.length; },
      clearInterval: function (id) { timers = timers.filter(function (t) { return t.id !== id; }); },
    },
    window: { scrollY: 0 },
  });
  r.slides = slides; r.dots = dots; r.hero = hero; r.scrollEl = scrollEl;
  r.timers = function () { return timers; };
  return r;
}
const actives = (arr) => arr.map(n => n.classList.contains('is-active') ? 1 : 0).join('');
const dotOn = (arr) => arr.map(n => n.classList.contains('active') ? 1 : 0).join('');

console.log('page-index-slider.js');

const r = setup(3);
// Chạy ngay lúc parse, không chờ DOMContentLoaded
eq('luc parse -> slide dau active', actives(r.slides), '100');
eq('luc parse -> dot dau active', dotOn(r.dots), '100');
eq('luc parse -> dat dong ho tu chuyen', r.timers().length, 1);
eq('chu ky 5 giay', r.timers()[0].ms, 5000);

r.timers()[0].fn();
eq('sau 1 nhip -> sang slide 2', actives(r.slides), '010');
r.timers()[0].fn(); r.timers()[0].fn();
eq('qua slide cuoi -> quay vong ve dau', actives(r.slides), '100');

// onclick trên .dot trong HTML gọi currentSlide -> bắt buộc global
eq('window.currentSlide phai global cho onclick', typeof r.win.currentSlide, 'function');
r.win.currentSlide(2);
eq('currentSlide(2) -> nhay dung slide', actives(r.slides), '001');
eq('currentSlide -> dat lai dong ho (khong cong don)', r.timers().length, 1);

r.hero.fire('mouseenter');
eq('hover hero -> dung tu chuyen', r.timers().length, 0);
r.hero.fire('mouseleave');
eq('roi chuot -> chay lai', r.timers().length, 1);

r.sandbox.window.scrollY = 120;
r.win._l.scroll();
eq('cuon 120px -> scroll indicator mo nua', r.scrollEl.style.opacity, 0.5);
r.sandbox.window.scrollY = 999;
r.win._l.scroll();
eq('cuon that sau -> opacity ve 0, khong am', r.scrollEl.style.opacity, 0);

// render() là hàm nội bộ của slider, không phải render của orders/invoice/profile
eq('render nam kin trong IIFE, khong ro global', typeof r.sandbox.render, 'undefined');

// toggleFilter từng nằm ở page-index.js và đã bị xoá (commit 61d25b9)
const fs = require('fs'), path = require('path');
check('page-index.js (chua toggleFilter chet) da bi xoa han',
      !fs.existsSync(path.join(__dirname, '..', 'page-index.js')));
