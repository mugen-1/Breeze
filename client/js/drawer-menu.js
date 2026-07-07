(function () {
    var drawer = document.getElementById('drawer-menu');
    var backdrop = document.getElementById('drawer-backdrop');
    var closeBtn = document.getElementById('drawer-close');
    if (!drawer || !backdrop) return;

    var triggers = document.querySelectorAll('[data-drawer-open]');
    var lastFocused = null;

    function setExpanded(state) {
        for (var i = 0; i < triggers.length; i++) {
            triggers[i].setAttribute('aria-expanded', state ? 'true' : 'false');
        }
    }

    function openDrawer() {
        lastFocused = document.activeElement;
        backdrop.hidden = false;
        // ép reflow để transition backdrop chạy khi bỏ [hidden]
        void backdrop.offsetWidth;
        drawer.classList.add('open');
        backdrop.classList.add('open');
        document.body.classList.add('drawer-open');
        drawer.setAttribute('aria-hidden', 'false');
        setExpanded(true);
        (closeBtn || drawer).focus();          // đưa focus vào panel
        document.addEventListener('keydown', onKeydown);
    }

    function closeDrawer() {
        drawer.classList.remove('open');
        backdrop.classList.remove('open');
        document.body.classList.remove('drawer-open');
        drawer.setAttribute('aria-hidden', 'true');
        setExpanded(false);
        document.removeEventListener('keydown', onKeydown);
        // gỡ backdrop khỏi cây a11y sau khi fade xong
        setTimeout(function () {
            if (!drawer.classList.contains('open')) backdrop.hidden = true;
        }, 350);
        // trả focus về nút trigger
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    function onKeydown(e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
            closeDrawer();
            return;
        }
        if (e.key === 'Tab') trapFocus(e);      // giữ focus trong panel
    }

    function trapFocus(e) {
        var focusable = drawer.querySelectorAll(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    for (var i = 0; i < triggers.length; i++) {
        triggers[i].addEventListener('click', function (e) {
            e.preventDefault();
            openDrawer();
        });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);

    // Accordion danh mục cha
    var accBtns = drawer.querySelectorAll('.drawer-acc-btn');
    for (var j = 0; j < accBtns.length; j++) {
        accBtns[j].addEventListener('click', function () {
            var item = this.parentNode;              // .drawer-acc-item
            var isOpen = item.classList.toggle('open');
            this.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });
    }
})();
