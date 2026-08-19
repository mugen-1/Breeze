// Mini-DOM đủ dùng để chạy page-profile.js ngoài trình duyệt.
function El(tag, id) {
  const set = new Set(); const self = {
    tagName: (tag || 'div').toUpperCase(), id: id || '', value: '', textContent: '',
    innerHTML: '', hidden: false, disabled: false, checked: false, max: '', src: '',
    alt: '', type: '', className: '', style: {}, dataset: {}, files: null,
    children: [], _l: {}, _attrs: {},
    classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
      toggle: (c, on) => { (on === undefined ? !set.has(c) : on) ? set.add(c) : set.delete(c); } },
    setAttribute(k, v) { self._attrs[k] = String(v); },
    getAttribute(k) { return self._attrs[k] === undefined ? null : self._attrs[k]; },
    removeAttribute(k) { delete self._attrs[k]; },
    addEventListener(ev, fn) { (self._l[ev] = self._l[ev] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { self.children.push(c); c.parentNode = self; return c; },
    insertBefore(c) { self.children.push(c); return c; },
    removeChild(c) { self.children = self.children.filter(x => x !== c); },
    replaceChildren(...c) { self.children = c; },
    querySelector: () => null, querySelectorAll: () => [],
    closest: (s) => (self._closest && self._closest[s]) || null,
    focus() { self._focused = true; }, click() { (self._l.click || []).forEach(f => f({ target: self })); },
    contains: () => false,
    fire(ev, e) { (self._l[ev] || []).forEach(f => f.call(self, Object.assign({ target: self,
      preventDefault(){}, stopPropagation(){} }, e))); },
  };
  return self;
}
function makeDoc() {
  const byId = {}; const docL = {};
  const doc = {
    title: '', body: El('body'), documentElement: El('html'),
    getElementById: id => byId[id] || (byId[id] = El('div', id)),
    querySelector: s => (doc._qs && doc._qs[s]) || null,
    querySelectorAll: s => (doc._qsa && doc._qsa[s]) || [],
    createElement: t => El(t),
    addEventListener: (ev, fn) => { (docL[ev] = docL[ev] || []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent: (e) => { (docL[e.type] || []).forEach(f => f(e)); return true; },
    _byId: byId, _l: docL,
    fire(ev, e) { (docL[ev] || []).forEach(f => f(Object.assign({ type: ev,
      preventDefault(){}, stopPropagation(){} }, e))); },
    _qs: {}, _qsa: {},
  };
  return doc;
}
module.exports = { El, makeDoc };
