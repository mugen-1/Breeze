const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { makeDoc, El } = require('./helpers/dom');
const fs = require('fs');
const path = require('path');

console.log('customer-support.js — UI Task 1');
const i18n = load('i18n.js').win.__i18n;
const reply = (uid, role, extra = {}) => ({ ok: true, json: async () => ({ firebase_uid: uid, role, ...extra }) });
const all = node => [node, ...node.children.flatMap(all)];
const byClass = (r, name) => all(r.doc.body).find(el => el.className.split(' ').includes(name));

function setup(options = {}) {
    const doc = makeDoc(), calls = [], storage = [];
    doc.readyState = 'complete';
    doc.getElementById = id => all(doc.body).find(el => el.id === id) || null;
    const create = doc.createElement;
    doc.createElement = tag => {
        const el = create(tag);
        el.contains = child => all(el).includes(child);
        el.focus = () => { doc.activeElement = el; };
        return el;
    };
    let callback, observer, current = null;
    const state = { result: reply('customer-a', 'customer'), overlays: [], filterOpen: false };
    doc.querySelector = selector => selector === '#fd-drawer.open' && state.filterOpen ? El('aside') : null;
    doc.querySelectorAll = () => state.overlays;
    i18n.current = 'vi';
    const r = load('customer-support.js', { doc, globals: {
        fetch() { throw Error('No chat request is allowed in Task 1'); },
        localStorage: { setItem: (...args) => storage.push(args), getItem() { throw Error('No saved chat'); } },
        sessionStorage: { setItem: (...args) => storage.push(args) }
    }, window: {
        __i18n: i18n,
        getComputedStyle: el => ({ display: el._display || 'block', visibility: el._visibility || 'visible' }),
        BreezeRoutes: { is: key => key === (options.page || 'index') },
        MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
        AuthHelper: options.noAuth ? undefined : {
            onChange(fn) { callback = fn; },
            getUser: () => current,
            apiFetch(url, opts) { calls.push({ url, opts }); return Promise.resolve(state.result); }
        }
    }});
    return { ...r, state, calls, storage, get: doc.getElementById,
        login(user) { current = user; callback(user); },
        changed() { observer([{ target: doc.body }]); },
        fireWindow(event) { r.win._l[event](); }
    };
}

