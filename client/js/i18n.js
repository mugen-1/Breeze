(function () {
    var STORAGE_KEY = 'ql_lang';
    var DEFAULT = 'en';

    var T = {
        vi: {
            nav: { home: 'Trang Chủ', cat: 'Danh Mục', feedback: 'Phản Hồi', staff: 'Quản Lý NV' },
            mega: { men: 'Nam', women: 'Nữ', gold: 'Trang Sức Vàng', handbags: 'Túi Xách', sale: 'Khuyến Mãi' },
            megaItems: { shirt: 'Áo', pants: 'Quần', shoes: 'Giày', bracelet: 'Vòng tay', ring: 'Nhẫn' },
            sidebar: { title: 'Danh Mục', men: 'Nam', women: 'Nữ', gold: 'Trang Sức Vàng', handbags: 'Túi Xách', sale: 'Khuyến Mãi' },
            filter: { price: 'Khoảng Giá', all: 'Tất cả', u50: 'Dưới 15 triệu', r5010: '15 – 30 triệu', r10020: '30 – 50 triệu', o200: 'Trên 50 triệu', sort: 'Sắp Xếp', newest: 'Mới nhất', asc: 'Giá tăng dần', desc: 'Giá giảm dần' },
            page: { 'ao-nam.html': 'Áo', 'ao-nu.html': 'Áo', 'gold-jewellery.html': 'Vòng tay', 'handbags.html': 'Túi Xách', 'quan-nam.html': 'Quần', 'giay-nam.html': 'Giày', 'quan-nu.html': 'Quần', 'giay-nu.html': 'Giày', 'nhan.html': 'Nhẫn', 'sale.html': 'Khuyến Mãi' },
            footer: { home: 'Trang chủ', ret: 'Chính sách đổi trả', ship: 'Chính sách giao hàng', priv: 'Chính sách bảo mật', branch: 'Chi nhánh cửa hàng', contact: 'Liên Hệ Với Chúng Tôi', cart: 'Giỏ Hàng Của Tôi', store: 'Định Vị Cửa Hàng', helpTitle: 'Chúng Tôi Có Thể Giúp Bạn?', companyTitle: 'Về Chúng Tôi', langTitle: 'Ngôn Ngữ', countryTitle: 'Quốc Gia/Khu Vực', countryName: 'Việt Nam' },
            fd: { title: 'Lọc & Sắp Xếp', clear: 'Xoá tất cả', price: 'Khoảng Giá', sort: 'Sắp Xếp', newest: 'Mới nhất', asc: 'Giá tăng dần', desc: 'Giá giảm dần', all: 'Tất cả', u50: 'Dưới 15 triệu', r5010: '15 – 30 triệu', r10020: '30 – 50 triệu', o200: 'Trên 50 triệu', btn: 'Lọc & Sắp Xếp', showItems: function (n) { return 'Hiện ' + n + ' sản phẩm →'; }, noProduct: 'Không tìm thấy sản phẩm, xin lỗi vì sự bất tiện này' },
            cart: { add: 'Thêm vào giỏ', added: '✓ Đã thêm' },
            cartPage: {
                heading: 'Giỏ Hàng',
                empty: 'Giỏ hàng của bạn đang trống.',
                continueShopping: 'Tiếp tục mua sắm',
                colProduct: 'Sản phẩm',
                colPrice: 'Đơn giá',
                colQty: 'Số lượng',
                colSubtotal: 'Thành tiền',
                total: 'Tổng cộng:',
                checkout: 'Thanh Toán',
                continueLink: '← Tiếp tục mua sắm',
                removeTitle: 'Xóa',
                checkoutAlert: 'Chức năng thanh toán đang được phát triển!',
                loginRequired: 'Vui lòng đăng nhập để thanh toán.',
                placingOrder: 'Đang tạo đơn hàng...',
                orderSuccess: 'Đặt hàng thành công! Mã đơn #',
                stockError: 'Một số sản phẩm không đủ tồn kho. Vui lòng giảm số lượng rồi thử lại.',
                checkoutFailed: 'Không tạo được đơn hàng. Vui lòng thử lại.',
                viewOrders: 'Xem đơn hàng của tôi →'
            },
            orders: {
                heading: 'Đơn Hàng Của Tôi',
                empty: 'Bạn chưa có đơn hàng nào.',
                loginRequired: 'Vui lòng đăng nhập để xem đơn hàng của bạn.',
                signIn: 'Đăng nhập',
                orderNo: 'Đơn hàng #',
                date: 'Ngày đặt',
                status: 'Trạng thái',
                total: 'Tổng tiền',
                qty: 'SL',
                unitPrice: 'Đơn giá',
                lineTotal: 'Thành tiền',
                continueShopping: '← Tiếp tục mua sắm',
                loadError: 'Không tải được đơn hàng. Kiểm tra server đã chạy chưa?',
                statusMap: { pending: 'Chờ xử lý', paid: 'Đã thanh toán', shipped: 'Đang giao', cancelled: 'Đã huỷ' }
            },
            drawer: { signin: 'Đăng nhập', orders: 'Đơn hàng của tôi' }
        },
        en: {
            nav: { home: 'Home', cat: 'Categories', feedback: 'Feedback', staff: 'Staff Login' },
            mega: { men: 'Men', women: 'Women', gold: 'Gold Jewellery', handbags: 'Handbags', sale: 'Sale' },
            megaItems: { shirt: 'Shirt', pants: 'Pants', shoes: 'Shoes', bracelet: 'Bracelet', ring: 'Ring' },
            sidebar: { title: 'Categories', men: 'Men', women: 'Women', gold: 'Gold Jewellery', handbags: 'Handbags', sale: 'Sale' },
            filter: { price: 'Price Range', all: 'All', u50: 'Under 15M', r5010: '15 – 30M', r10020: '30 – 50M', o200: 'Over 50M', sort: 'Sort By', newest: 'Newest', asc: 'Price: Low to High', desc: 'Price: High to Low' },
            page: { 'ao-nam.html': 'Shirt', 'ao-nu.html': 'Shirt', 'gold-jewellery.html': 'Bracelet', 'handbags.html': 'Handbags', 'quan-nam.html': 'Pants', 'giay-nam.html': 'Shoes', 'quan-nu.html': 'Pants', 'giay-nu.html': 'Shoes', 'nhan.html': 'Ring', 'sale.html': 'Sale' },
            footer: { home: 'Home', ret: 'Return Policy', ship: 'Shipping Policy', priv: 'Privacy Policy', branch: 'Store Branches', contact: 'Contact Us', cart: 'My Cart', store: 'Store Locator', helpTitle: 'May We Help You?', companyTitle: 'About Us', langTitle: 'Language', countryTitle: 'Country/Region', countryName: 'Vietnam' },
            fd: { title: 'Filter & Sort', clear: 'Clear All', price: 'Price Range', sort: 'Sort By', newest: 'Newest', asc: 'Price: Low to High', desc: 'Price: High to Low', all: 'All', u50: 'Under 15M', r5010: '15 – 30M', r10020: '30 – 50M', o200: 'Over 50M', btn: 'Filter & Sort', showItems: function (n) { return 'Show ' + n + ' items →'; }, noProduct: 'No products found, sorry for the inconvenience' },
            cart: { add: 'Add to cart', added: '✓ Added' },
            cartPage: {
                heading: 'Shopping Cart',
                empty: 'Your cart is empty.',
                continueShopping: 'Continue shopping',
                colProduct: 'Product',
                colPrice: 'Unit Price',
                colQty: 'Quantity',
                colSubtotal: 'Subtotal',
                total: 'Total:',
                checkout: 'Checkout',
                continueLink: '← Continue Shopping',
                removeTitle: 'Remove',
                checkoutAlert: 'Checkout feature is under development!',
                loginRequired: 'Please sign in to checkout.',
                placingOrder: 'Placing order...',
                orderSuccess: 'Order placed! Order #',
                stockError: 'Some items are out of stock. Please reduce the quantity and try again.',
                checkoutFailed: 'Could not place the order. Please try again.',
                viewOrders: 'View my orders →'
            },
            orders: {
                heading: 'My Orders',
                empty: 'You have no orders yet.',
                loginRequired: 'Please sign in to view your orders.',
                signIn: 'Sign In',
                orderNo: 'Order #',
                date: 'Order date',
                status: 'Status',
                total: 'Total',
                qty: 'Qty',
                unitPrice: 'Unit price',
                lineTotal: 'Subtotal',
                continueShopping: '← Continue shopping',
                loadError: 'Could not load orders. Is the server running?',
                statusMap: { pending: 'Pending', paid: 'Paid', shipped: 'Shipping', cancelled: 'Cancelled' }
            },
            drawer: { signin: 'Sign In', orders: 'My Orders' },
            policy: {
                'chinhsachdoitra.html': {
                    title: 'Return Policy',
                    body: `<section>
                <h2>1. Return Conditions</h2>
                <p>
                    Customers should check the condition of the goods and may exchange or return the products
                    right at the time of delivery/receipt in the following cases:
                </p>
                <ul>
                    <li>The goods do not match the type or model in the placed order or as shown on the website at the time of ordering.</li>
                    <li>Insufficient quantity or an incomplete set compared to the order.</li>
                    <li>The external condition is affected, such as torn packaging, peeling, or breakage…</li>
                </ul>
            </section>

            <section>
                <h2>2. Time Limits for Notice and Sending Returned Products</h2>
                <ul>
                    <li>
                        <strong>Return notice period:</strong>
                        within 72 hours of receiving the product in case of missing accessories, gifts, or breakage.
                    </li>
                    <li>
                        <strong>Return shipping period:</strong>
                        within 7 days of receiving the product.
                    </li>
                    <li>
                        <strong>Return location:</strong>
                        Customers may bring the goods directly to our office/store or send them by post.
                    </li>
                </ul>
                <p>
                    If you have any feedback or complaints regarding product quality,
                    please contact our customer care hotline.
                </p>
            </section>`
                },
                'chinhsachgiaohang.html': {
                    title: 'Shipping Policy',
                    body: `<section>
                <h2>1. Home Delivery and Cash Collection</h2>
                <p>
                    Customers order products on the website and then choose cash on delivery (COD) as the payment method.
                    The payment process is carried out as follows:
                </p>
                <ul>
                    <li>After you place an order successfully, the delivery staff will call you before delivering.</li>
                    <li>The delivery staff will arrive within 48 - 72 working hours after receiving the order request.</li>
                    <li>Pay for and receive the product from the delivery staff.</li>
                </ul>
                <p>Note: For some locations with inconvenient transport, delivery time may take longer than 72 hours.</p>
                <p>We will notify you of these locations.</p>
            </section>

            <section>
                <h2>2. Purchase and Payment at Bookstore Nationwide</h2>
                <p>Customers can visit a Bookstore store to browse and shop.</p>
                <p>The list of Bookstore addresses will be updated on the homepage.</p>
            </section>`
                },
                'chinhsachbaomat.html': {
                    title: 'Privacy Policy',
                    body: `<section>
                <p>
                    This information privacy policy discloses how the Website (hereinafter referred to as “We”)
                    collects, stores, and processes personal information or data (“Personal Information”) of Customers
                    through the website.
                </p>
                <p>
                    We are committed to using appropriate measures to secure the information you provide as well as to
                    protect it from unauthorized access. However, we cannot guarantee to prevent all unauthorized access.
                    In the event of unauthorized access beyond our control, we shall not be liable in any form for any
                    claims, disputes, or damages arising from or related to such unauthorized access.
                </p>
                <p>
                    You are advised to clearly understand your rights when using the services we provide on this website.
                </p>
                <p>
                    We make the following commitments in accordance with the laws of Vietnam, including the methods
                    we use to protect your information:
                </p>
            </section>

            <section>
                <h2>1. Purpose and Scope of Information Collection</h2>
                <ul>
                    <li>
                        To access and use certain services on the website, you may be required to register personal
                        (member) information with us, including: Email, Full name, Contact phone number, address, company,
                        username, password.
                    </li>
                </ul>
            </section>

            <section>
                <h2>2. Scope of Information Use</h2>
                <p>The purpose of using the information provided by Members is to:</p>
                <ul>
                    <li>Support you in purchasing products.</li>
                    <li>Answer inquiries.</li>
                    <li>
                        Provide you with the latest information on our website, conduct customer surveys, and carry out
                        promotional activities related to the website's products and services if you subscribe to email notifications.
                    </li>
                </ul>
            </section>

            <section>
                <h2>3. Information Retention Period</h2>
                <ul>
                    <li>
                        A Member's personal data will be stored until there is a request for cancellation or the Member
                        logs in and performs the cancellation.
                    </li>
                    <li>
                        In all other cases, the Member's personal information will be kept secure on the website's server.
                    </li>
                </ul>
            </section>

            <section>
                <h2>4. Means and Tools for Users to Access and Edit Their Personal Data</h2>
                <p>
                    Users can log in to their personal account and use the “Update account information” function,
                    or contact us by email or directly request the website administrator to adjust or delete their personal data.
                </p>
            </section>

            <section>
                <h2>5. Commitment to Securing Customer Personal Information</h2>
                <p>
                    For us, the privacy of visitors is extremely important. We will not share your information with any other
                    company except companies and third parties directly involved in delivering what you purchased.
                </p>
                <p>
                    In some special cases, the website may be required to disclose personal information, for example when there
                    are grounds that disclosure is necessary to prevent threats to life and health, or for law enforcement purposes.
                    We are committed to complying with the Privacy Act and the National Privacy Principles.
                </p>
            </section>`
                }
            }
        }
    };

    // Expose to filter.js
    window.__i18n = { current: DEFAULT, T: T };

    var EXCLUDED = ['index.html', 'login.html', 'signup.html', 'forgot-password.html', ''];

    function currentPage() {
        var parts = location.pathname.split('/');
        return parts[parts.length - 1] || 'index.html';
    }

    function applyLang(lang) {
        window.__i18n.current = lang;
        updateSwitcherUI(lang);

        var t = T[lang];

        // Nav (áp dụng cho MỌI trang)
        document.querySelectorAll('.menu li a').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === 'index.html') a.textContent = t.nav.home;
            else if (a.classList.contains('mega-trigger')) a.innerHTML = t.nav.cat + ' <span class="mega-arrow">&#9660;</span>';
            else if (href === 'lienheshop.html') a.textContent = t.nav.feedback;
            else if (href === 'login.html') a.textContent = t.nav.staff;
        });

        // Header trang chính sách: nhãn "Danh Mục"
        var phLabel = document.querySelector('.ph-menu-label');
        if (phLabel) phLabel.textContent = t.nav.cat;

        // Nút mở menu ở trang chủ: <button class="drawer-trigger"> gồm icon + text "Danh Mục"
        document.querySelectorAll('.drawer-trigger').forEach(function (btn) {
            for (var i = 0; i < btn.childNodes.length; i++) {
                var n = btn.childNodes[i];
                if (n.nodeType === 3 && n.textContent.trim()) { n.textContent = ' ' + t.nav.cat; break; }
            }
        });

        // Drawer menu (mọi trang có drawer)
        translateDrawer(t);

        // Nội dung trang chính sách (song ngữ VI/EN)
        translatePolicy(lang, t);

        // Mega headings (áp dụng cho MỌI trang)
        document.querySelectorAll('.mega-heading').forEach(function (el) {
            var txt = el.textContent.trim();
            if (txt === 'Men' || txt === 'Nam') el.textContent = t.mega.men;
            else if (txt === 'Women' || txt === 'Nữ') el.textContent = t.mega.women;
            else if (txt === 'Gold Jewellery' || txt === 'Trang Sức Vàng') el.textContent = t.mega.gold;
            else if (txt === 'Handbags' || txt === 'Túi Xách') el.textContent = t.mega.handbags;
        });

        // Mega links (áp dụng cho MỌI trang)
        document.querySelectorAll('.mega-col ul li a').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === 'ao-nam.html') a.textContent = t.megaItems.shirt;
            else if (href === 'quan-nam.html') a.textContent = t.megaItems.pants;
            else if (href === 'giay-nam.html') a.textContent = t.megaItems.shoes;
            else if (href === 'ao-nu.html') a.textContent = t.megaItems.shirt;
            else if (href === 'quan-nu.html') a.textContent = t.megaItems.pants;
            else if (href === 'giay-nu.html') a.textContent = t.megaItems.shoes;
            else if (href === 'gold-jewellery.html') a.textContent = t.megaItems.bracelet;
            else if (href === 'nhan.html') a.textContent = t.megaItems.ring;
            else if (href === 'handbags.html') a.textContent = t.mega.handbags;
            else if (href === 'sale.html') a.textContent = t.mega.sale;
        });

        // Footer (áp dụng cho MỌI trang, kể cả index)
        // Footer mới (index) dùng data-fk; footer cũ (trang khác) dịch theo href
        document.querySelectorAll('.footer-content a').forEach(function (a) {
            var fk = a.getAttribute('data-fk');
            if (fk) { if (t.footer[fk]) a.textContent = t.footer[fk]; return; }
            var href = a.getAttribute('href') || '';
            if (href === 'index.html') a.textContent = t.footer.home;
            else if (href === 'chinhsachdoitra.html') a.textContent = t.footer.ret;
            else if (href === 'chinhsachgiaohang.html') a.textContent = t.footer.ship;
            else if (href === 'chinhsachbaomat.html') a.textContent = t.footer.priv;
            else if (href === 'chinhanhcuahang.html') a.textContent = t.footer.branch;
        });
        var fEl;
        fEl = document.getElementById('footer-help-title'); if (fEl) fEl.textContent = t.footer.helpTitle;
        fEl = document.getElementById('footer-company-title'); if (fEl) fEl.textContent = t.footer.companyTitle;
        fEl = document.getElementById('footer-lang-title'); if (fEl) fEl.textContent = t.footer.langTitle;
        fEl = document.getElementById('footer-country-title'); if (fEl) fEl.textContent = t.footer.countryTitle;
        fEl = document.getElementById('footer-country-name'); if (fEl) fEl.textContent = t.footer.countryName;

        // Các trang exclude: chỉ dịch nav/header/mega-menu, không dịch nội dung
        if (EXCLUDED.indexOf(currentPage()) !== -1) return;

        // Sidebar title
        document.querySelectorAll('.sidebar-category-title').forEach(function (el) { el.textContent = t.sidebar.title; });

        // Sidebar links
        document.querySelectorAll('.sidebar-links a').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === 'ao-nam.html') a.textContent = t.sidebar.men;
            else if (href === 'ao-nu.html') a.textContent = t.sidebar.women;
            else if (href === 'gold-jewellery.html') a.textContent = t.sidebar.gold;
            else if (href === 'handbags.html') a.textContent = t.sidebar.handbags;
            else if (href === 'sale.html') a.textContent = t.sidebar.sale;
        });

        // Sidebar filter headings
        document.querySelectorAll('.sidebar-filter-heading').forEach(function (el) {
            var icon = el.querySelector('.toggle-icon');
            var raw = el.textContent.replace('▾', '').replace('▸', '').trim();
            if (raw === 'Khoảng Giá' || raw === 'Price Range') { if (el.firstChild) el.firstChild.textContent = t.filter.price + ' '; }
            else if (raw === 'Sắp Xếp' || raw === 'Sort By' || raw === 'Sort') { if (el.firstChild) el.firstChild.textContent = t.filter.sort + ' '; }
        });

        // Sidebar filter labels
        document.querySelectorAll('.sidebar-filter-list label').forEach(function (label) {
            var cb = label.querySelector('input[type="checkbox"]');
            var radio = label.querySelector('input[type="radio"]');
            if (cb) {
                var min = cb.dataset.min;
                var txt = min === '0' ? t.filter.u50 : min === '50000' ? t.filter.r5010 : min === '100001' ? t.filter.r10020 : t.filter.o200;
                if (label.lastChild) label.lastChild.textContent = ' ' + txt;
            }
            if (radio) {
                var cur = label.textContent.trim();
                if (cur === 'Mới nhất' || cur === 'Newest') { if (label.lastChild) label.lastChild.textContent = ' ' + t.filter.newest; }
                else if (cur === 'Giá tăng dần' || cur === 'Price: Low to High') { if (label.lastChild) label.lastChild.textContent = ' ' + t.filter.asc; }
                else if (cur === 'Giá giảm dần' || cur === 'Price: High to Low') { if (label.lastChild) label.lastChild.textContent = ' ' + t.filter.desc; }
            }
        });

        // Page headline
        var pg = currentPage();
        var h4 = document.querySelector('.headline h4');
        if (h4 && t.page[pg]) h4.textContent = t.page[pg];

        // Filter bar button
        var fdBtn = document.getElementById('fd-open-btn');
        if (fdBtn) {
            var svg = fdBtn.querySelector('svg');
            fdBtn.textContent = '';
            fdBtn.appendChild(document.createTextNode(t.fd.btn + ' '));
            if (svg) fdBtn.appendChild(svg);
        }

        // No product msg
        var noMsg = document.querySelector('.no-product-msg');
        if (noMsg) noMsg.textContent = t.fd.noProduct;

        // Add to cart buttons
        document.querySelectorAll('.btn-add-cart:not(.added)').forEach(function (btn) {
            btn.textContent = t.cart.add;
        });

        // Cart page
        var cp = t.cartPage;
        var el;
        el = document.querySelector('.cart-heading'); if (el) el.textContent = cp.heading;
        el = document.querySelector('.btn-checkout'); if (el) el.textContent = cp.checkout;
        el = document.querySelector('.cart-continue'); if (el) el.textContent = cp.continueLink;
        var totalEl = document.querySelector('.cart-total');
        if (totalEl) {
            var priceSpan = totalEl.querySelector('span');
            totalEl.textContent = cp.total + ' ';
            if (priceSpan) totalEl.appendChild(priceSpan);
        }
        var emptyEl = document.getElementById('cart-empty');
        if (emptyEl) {
            var emptyLink = emptyEl.querySelector('a');
            emptyEl.childNodes.forEach(function(n) { if (n.nodeType === 3) n.textContent = n.textContent.replace(/Giỏ hàng của bạn đang trống\.|Your cart is empty\./g, cp.empty); });
            if (emptyLink) emptyLink.textContent = cp.continueShopping;
        }
        var ths = document.querySelectorAll('.cart-table thead th');
        if (ths.length >= 5) {
            ths[1].textContent = cp.colProduct;
            ths[2].textContent = cp.colPrice;
            ths[3].textContent = cp.colQty;
            ths[4].textContent = cp.colSubtotal;
        }
        document.querySelectorAll('.btn-remove').forEach(function(btn) { btn.title = cp.removeTitle; });
        if (currentPage() === 'cart.html' && typeof window.renderCart === 'function') window.renderCart();

        // Drawer
        refreshDrawer(t);

        document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } }));
    }

    function translateDrawer(t) {
        var d = document.getElementById('drawer-menu');
        if (!d) return;

        var el = d.querySelector('.drawer-title');
        if (el) el.textContent = t.nav.cat;

        var accMap = {
            'Nam': t.mega.men, 'Men': t.mega.men,
            'Nữ': t.mega.women, 'Women': t.mega.women,
            'Trang Sức Vàng': t.mega.gold, 'Gold Jewellery': t.mega.gold,
            'Túi Xách': t.mega.handbags, 'Handbags': t.mega.handbags,
            'Khuyến Mãi': t.mega.sale, 'Sale': t.mega.sale
        };
        d.querySelectorAll('.drawer-acc-btn').forEach(function (btn) {
            var node = btn.firstChild; // text node trước icon
            if (!node) return;
            var key = (node.textContent || '').trim();
            if (accMap[key]) node.textContent = accMap[key] + ' ';
        });

        d.querySelectorAll('.drawer-sub li a').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === 'ao-nam.html' || href === 'ao-nu.html') a.textContent = t.megaItems.shirt;
            else if (href === 'quan-nam.html' || href === 'quan-nu.html') a.textContent = t.megaItems.pants;
            else if (href === 'giay-nam.html' || href === 'giay-nu.html') a.textContent = t.megaItems.shoes;
            else if (href === 'gold-jewellery.html') a.textContent = t.megaItems.bracelet;
            else if (href === 'nhan.html') a.textContent = t.megaItems.ring;
            else if (href === 'handbags.html') a.textContent = t.mega.handbags;
            else if (href === 'sale.html') a.textContent = t.mega.sale;
        });

        d.querySelectorAll('.drawer-links li a').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === 'login.html') a.textContent = t.drawer.signin;
            else if (href === 'orders.html') a.textContent = t.drawer.orders;
            else if (href === 'lienheshop.html') a.textContent = t.nav.feedback;
        });
    }

    function translatePolicy(lang, t) {
        var body = document.querySelector('.policy-body');
        if (!body) return;
        var titleEl = document.querySelector('.policy-title');

        // Lưu bản tiếng Việt gốc (từ DOM) 1 lần để khôi phục khi chọn VI
        if (!window.__policyVI) {
            window.__policyVI = { title: titleEl ? titleEl.textContent : '', body: body.innerHTML };
        }

        var en = t.policy && t.policy[currentPage()];
        if (lang === 'en' && en) {
            if (titleEl) titleEl.textContent = en.title;
            body.innerHTML = en.body;
        } else {
            if (titleEl) titleEl.textContent = window.__policyVI.title;
            body.innerHTML = window.__policyVI.body;
        }
    }

    function refreshDrawer(t) {
        var drawer = document.getElementById('fd-drawer');
        if (!drawer) return;

        var el;
        el = drawer.querySelector('.fd-title'); if (el) el.textContent = t.fd.title;
        el = drawer.querySelector('.fd-clear-all'); if (el) el.textContent = t.fd.clear;

        drawer.querySelectorAll('.fd-group-heading').forEach(function (h) {
            var txt = h.textContent.trim();
            if (txt === 'Khoảng Giá' || txt === 'Price Range') h.textContent = t.fd.price;
            else if (txt === 'Sắp Xếp' || txt === 'Sort By') h.textContent = t.fd.sort;
        });

        drawer.querySelectorAll('.price-filter-cb').forEach(function (cb) {
            var label = cb.closest('label'); if (!label) return;
            var min = cb.dataset.min;
            var txt = min === '0' ? t.fd.u50 : min === '50000' ? t.fd.r5010 : min === '100001' ? t.fd.r10020 : t.fd.o200;
            if (label.lastChild) label.lastChild.textContent = ' ' + txt;
        });

        var radios = Array.from(drawer.querySelectorAll('input[name="fd-sort"]'));
        var sortTexts = [t.fd.newest, t.fd.asc, t.fd.desc];
        radios.forEach(function (r, i) {
            var label = r.closest('label'); if (!label) return;
            if (label.lastChild) label.lastChild.textContent = ' ' + (sortTexts[i] || '');
        });

        el = document.getElementById('fd-show-btn');
        if (el) {
            var m = el.textContent.match(/\d+/);
            var count = m ? parseInt(m[0], 10) : document.querySelectorAll('ul.products > li').length;
            el.textContent = t.fd.showItems(count);
        }
    }

    // ===== SWITCHER UI =====
    function injectStyles() {
        var css = [
            '#lang-switcher { position: relative; display: inline-flex; align-items: center; z-index: 1100; }',
            '.lang-btn { background: none; border: none; cursor: pointer; padding: 0; line-height: 1; display: flex; align-items: center; }',
            '.lang-btn .fa-globe { font-size: 18px; color: #111; transition: color 0.2s; }',
            '.lang-btn:hover .fa-globe { color: #777; }',
            '.lang-dropdown { display: none; position: absolute; top: calc(100% + 12px); right: 0; background: #fff; border: 1px solid #ddd; box-shadow: 0 8px 24px rgba(0,0,0,0.18); min-width: 155px; border-radius: 4px; padding: 6px 0; z-index: 2000; }',
            '.lang-dropdown.open { display: block; }',
            '.lang-option { display: flex; align-items: center; gap: 10px; width: 100%; background: none; border: none; padding: 10px 16px; font-size: 14px; color: #111; cursor: pointer; text-align: left; font-family: inherit; transition: background .15s; white-space: nowrap; }',
            '.lang-option img { border-radius: 2px; object-fit: cover; flex-shrink: 0; box-shadow: 0 0 2px rgba(0,0,0,0.2); }',
            '.lang-option:hover { background: #f5f5f5; }',
            '.lang-option.active { font-weight: 700; }'
        ].join('\n');
        var s = document.createElement('style');
        s.textContent = css;
        document.head.appendChild(s);
    }

    function buildSwitcher() {
        // Trang có ô chọn ngôn ngữ ở footer (index + các trang chính sách): dùng dropdown footer
        if (document.getElementById('footer-lang')) { buildFooterSwitcher(); return; }
        var host = document.querySelector('.ph-actions') || document.querySelector('.policy-header') || document.querySelector('header');
        if (!host) return;
        var el = document.createElement('div');
        el.id = 'lang-switcher';
        var base = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
        el.innerHTML = '<button class="lang-btn" id="lang-btn" title="Language"><i class="fa fa-globe" id="lang-flag"></i></button><div class="lang-dropdown" id="lang-dropdown"><button class="lang-option" data-lang="vi"><img src="' + base + 'img/flag-vn.svg" width="24" height="16" alt="VN"> Tiếng Việt</button><button class="lang-option" data-lang="en"><img src="' + base + 'img/flag-us.svg" width="24" height="16" alt="US"> English</button></div>';
        host.appendChild(el);

        document.getElementById('lang-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            document.getElementById('lang-dropdown').classList.toggle('open');
        });
        document.addEventListener('click', function () {
            var dd = document.getElementById('lang-dropdown');
            if (dd) dd.classList.remove('open');
        });
        el.querySelectorAll('.lang-option').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var lang = this.dataset.lang;
                localStorage.setItem(STORAGE_KEY, lang);
                applyLang(lang);
                document.getElementById('lang-dropdown').classList.remove('open');
            });
        });
    }

    function buildFooterSwitcher() {
        var box = document.getElementById('footer-lang');
        if (!box) return;
        var btn = document.getElementById('footer-lang-btn');
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            box.classList.toggle('open');
        });
        document.addEventListener('click', function () { box.classList.remove('open'); });
        box.querySelectorAll('.footer-lang-opt').forEach(function (opt) {
            opt.addEventListener('click', function (e) {
                e.stopPropagation();
                var lang = this.dataset.lang;
                localStorage.setItem(STORAGE_KEY, lang);
                applyLang(lang);
                box.classList.remove('open');
            });
        });
    }

    var LANG_NAMES = { vi: 'Tiếng Việt', en: 'English' };

    function updateSwitcherUI(lang) {
        document.querySelectorAll('.lang-option').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });
        var cur = document.getElementById('footer-lang-current');
        if (cur) cur.textContent = LANG_NAMES[lang] || lang;
        document.querySelectorAll('.footer-lang-opt').forEach(function (opt) {
            opt.classList.toggle('active', opt.dataset.lang === lang);
        });
    }

    // ===== INIT =====
    document.addEventListener('DOMContentLoaded', function () {
        if (!document.getElementById('footer-lang')) injectStyles();
        buildSwitcher();
        var saved = localStorage.getItem(STORAGE_KEY) || DEFAULT;
        applyLang(saved);
    });

    // Re-apply after filter drawer is built (filter.js fires after i18n.js)
    document.addEventListener('langchange', function () { /* handled above */ });
    window.addEventListener('load', function () {
        var saved = localStorage.getItem(STORAGE_KEY) || DEFAULT;
        if (saved !== 'vi') refreshDrawer(T[saved]);
    });

})();
