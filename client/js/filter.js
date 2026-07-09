(function () {

    // ===== GIÁ =====
    function parsePrice(text) {
        return parseInt(text.replace(/[^\d]/g, ''), 10) || 0;
    }

    function getProductPrice(li) {
        const sale = li.querySelector('.price-sale');
        if (sale) return parsePrice(sale.textContent);
        const price = li.querySelector('.product-price');
        if (price) return parsePrice(price.textContent);
        return 0;
    }

    // ===== I18N HELPER =====
    function fd() {
        return (window.__i18n && window.__i18n.T[window.__i18n.current] && window.__i18n.T[window.__i18n.current].fd) || {};
    }

    // Trang động (category) đọc body[data-category] và để products-render.js lo lọc/sort
    // server-side. Trang này thì filter.js CHỈ dựng UI, không lọc client (tránh 2 lớp đè).
    function isDynamic() {
        return document.body.hasAttribute('data-category');
    }

    // Radio giá đang chọn có mốc thật (khác "Tất cả" — radio "Tất cả" không có data-min).
    function selectedRange() {
        const sel = document.querySelector('#fd-drawer .price-filter-cb:checked');
        if (!sel || sel.dataset.min === undefined || sel.dataset.min === '') return null;
        return { el: sel, min: parseInt(sel.dataset.min, 10), max: parseInt(sel.dataset.max, 10) };
    }

    // ===== LỌC SẢN PHẨM (chỉ trang TĨNH; radio -> 1 khoảng giá) =====
    function applyFilters() {
        if (isDynamic()) return;   // dynamic: products-render.js lọc server-side

        const productList = document.querySelector('ul.products');
        if (!productList) return;

        const products = Array.from(productList.querySelectorAll(':scope > li'));
        let emptyMsg = productList.parentElement.querySelector('.no-product-msg');
        if (!emptyMsg) {
            emptyMsg = document.createElement('p');
            emptyMsg.className = 'no-product-msg';
            emptyMsg.style.cssText = 'color:#888;text-align:center;padding:48px 0;width:100%;display:none;font-size:15px;';
            emptyMsg.textContent = fd().noProduct || 'Không tìm thấy sản phẩm, xin lỗi vì sự bất tiện này';
            productList.parentElement.appendChild(emptyMsg);
        }

        const range = selectedRange();
        updateAppliedChips(range);

        // "Tất cả" (hoặc không có mốc) -> hiện hết
        if (!range) {
            products.forEach(p => (p.style.display = ''));
            emptyMsg.style.display = 'none';
            updateShowBtn(products.length);
            return;
        }

        let count = 0;
        products.forEach(li => {
            const price = getProductPrice(li);
            const show = price >= range.min && price <= range.max;
            li.style.display = show ? '' : 'none';
            if (show) count++;
        });

        emptyMsg.style.display = count === 0 ? 'block' : 'none';
        updateShowBtn(count);
    }

    function updateShowBtn(count) {
        const btn = document.getElementById('fd-show-btn');
        if (btn) btn.textContent = fd().showItems ? fd().showItems(count) : `Hiện ${count} sản phẩm →`;
    }

    function updateAppliedChips(range) {
        const container = document.getElementById('fd-applied');
        if (!container) return;
        container.innerHTML = '';
        if (!range) { container.style.display = 'none'; return; }
        container.style.display = 'block';
        const label = range.el.closest('label').textContent.trim();
        const chip = document.createElement('button');
        chip.className = 'fd-chip';
        chip.textContent = '✕ ' + label;
        chip.onclick = () => {
            const all = document.getElementById('fd-price-all');
            if (all) all.checked = true;
            applyFilters();
        };
        container.appendChild(chip);
    }

    // ===== MỞ / ĐÓNG DRAWER =====
    function openDrawer() {
        document.getElementById('fd-overlay').classList.add('open');
        document.getElementById('fd-drawer').classList.add('open');
        document.body.style.overflow = 'hidden';
        const products = Array.from(document.querySelectorAll('ul.products > li'))
            .filter(p => p.style.display !== 'none');
        updateShowBtn(products.length);
    }

    function closeDrawer() {
        document.getElementById('fd-overlay').classList.remove('open');
        document.getElementById('fd-drawer').classList.remove('open');
        document.body.style.overflow = '';
    }

    // ===== XÂY DỰNG DRAWER =====
    function buildDrawer() {
        const overlay = document.createElement('div');
        overlay.id = 'fd-overlay';
        overlay.className = 'fd-overlay';
        overlay.onclick = closeDrawer;

        const drawer = document.createElement('div');
        drawer.id = 'fd-drawer';
        drawer.className = 'fd-drawer';
        const t = fd();
        drawer.innerHTML = `
            <div class="fd-header">
                <span class="fd-title">${t.title || 'Lọc & Sắp Xếp'}</span>
                <div class="fd-header-actions">
                    <button class="fd-clear-all" id="fd-clear-all">${t.clear || 'Xoá tất cả'}</button>
                    <button class="fd-close" id="fd-close">✕</button>
                </div>
            </div>
            <div class="fd-applied" id="fd-applied" style="display:none;"></div>
            <div class="fd-body">
                <div class="fd-group">
                    <div class="fd-group-heading">${t.price || 'Khoảng Giá'}</div>
                    <ul class="fd-group-list">
                        <li><label><input type="radio" name="fd-price" class="price-filter-cb" id="fd-price-all" checked> ${t.all || 'Tất cả'}</label></li>
                        <li><label><input type="radio" name="fd-price" class="price-filter-cb" data-min="0" data-max="14999999"> ${t.u50 || 'Dưới 15 triệu'}</label></li>
                        <li><label><input type="radio" name="fd-price" class="price-filter-cb" data-min="15000000" data-max="29999999"> ${t.r5010 || '15 – 30 triệu'}</label></li>
                        <li><label><input type="radio" name="fd-price" class="price-filter-cb" data-min="30000000" data-max="49999999"> ${t.r10020 || '30 – 50 triệu'}</label></li>
                        <li><label><input type="radio" name="fd-price" class="price-filter-cb" data-min="50000000" data-max="999999999"> ${t.o200 || 'Trên 50 triệu'}</label></li>
                    </ul>
                </div>
                <div class="fd-group">
                    <div class="fd-group-heading">${t.sort || 'Sắp Xếp'}</div>
                    <ul class="fd-group-list">
                        <li><label><input type="radio" name="fd-sort"> ${t.newest || 'Mới nhất'}</label></li>
                        <li><label><input type="radio" name="fd-sort"> ${t.asc || 'Giá tăng dần'}</label></li>
                        <li><label><input type="radio" name="fd-sort"> ${t.desc || 'Giá giảm dần'}</label></li>
                    </ul>
                </div>
            </div>
            <div class="fd-footer">
                <button class="fd-show-btn" id="fd-show-btn">${t.showItems ? t.showItems(0) : 'Hiện sản phẩm →'}</button>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(drawer);

        document.getElementById('fd-close').onclick = closeDrawer;
        document.getElementById('fd-show-btn').onclick = closeDrawer;
        document.getElementById('fd-clear-all').onclick = function () {
            const all = document.getElementById('fd-price-all');
            if (all) all.checked = true;                                   // giá về "Tất cả"
            drawer.querySelectorAll('input[name="fd-sort"]').forEach(r => r.checked = false);
            applyFilters();
        };

        // Trang động: KHÔNG bind lọc client (products-render.js lo server-side). Trang
        // tĩnh: bind change theo logic radio.
        if (!isDynamic()) {
            drawer.querySelectorAll('.price-filter-cb').forEach(cb => {
                cb.addEventListener('change', applyFilters);
            });
        }
    }

    // ===== NÚT LỌC TRÊN TRANG =====
    function buildFilterBar() {
        const mainContent = document.querySelector('.main-content');
        if (!mainContent) return;

        const bar = document.createElement('div');
        bar.className = 'fd-bar';
        const t = fd();
        bar.innerHTML = `
            <button class="fd-open-btn" id="fd-open-btn">
                ${t.btn || 'Lọc & Sắp Xếp'}
                <svg width="18" height="13" viewBox="0 0 18 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <line x1="0" y1="1" x2="18" y2="1" stroke="currentColor" stroke-width="1.8"/>
                    <line x1="0" y1="6.5" x2="18" y2="6.5" stroke="currentColor" stroke-width="1.8"/>
                    <line x1="0" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="1.8"/>
                    <circle cx="5" cy="1" r="2.5" fill="#000" stroke="currentColor" stroke-width="1.5"/>
                    <circle cx="13" cy="6.5" r="2.5" fill="#000" stroke="currentColor" stroke-width="1.5"/>
                    <circle cx="7" cy="12" r="2.5" fill="#000" stroke="currentColor" stroke-width="1.5"/>
                </svg>
            </button>
        `;

        const headline = mainContent.querySelector('.headline');
        if (headline) {
            mainContent.insertBefore(bar, headline.nextSibling);
        } else {
            mainContent.insertBefore(bar, mainContent.firstChild);
        }

        document.getElementById('fd-open-btn').onclick = openDrawer;
    }

    // ===== KHỞI ĐỘNG =====
    document.addEventListener('DOMContentLoaded', function () {
        buildDrawer();
        buildFilterBar();

        // Khởi tạo số đếm ban đầu
        const total = document.querySelectorAll('ul.products > li').length;
        updateShowBtn(total);
    });

})();