(async () => {
    const r = setup();
    check('hidden until authentication has settled', r.get('breeze-support').hidden);
    eq('no role request before a known user', r.calls.length, 0);
    r.login(null);
    check('guest can open widget without Firebase login or role request', !r.get('breeze-support').hidden && !r.calls.length);
    const launcher = byClass(r, 'breeze-support-launcher'), close = byClass(r, 'breeze-support-close');
    const panel = r.get('breeze-support-panel'), guest = byClass(r, 'breeze-support-guest');
    const form = byClass(r, 'breeze-support-form'), send = byClass(r, 'breeze-support-send');
    const greeting = byClass(r, 'breeze-support-greeting');
    check('initially closed with contact button visible', panel.hidden && !launcher.hidden);
    launcher.click();
    check('open hides contact button and focuses expanded nonmodal dialog', !panel.hidden && launcher.hidden && r.doc.activeElement === close &&
        launcher.getAttribute('aria-expanded') === 'true' && panel.getAttribute('aria-modal') === 'false');
    eq('greeting is exact, including double space', greeting.textContent, 'xin chào quý kháchh, chúng tôi có thể giúp gì cho  bạn.');
    check('guest name and email are labelled and required', !guest.hidden && r.get('breeze-support-name').required &&
        r.get('breeze-support-email').type === 'email' && r.get('breeze-support-email').required);
    r.get('breeze-support-name').value = 'Guest test';
    r.get('breeze-support-email').value = 'guest@example.invalid';
    r.get('breeze-support-message').value = 'Unsent draft';
    close.click();
    check('close restores contact button visibility and focus', panel.hidden && !launcher.hidden && r.doc.activeElement === launcher);
    launcher.click();
    eq('reopening keeps only the in-memory draft', r.get('breeze-support-message').value, 'Unsent draft');
    let stopped = false;
    r.get('breeze-support').fire('keydown', { key: 'Escape', stopPropagation() { stopped = true; } });
    check('Escape closes, restores contact button and stops competing Escape handlers', panel.hidden && !launcher.hidden && stopped && r.doc.activeElement === launcher);
    let prevented = false;
    form.fire('submit', { preventDefault() { prevented = true; } });
    check('sending remains disabled and keyboard submit has no side effects', send.disabled && prevented && !r.calls.length);
    eq('no persisted names, email or messages', r.storage, []);
    eq('only the requested greeting appears as a chat message',
        all(byClass(r, 'breeze-support-messages')).filter(el => el.className === 'breeze-support-chat-message').length, 1);
    check('composer is outside the scrollable conversation', form.parentNode === panel &&
        byClass(r, 'breeze-support-composer').parentNode === byClass(r, 'breeze-support-foot'));
    eq('message input is a compact single-row chat composer', r.get('breeze-support-message').rows, 1);
    check('guest details scroll with conversation and still belong to composer form',
        guest.parentNode === byClass(r, 'breeze-support-messages') &&
        r.get('breeze-support-name').getAttribute('form') === form.id && r.get('breeze-support-email').getAttribute('form') === form.id);
    check('icon-only send has an accessible name and unavailability explanation',
        !!send.getAttribute('aria-label') && send.getAttribute('aria-describedby') === 'breeze-support-unavailable');

    i18n.current = 'en'; r.doc.fire('langchange');
    eq('dynamic labels follow language switch', launcher.children[1].textContent, 'Contact');
    eq('close aria label follows language switch', close.getAttribute('aria-label'), 'Close chat');
    eq('language switch preserves exact Vietnamese greeting', greeting.textContent, 'xin chào quý kháchh, chúng tôi có thể giúp gì cho  bạn.');
    eq('language switch preserves unsent content', r.get('breeze-support-message').value, 'Unsent draft');

    r.login({ uid: 'customer-a', displayName: 'Customer' });
    check('hidden during customer role check', r.get('breeze-support').hidden);
    eq('identity change clears guest personal fields and draft',
        [r.get('breeze-support-name').value, r.get('breeze-support-email').value, r.get('breeze-support-message').value], ['', '', '']);
    await wait();
    check('verified customer sees chat without guest form or account caption', !r.get('breeze-support').hidden && guest.hidden && guest.disabled &&
        !byClass(r, 'breeze-support-account'));
    eq('only existing role API is read', r.calls.map(c => c.url), ['/api/me']);
    check('role API is not a chat mutation', !r.calls[0].opts);

    r.state.result = reply('admin-a', 'admin');
    r.login({ uid: 'admin-a' }); await wait();
    check('Admin never sees customer widget', r.get('breeze-support').hidden && panel.hidden);
    const count = r.calls.length; r.fireWindow('focus'); await wait();
    eq('known Admin does not repeatedly check role on focus', r.calls.length, count);
    r.login(null);
    check('signout restores guest layout with no previous account label', !r.get('breeze-support').hidden && !guest.hidden &&
        !byClass(r, 'breeze-support-account'));

    const error = setup(); error.state.result = { ok: false };
    error.login({ uid: 'customer-a' }); await wait();
    check('failed role request stays hidden', error.get('breeze-support').hidden);
    error.state.result = reply('customer-a', 'customer'); error.fireWindow('online'); await wait();
    check('online retries failed role check', !error.get('breeze-support').hidden);
    const mismatch = setup(); mismatch.state.result = reply('other-user', 'customer');
    mismatch.login({ uid: 'customer-a' }); await wait();
    check('role response for another uid stays hidden', mismatch.get('breeze-support').hidden);
    mismatch.state.result = Promise.reject(Error('offline'));
    mismatch.fireWindow('focus'); await wait();
    check('network failure is handled without enabling widget', mismatch.get('breeze-support').hidden);

    const stale = setup(); let release;
    stale.state.result = new Promise(resolve => { release = resolve; });
    stale.login({ uid: 'customer-a' }); await wait();
    stale.state.result = reply('admin-a', 'admin'); stale.login({ uid: 'admin-a' }); await wait();
    release(reply('customer-a', 'customer')); await wait();
    check('late customer response cannot expose widget to Admin', stale.get('breeze-support').hidden);
    const departed = setup(); let releaseDeparted;
    departed.state.result = new Promise(resolve => { releaseDeparted = resolve; });
    departed.login({ uid: 'customer-a' }); await wait(); departed.login(null);
    releaseDeparted(reply('customer-a', 'customer')); await wait();
    check('response after logout cannot restore customer identity', !departed.get('breeze-support').hidden &&
        !byClass(departed, 'breeze-support-guest').hidden && !byClass(departed, 'breeze-support-account'));

    const overlay = setup(); overlay.login(null);
    const ol = byClass(overlay, 'breeze-support-launcher'); ol.click();
    overlay.doc.body.classList.add('cart-drawer-open'); overlay.changed();
    check('mini-cart hides and closes chat without taking focus', overlay.get('breeze-support').hidden && overlay.get('breeze-support-panel').hidden);
    overlay.doc.body.classList.remove('cart-drawer-open'); overlay.changed();
    check('after mini-cart closes, only launcher returns', !overlay.get('breeze-support').hidden && overlay.get('breeze-support-panel').hidden);
    const modal = El('div'); modal.getClientRects = () => [{}];
    overlay.state.overlays = [modal]; overlay.changed();
    check('visible modal hides launcher', overlay.get('breeze-support').hidden);
    modal.getClientRects = () => []; overlay.changed();
    check('closed modal markup does not hide launcher', !overlay.get('breeze-support').hidden);
    // Drawer đóng bằng transform vẫn có client rect trong browser thật.
    const closedDrawer = El('aside');
    closedDrawer.setAttribute('aria-modal', 'true');
    closedDrawer.setAttribute('aria-hidden', 'true');
    closedDrawer.getClientRects = () => [{}];
    overlay.state.overlays = [closedDrawer]; overlay.changed();
    check('offscreen closed drawer with a layout box does not hide launcher', !overlay.get('breeze-support').hidden);
    ol.click();
    check('chat opens while closed navigation and mini-cart remain in DOM', !overlay.get('breeze-support-panel').hidden);
    closedDrawer.setAttribute('aria-hidden', 'false'); overlay.changed();
    check('opening the same drawer hides and closes chat', overlay.get('breeze-support').hidden && overlay.get('breeze-support-panel').hidden);
    closedDrawer.setAttribute('aria-hidden', 'true'); overlay.changed();
    check('closing the drawer restores launcher', !overlay.get('breeze-support').hidden);
    modal.getClientRects = () => [{}]; modal._visibility = 'hidden';
    overlay.state.overlays = [modal]; overlay.changed();
    check('CSS visibility-hidden modal with a layout box does not hide launcher', !overlay.get('breeze-support').hidden);
    modal._visibility = 'visible'; modal.hidden = true; overlay.changed();
    check('hidden modal does not hide launcher even with a layout box', !overlay.get('breeze-support').hidden);
    overlay.state.overlays = [];
    overlay.state.filterOpen = true; overlay.changed();
    check('filter drawer takes priority', overlay.get('breeze-support').hidden);
    overlay.state.filterOpen = false; overlay.changed();
    overlay.doc.body.classList.add('drawer-open'); overlay.changed();
    check('navigation drawer takes priority', overlay.get('breeze-support').hidden);

    check('missing auth infrastructure keeps widget hidden', setup({ noAuth: true }).get('breeze-support').hidden);
    check('Admin page is never initialized', !setup({ page: 'admin' }).get('breeze-support'));
    const invoice = setup({ page: 'invoice' }); invoice.login(null);
    check('invoice integration supports guest UI without changing invoice data access', !invoice.get('breeze-support').hidden);
    invoice.state.result = reply('admin-a', 'admin'); invoice.login({ uid: 'admin-a' }); await wait();
    check('Admin widget remains hidden on invoice too', invoice.get('breeze-support').hidden);

    const read = file => fs.readFileSync(path.join(__dirname, '../../..', file), 'utf8');
    const head = read('server/views/partials/head.ejs'), scripts = read('server/views/partials/scripts.ejs');
    eq('both standard and fragment EJS heads include CSS', (head.match(/href="css\/customer-support.css"/g) || []).length, 2);
    check('shared UI JS follows auth and precedes page JS', scripts.indexOf('js/customer-support.js') > scripts.indexOf('js/auth-helper.js') &&
        scripts.indexOf('js/customer-support.js') < scripts.indexOf('pageJs.forEach'));
    ['checkout', 'invoice'].forEach(page => {
        const html = read('client/' + page + '.html');
        eq(page + ' loads CSS exactly once', (html.match(/href="css\/customer-support.css"/g) || []).length, 1);
        eq(page + ' loads JS exactly once', (html.match(/src="js\/customer-support.js"/g) || []).length, 1);
        check(page + ' loads UI after auth helper', html.indexOf('js/customer-support.js') > html.indexOf('js/auth-helper.js'));
    });
    check('invoice stays independent of global.css', !/href="css\/global.css"/.test(read('client/invoice.html')));
    const css = read('client/css/customer-support.css');
    check('widget is excluded from print', /@media print\s*\{\s*\.breeze-support\s*\{\s*display:\s*none\s*!important/.test(css));
    check('CSS supports small screens and preserves exact greeting spaces', css.includes('100dvh') && css.includes('safe-area-inset-bottom') && css.includes('white-space: pre-wrap'));
    check('both language dictionaries cover every widget label', Object.keys(i18n.UI.vi).filter(k => k.startsWith('support.')).every(k => !!i18n.UI.en[k]));
    const source = read('client/js/customer-support.js');
    check('UI has no inline handlers, HTML injection, chat transport or persistence',
        !/innerHTML|EventSource|localStorage|sessionStorage|WebSocket|\.send\(/.test(source));
})();
