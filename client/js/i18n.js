(function () {
    var STORAGE_KEY = 'ql_lang';
    var DEFAULT = 'en';

    var T = {
        vi: {
            nav: { home: 'Trang Chủ', cat: 'Danh Mục', feedback: 'Phản Hồi', staff: 'Quản Lý NV' },
            mega: { men: 'Sản phẩm', women: 'Nữ', gold: 'Phụ Kiện', handbags: 'Túi Xách', sale: 'Khuyến Mãi' },
            megaItems: { shirt: 'Áo', pants: 'Quần', shoes: 'Giày & Dép', accessory: 'Phụ Kiện' },
            sidebar: { title: 'Danh Mục', men: 'Sản phẩm', women: 'Nữ', gold: 'Phụ Kiện', handbags: 'Túi Xách', sale: 'Khuyến Mãi' },
            filter: { price: 'Khoảng Giá', all: 'Tất cả', u50: 'Dưới 200.000đ', r5010: '200.000đ – 400.000đ', r10020: '400.000đ – 700.000đ', o200: 'Trên 700.000đ', sort: 'Sắp Xếp', newest: 'Mới nhất', asc: 'Giá tăng dần', desc: 'Giá giảm dần' },
            page: { 'sanpham-ao.html': 'Áo', 'gold-jewellery.html': 'Phụ Kiện', 'handbags.html': 'Túi Xách', 'sanpham-quan.html': 'Quần', 'sanpham-giay.html': 'Giày & Dép', 'sale.html': 'Khuyến Mãi' },
            footer: { home: 'Trang chủ', ret: 'Chính sách đổi trả', ship: 'Chính sách giao hàng', priv: 'Chính sách bảo mật', cart: 'Giỏ Hàng Của Tôi', helpTitle: 'Chúng Tôi Có Thể Giúp Bạn?', companyTitle: 'Về Chúng Tôi', langTitle: 'Ngôn Ngữ', countryTitle: 'Quốc Gia/Khu Vực', countryName: 'Việt Nam' },
            fd: { title: 'Lọc & Sắp Xếp', clear: 'Xoá tất cả', price: 'Khoảng Giá', sort: 'Sắp Xếp', newest: 'Mới nhất', asc: 'Giá tăng dần', desc: 'Giá giảm dần', all: 'Tất cả', u50: 'Dưới 200.000đ', r5010: '200.000đ – 400.000đ', r10020: '400.000đ – 700.000đ', o200: 'Trên 700.000đ', btn: 'Lọc & Sắp Xếp', showItems: function (n) { return 'Hiện ' + n + ' sản phẩm →'; }, noProduct: 'Không tìm thấy sản phẩm, xin lỗi vì sự bất tiện này' },
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
            mega: { men: 'Products', women: 'Women', gold: 'Accessories', handbags: 'Handbags', sale: 'Sale' },
            megaItems: { shirt: 'Shirt', pants: 'Pants', shoes: 'Shoes & Sandals', accessory: 'Accessories' },
            sidebar: { title: 'Categories', men: 'Products', women: 'Women', gold: 'Accessories', handbags: 'Handbags', sale: 'Sale' },
            filter: { price: 'Price Range', all: 'All', u50: 'Under 200,000đ', r5010: '200,000đ – 400,000đ', r10020: '400,000đ – 700,000đ', o200: 'Over 700,000đ', sort: 'Sort By', newest: 'Newest', asc: 'Price: Low to High', desc: 'Price: High to Low' },
            page: { 'sanpham-ao.html': 'Shirt', 'gold-jewellery.html': 'Accessories', 'handbags.html': 'Handbags', 'sanpham-quan.html': 'Pants', 'sanpham-giay.html': 'Shoes & Sandals', 'sale.html': 'Sale' },
            footer: { home: 'Home', ret: 'Return Policy', ship: 'Shipping Policy', priv: 'Privacy Policy', cart: 'My Cart', helpTitle: 'May We Help You?', companyTitle: 'About Us', langTitle: 'Language', countryTitle: 'Country/Region', countryName: 'Vietnam' },
            fd: { title: 'Filter & Sort', clear: 'Clear All', price: 'Price Range', sort: 'Sort By', newest: 'Newest', asc: 'Price: Low to High', desc: 'Price: High to Low', all: 'All', u50: 'Under 200,000đ', r5010: '200,000đ – 400,000đ', r10020: '400,000đ – 700,000đ', o200: 'Over 700,000đ', btn: 'Filter & Sort', showItems: function (n) { return 'Show ' + n + ' items →'; }, noProduct: 'No products found, sorry for the inconvenience' },
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

    /* ===== UI dictionary (data-i18n) =====================================
       Từ điển PHẲNG, khoá đặt theo namespace của trang:
         co.*  checkout.html      inv.* invoice.html    adm.* admin.html
         pf.*  profile.html       au.*  login/signup/forgot-password
         ix.*  index.html         sr.*  search.html     pd.*  product.html
         acc.* menu tài khoản (account-menu.js)
       Cách dùng trong HTML:
         data-i18n="key"        -> textContent
         data-i18n-html="key"   -> innerHTML (khi chuỗi có thẻ con)
         data-i18n-ph="key"     -> placeholder
         data-i18n-title="key"  -> title
         data-i18n-aria="key"   -> aria-label
         <body data-i18n-doctitle="key"> -> document.title
       Cách dùng trong JS: window.__i18n.t('key') hoặc t('key', 'mặc định').
    ===================================================================== */
    var UI = { vi: {}, en: {} };

    // Gộp một nhóm khoá (theo trang) vào từ điển phẳng UI.
    function reg(group) {
        Object.keys(group.vi).forEach(function (k) { UI.vi[k] = group.vi[k]; });
        Object.keys(group.en).forEach(function (k) { UI.en[k] = group.en[k]; });
    }

    /* --- Dùng chung: trạng thái đơn, hình thức thanh toán -------------- */
    reg({
        vi: {
            'st.pending': 'Chờ xử lý', 'st.paid': 'Đã thanh toán', 'st.shipped': 'Đang giao',
            'st.completed': 'Hoàn tất', 'st.cancelled': 'Đã hủy',
            'pay.visa': 'Thẻ Visa', 'pay.mastercard': 'Thẻ Mastercard',
            'pay.cod': 'Tiền mặt (COD)', 'pay.momo': 'Ví MoMo',
            'com.account': 'Tài khoản', 'com.cart': 'Giỏ hàng', 'com.select': '-- Chọn --',
            'com.loading': 'Đang tải…', 'com.save': 'Lưu', 'com.cancel': 'Hủy',
            'com.edit': 'Sửa', 'com.delete': 'Xóa', 'com.close': 'Đóng',
            'com.signin': 'Đăng nhập', 'com.signout': 'Đăng xuất',
            'com.netErr': 'Lỗi kết nối máy chủ', 'com.optional': '(không bắt buộc)',
            'com.items': 'sản phẩm', 'com.free': 'Miễn phí', 'com.vietnam': 'Việt Nam'
        },
        en: {
            'st.pending': 'Pending', 'st.paid': 'Paid', 'st.shipped': 'Shipping',
            'st.completed': 'Completed', 'st.cancelled': 'Cancelled',
            'pay.visa': 'Visa card', 'pay.mastercard': 'Mastercard',
            'pay.cod': 'Cash on delivery (COD)', 'pay.momo': 'MoMo wallet',
            'com.account': 'Account', 'com.cart': 'Cart', 'com.select': '-- Select --',
            'com.loading': 'Loading…', 'com.save': 'Save', 'com.cancel': 'Cancel',
            'com.edit': 'Edit', 'com.delete': 'Delete', 'com.close': 'Close',
            'com.signin': 'Sign In', 'com.signout': 'Sign Out',
            'com.netErr': 'Server connection error', 'com.optional': '(optional)',
            'com.items': 'items', 'com.free': 'Free', 'com.vietnam': 'Vietnam'
        }
    });

    /* --- checkout.html (co.*) ----------------------------------------- */
    reg({
        vi: {
            'co.docTitle': 'Thanh Toán - BREEZE',
            'co.hello': 'Xin chào!',
            'co.helloName': 'Xin chào, {name}!',
            'co.heroTitle': 'THANH TOÁN',
            'co.contact': 'Liên hệ',
            'co.address': 'Địa chỉ',
            'co.shipAddress': 'Địa chỉ giao hàng',
            'co.firstname': 'Tên',
            'co.lastname': 'Họ',
            'co.nameHelp': 'Vui lòng điền đầy đủ Họ và Tên',
            'co.phone': 'Số điện thoại',
            'co.phonePh': 'VD: 0901234567',
            'co.phoneHelp': 'Định dạng số điện thoại Việt Nam (10 số, bắt đầu 03/05/07/08/09)',
            'co.street': 'Số nhà / Tên đường',
            'co.streetHelp': 'Ví dụ: 33 Lê Duẩn, ...',
            'co.building': 'Tên tòa nhà / Số tầng',
            'co.buildingHelp': 'Ví dụ: Tòa nhà chung cư ..., tầng 5',
            'co.city': 'Thành phố / Tỉnh',
            'co.district': 'Quận / Huyện',
            'co.ward': 'Phường / Xã',
            'co.postal': 'Mã bưu chính',
            'co.country': 'Quốc gia',
            'co.payment': 'Thanh toán',
            'co.payMethod': 'Phương thức thanh toán',
            'co.submit': 'Đặt hàng',
            'co.orderInfo': 'Thông tin đơn hàng',
            'co.subtotal': 'Tạm tính',
            'co.shipping': 'Giao hàng',
            'co.discount': 'Giảm giá',
            'co.voucherLabel': 'Mã giảm giá',
            'co.voucherPh': 'Nhập mã',
            'co.voucherApply': 'Áp dụng',
            'co.voucherRemove': 'Xoá mã giảm giá',
            'co.total': 'Tổng',
            'co.emptyItems': 'Chưa có sản phẩm.',
            'co.metaSize': 'Size', 'co.metaColor': 'Màu', 'co.metaQty': 'SL', 'co.you': 'bạn',
            'co.errFirstname': 'Vui lòng nhập Tên',
            'co.errLastname': 'Vui lòng nhập Họ',
            'co.errPhoneEmpty': 'Vui lòng nhập số điện thoại',
            'co.errPhoneBad': 'Số điện thoại không hợp lệ (VD: 0901234567)',
            'co.errStreet': 'Vui lòng nhập số nhà / tên đường',
            'co.errCity': 'Vui lòng chọn Thành phố / Tỉnh',
            'co.errDistrict': 'Vui lòng chọn Quận / Huyện',
            'co.errWard': 'Vui lòng chọn Phường / Xã',
            'co.errPostal': 'Vui lòng chọn Mã bưu chính',
            'co.errPay': 'Vui lòng chọn phương thức thanh toán',
            'co.adminBlocked': 'Tài Khoản Không Đúng — tài khoản admin không thể thanh toán đơn hàng.',
            'co.vcRate': 'Bạn thử mã quá nhiều lần, vui lòng đợi một phút.',
            'co.vcCheckErr': 'Không kiểm tra được mã.',
            'co.vcCheckRetry': 'Không kiểm tra được mã, vui lòng thử lại.',
            'co.vcInvalid': 'Mã giảm giá không hợp lệ',
            'co.vcApplyErr': 'Không áp dụng được mã, vui lòng thử lại.',
            'co.vcOk': 'Mã hợp lệ · giảm {amount}. Nhấn Áp dụng.'
        },
        en: {
            'co.docTitle': 'Checkout - BREEZE',
            'co.hello': 'Hello!',
            'co.helloName': 'Hello, {name}!',
            'co.heroTitle': 'CHECKOUT',
            'co.contact': 'Contact',
            'co.address': 'Address',
            'co.shipAddress': 'Shipping address',
            'co.firstname': 'First name',
            'co.lastname': 'Last name',
            'co.nameHelp': 'Please enter your full name',
            'co.phone': 'Phone number',
            'co.phonePh': 'e.g. 0901234567',
            'co.phoneHelp': 'Vietnamese phone format (10 digits, starting 03/05/07/08/09)',
            'co.street': 'House number / Street',
            'co.streetHelp': 'Example: 33 Le Duan, ...',
            'co.building': 'Building / Floor',
            'co.buildingHelp': 'Example: ABC Apartment, floor 5',
            'co.city': 'City / Province',
            'co.district': 'District',
            'co.ward': 'Ward',
            'co.postal': 'Postal code',
            'co.country': 'Country',
            'co.payment': 'Payment',
            'co.payMethod': 'Payment method',
            'co.submit': 'Place order',
            'co.orderInfo': 'Order summary',
            'co.subtotal': 'Subtotal',
            'co.shipping': 'Shipping',
            'co.discount': 'Discount',
            'co.voucherLabel': 'Discount code',
            'co.voucherPh': 'Enter code',
            'co.voucherApply': 'Apply',
            'co.voucherRemove': 'Remove discount code',
            'co.total': 'Total',
            'co.emptyItems': 'No items yet.',
            'co.metaSize': 'Size', 'co.metaColor': 'Color', 'co.metaQty': 'Qty', 'co.you': 'you',
            'co.errFirstname': 'Please enter your first name',
            'co.errLastname': 'Please enter your last name',
            'co.errPhoneEmpty': 'Please enter your phone number',
            'co.errPhoneBad': 'Invalid phone number (e.g. 0901234567)',
            'co.errStreet': 'Please enter your house number / street',
            'co.errCity': 'Please select a City / Province',
            'co.errDistrict': 'Please select a District',
            'co.errWard': 'Please select a Ward',
            'co.errPostal': 'Please select a Postal code',
            'co.errPay': 'Please select a payment method',
            'co.adminBlocked': 'Wrong Account — an admin account cannot place orders.',
            'co.vcRate': 'Too many attempts, please wait a minute.',
            'co.vcCheckErr': 'Could not verify the code.',
            'co.vcCheckRetry': 'Could not verify the code, please try again.',
            'co.vcInvalid': 'Invalid discount code',
            'co.vcApplyErr': 'Could not apply the code, please try again.',
            'co.vcOk': 'Valid code · saves {amount}. Press Apply.'
        }
    });

    /* --- invoice.html (inv.*) ----------------------------------------- */
    reg({
        vi: {
            'inv.docTitle': 'Hoá đơn - BREEZE',
            'inv.docTitleN': 'Hoá đơn #{id} - BREEZE',
            'inv.print': 'In hoá đơn',
            'inv.loading': 'Đang tải hoá đơn…',
            'inv.shopAddr': 'Địa chỉ: 1 Nguyễn Huệ, Quận 1, TP.HCM',
            'inv.shopTel': 'ĐT: 0123456789',
            'inv.title': 'Hoá đơn thanh toán',
            'inv.customer': 'Khách hàng:',
            'inv.phone': 'Số điện thoại:',
            'inv.address': 'Địa chỉ:',
            'inv.date': 'Ngày lập HĐ:',
            'inv.orderNo': 'Mã đơn:',
            'inv.colProduct': 'Sản phẩm',
            'inv.colQty': 'SL',
            'inv.colPrice': 'Đơn giá',
            'inv.colTotal': 'Thành tiền',
            'inv.subtotal': 'Tạm tính:',
            'inv.discount': 'Giảm giá:',
            'inv.discountCode': 'Giảm giá ({code}):',
            'inv.total': 'Tổng tiền:',
            'inv.payMethod': 'Hình thức thanh toán:',
            'inv.thanks': 'Cảm ơn quý khách, hẹn gặp lại!',
            'inv.noLines': '(không có dòng hàng)',
            'inv.guest': 'Khách #{id}',
            'inv.needLogin': 'Bạn cần đăng nhập tài khoản quản trị để xem hoá đơn.',
            'inv.badId': 'Thiếu hoặc sai mã đơn trên đường dẫn (?orderId=...).',
            'inv.notFound': 'Không tìm thấy đơn hàng #{id}.',
            'inv.forbidden': 'Tài khoản của bạn không có quyền xem hoá đơn.',
            'inv.loadErr': 'Không tải được hoá đơn. Vui lòng thử lại.',
            'inv.authErr': 'Không khởi tạo được xác thực. Vui lòng tải lại trang.'
        },
        en: {
            'inv.docTitle': 'Invoice - BREEZE',
            'inv.docTitleN': 'Invoice #{id} - BREEZE',
            'inv.print': 'Print invoice',
            'inv.loading': 'Loading invoice…',
            'inv.shopAddr': 'Address: 1 Nguyen Hue, District 1, Ho Chi Minh City',
            'inv.shopTel': 'Tel: 0123456789',
            'inv.title': 'Payment Invoice',
            'inv.customer': 'Customer:',
            'inv.phone': 'Phone:',
            'inv.address': 'Address:',
            'inv.date': 'Invoice date:',
            'inv.orderNo': 'Order no.:',
            'inv.colProduct': 'Product',
            'inv.colQty': 'Qty',
            'inv.colPrice': 'Unit price',
            'inv.colTotal': 'Subtotal',
            'inv.subtotal': 'Subtotal:',
            'inv.discount': 'Discount:',
            'inv.discountCode': 'Discount ({code}):',
            'inv.total': 'Total:',
            'inv.payMethod': 'Payment method:',
            'inv.thanks': 'Thank you, we hope to see you again!',
            'inv.noLines': '(no line items)',
            'inv.guest': 'Customer #{id}',
            'inv.needLogin': 'You need to sign in with an admin account to view this invoice.',
            'inv.badId': 'Missing or invalid order id in the URL (?orderId=...).',
            'inv.notFound': 'Order #{id} not found.',
            'inv.forbidden': 'Your account is not allowed to view invoices.',
            'inv.loadErr': 'Could not load the invoice. Please try again.',
            'inv.authErr': 'Could not initialise authentication. Please reload the page.'
        }
    });

    /* --- admin.html + admin.js (adm.*) -------------------------------- */
    reg({
        vi: {
            'adm.docTitle': 'Quản Trị - BREEZE',
            'adm.menuToggle': 'Mở/đóng menu',
            'adm.navAria': 'Điều hướng quản trị',
            'adm.searchPh': 'Tìm mã đơn / khách hàng…',
            'adm.searchAria': 'Tìm đơn theo mã hoặc khách hàng',
            'adm.notif': 'Thông báo',
            // Sidebar
            'adm.dashboard': 'Dashboard', 'adm.products': 'Sản phẩm', 'adm.orders': 'Hoá đơn',
            'adm.statistics': 'Thống kê', 'adm.users': 'Người dùng', 'adm.blacklist': 'Danh sách Đen',
            // Cổng truy cập
            'adm.gateChecking': 'Đang kiểm tra quyền truy cập…',
            'adm.gateLoginTitle': 'Khu vực quản trị',
            'adm.gateLoginMsg': 'Bạn cần đăng nhập bằng tài khoản quản trị để tiếp tục.',
            'adm.gateForbTitle': 'Không có quyền truy cập',
            'adm.gateForbMsg': 'Tài khoản của bạn không có quyền quản trị. Vui lòng liên hệ quản trị viên nếu đây là nhầm lẫn.',
            'adm.backHome': 'Về trang chủ',
            // Dashboard
            'adm.rangeAria': 'Khoảng thời gian',
            'adm.p7': '7 ngày qua', 'adm.p30': '30 ngày qua', 'adm.pMonth': 'Tháng này', 'adm.pYear': 'Năm nay',
            'adm.exportCsv': 'Xuất CSV',
            'adm.kpiRevenue': 'Doanh thu', 'adm.kpiOrders': 'Đơn hàng',
            'adm.kpiCustomers': 'Khách hàng', 'adm.kpiAov': 'Giá trị đơn TB',
            'adm.kpiAovFull': 'Giá trị đơn trung bình',
            'adm.cardRevenue': 'Doanh thu theo ngày',
            'adm.chartAria': 'Biểu đồ doanh thu theo ngày',
            'adm.viewReport': 'Xem báo cáo →', 'adm.viewAll': 'Xem tất cả →',
            'adm.revEmpty': 'Chưa có dữ liệu doanh thu',
            'adm.cardStatus': 'Trạng thái đơn hàng',
            'adm.statusAria': 'Biểu đồ tròn phân bố trạng thái đơn hàng',
            'adm.statusEmpty': 'Chưa có đơn nào trong kỳ',
            'adm.cardTop': 'Sản phẩm bán chạy',
            'adm.cardRecent': 'Đơn hàng gần đây',
            'adm.trendNoData': 'không có dữ liệu kỳ trước',
            'adm.trendUp': 'tăng', 'adm.trendDown': 'giảm', 'adm.trendFlat': 'không đổi',
            'adm.trendVs': '% so với kỳ trước',
            'adm.csvDate': 'Ngày', 'adm.csvRevenue': 'Doanh thu (VND)', 'adm.csvFile': 'doanh-thu',
            'adm.donutOrders': 'đơn',
            'adm.topEmpty': 'Chưa có dữ liệu bán hàng trong kỳ này',
            'adm.topErr': 'Không tải được dữ liệu.',
            'adm.topSold': 'đã bán',
            // Bảng
            'adm.thOrderId': 'Mã đơn', 'adm.thCustomer': 'Khách hàng', 'adm.thDate': 'Ngày',
            'adm.thOrderDate': 'Ngày đặt', 'adm.thStatus': 'Trạng thái', 'adm.thTotal': 'Tổng tiền',
            'adm.thPayMethod': 'Hình thức thanh toán',
            'adm.thImage': 'Ảnh', 'adm.thNameVi': 'Tên (VI)', 'adm.thCategory': 'Danh mục',
            'adm.thPrice': 'Giá', 'adm.thSale': 'Sale', 'adm.thStock': 'Kho',
            'adm.thStockState': 'Tồn kho', 'adm.thActions': 'Thao tác',
            'adm.thProdName': 'Tên sản phẩm', 'adm.thQty': 'Số lượng', 'adm.thRevenue': 'Doanh thu',
            'adm.thEmail': 'Email', 'adm.thName': 'Tên', 'adm.thRole': 'Vai trò',
            'adm.thCreated': 'Ngày tạo', 'adm.thLastLogin': 'Đăng nhập gần nhất', 'adm.thBl': 'Blacklist',
            'adm.thUnitPrice': 'Đơn giá', 'adm.thQtyShort': 'SL', 'adm.thLineTotal': 'Thành tiền',
            // Sản phẩm
            'adm.stockFilterAria': 'Lọc theo tồn kho',
            'adm.fAll': 'Tất cả', 'adm.fLow': 'Sắp hết', 'adm.fOut': 'Hết hàng', 'adm.fOk': 'Còn hàng',
            'adm.addProd': 'Thêm sản phẩm',
            'adm.errLoadProd': 'Không tải được sản phẩm.',
            'adm.pillOn': 'Đang bán', 'adm.pillOff': 'Đã ẩn',
            'adm.emptyLow': 'Không có sản phẩm nào sắp hết',
            'adm.emptyOut': 'Không có sản phẩm nào hết hàng',
            'adm.emptyProd': 'Chưa có sản phẩm nào',
            'adm.modalAdd': 'Thêm sản phẩm', 'adm.modalEdit': 'Sửa sản phẩm #{id}',
            'adm.fSlug': 'Slug', 'adm.slugPh': 'vd: ao-thun-gg-2024',
            'adm.slugHint': 'Chỉ chữ/số và . _ - (không khoảng trắng). Duy nhất.',
            'adm.fCategory': 'Danh mục',
            'adm.fNameVi': 'Tên (Tiếng Việt)', 'adm.fNameEn': 'Tên (English)',
            'adm.fPrice': 'Giá (VND)', 'adm.fSale': 'Giá sale (VND)',
            'adm.salePh': 'để trống nếu không giảm', 'adm.fStock': 'Tồn kho',
            'adm.fImages': 'Ảnh (mỗi dòng 1 đường dẫn)',
            'adm.imgHint': 'Đường dẫn tương đối trong client/, mỗi ảnh 1 dòng (hoặc ngăn bằng dấu phẩy).',
            'adm.fDescVi': 'Mô tả (Tiếng Việt)', 'adm.fDescEn': 'Mô tả (English)',
            'adm.fActive': 'Đang bán (hiển thị trên shop)',
            'adm.toastProdAdded': 'Đã thêm sản phẩm', 'adm.toastProdUpdated': 'Đã cập nhật sản phẩm',
            'adm.errCode': 'Lỗi {code}',
            'adm.confirmDelProd': 'Xóa sản phẩm "{name}"?\n(Nếu đã có đơn hàng, sản phẩm sẽ được ẩn thay vì xóa hẳn.)',
            'adm.delFail': 'Xóa thất bại',
            'adm.softDeleted': 'Sản phẩm đã có đơn — đã ẩn (soft delete)',
            'adm.prodDeleted': 'Đã xóa sản phẩm',
            // Hoá đơn
            'adm.statusFilterAria': 'Lọc theo trạng thái', 'adm.allStatus': 'Tất cả trạng thái',
            'adm.errLoadOrders': 'Không tải được đơn hàng.',
            'adm.voucherLine': 'Mã giảm giá:', 'adm.discountWord': 'Giảm',
            'adm.btnInvoice': 'Xuất hoá đơn', 'adm.btnDetail': 'Chi tiết',
            'adm.noLines': '(không có dòng hàng)',
            'adm.emptyOrderSearch': 'Không tìm thấy đơn phù hợp.',
            'adm.emptyOrders': 'Chưa có đơn hàng nào.',
            'adm.pgPrev': '← Trước', 'adm.pgNext': 'Sau →', 'adm.pgPage': 'Trang',
            'adm.confirmDelOrder': 'Xoá hẳn đơn hàng?',
            'adm.delOrderFail': 'Xoá thất bại', 'adm.orderDeleted': 'Đã xoá đơn #{id}',
            'adm.updFail': 'Cập nhật thất bại', 'adm.statusUpdated': 'Đã cập nhật trạng thái đơn #{id}',
            // Thống kê
            'adm.statTitle': 'Thống kê sản phẩm bán được',
            'adm.totalRevenue': 'Tổng doanh thu',
            'adm.errLoadStats': 'Không tải được thống kê.',
            'adm.emptyStats': 'Không có dữ liệu trong khoảng thời gian này',
            // Người dùng
            'adm.errLoadUsers': 'Không tải được người dùng.',
            'adm.roleAdmin': 'Admin', 'adm.roleCustomer': 'Khách hàng',
            'adm.emptyUsers': 'Chưa có người dùng nào.',
            'adm.inBlacklist': 'Trong danh sách đen', 'adm.addBlacklist': 'Thêm vào Blacklist',
            'adm.confirmBl': 'Đưa tài khoản này vào danh sách đen? Họ sẽ không thể thêm giỏ hàng / thanh toán cho tới khi được gỡ.',
            'adm.blFail': 'Thêm thất bại', 'adm.blOk': 'Đã đưa vào danh sách đen',
            // Danh sách đen
            'adm.errLoadBl': 'Không tải được danh sách đen.',
            'adm.emptyBl': 'Danh sách đen đang trống.',
            'adm.noCancelled': 'Chưa có đơn huỷ', 'adm.btnRelease': 'Gỡ Tài Khoản',
            'adm.confirmRelease': 'Gỡ tài khoản này khỏi danh sách đen? Khách sẽ được thêm giỏ hàng / thanh toán trở lại.',
            'adm.relFail': 'Gỡ thất bại', 'adm.relOk': 'Đã gỡ tài khoản khỏi danh sách đen',
            'adm.authNotReady': 'AuthHelper chưa sẵn sàng'
        },
        en: {
            'adm.docTitle': 'Admin - BREEZE',
            'adm.menuToggle': 'Open/close menu',
            'adm.navAria': 'Admin navigation',
            'adm.searchPh': 'Search order id / customer…',
            'adm.searchAria': 'Search orders by id or customer',
            'adm.notif': 'Notifications',
            'adm.dashboard': 'Dashboard', 'adm.products': 'Products', 'adm.orders': 'Invoices',
            'adm.statistics': 'Statistics', 'adm.users': 'Users', 'adm.blacklist': 'Blacklist',
            'adm.gateChecking': 'Checking access rights…',
            'adm.gateLoginTitle': 'Admin area',
            'adm.gateLoginMsg': 'You need to sign in with an admin account to continue.',
            'adm.gateForbTitle': 'Access denied',
            'adm.gateForbMsg': 'Your account does not have admin rights. Please contact an administrator if this is a mistake.',
            'adm.backHome': 'Back to home',
            'adm.rangeAria': 'Date range',
            'adm.p7': 'Last 7 days', 'adm.p30': 'Last 30 days', 'adm.pMonth': 'This month', 'adm.pYear': 'This year',
            'adm.exportCsv': 'Export CSV',
            'adm.kpiRevenue': 'Revenue', 'adm.kpiOrders': 'Orders',
            'adm.kpiCustomers': 'Customers', 'adm.kpiAov': 'Avg. order value',
            'adm.kpiAovFull': 'Average order value',
            'adm.cardRevenue': 'Daily revenue',
            'adm.chartAria': 'Daily revenue chart',
            'adm.viewReport': 'View report →', 'adm.viewAll': 'View all →',
            'adm.revEmpty': 'No revenue data yet',
            'adm.cardStatus': 'Order status',
            'adm.statusAria': 'Donut chart of order status distribution',
            'adm.statusEmpty': 'No orders in this period',
            'adm.cardTop': 'Best sellers',
            'adm.cardRecent': 'Recent orders',
            'adm.trendNoData': 'no data for the previous period',
            'adm.trendUp': 'up', 'adm.trendDown': 'down', 'adm.trendFlat': 'unchanged',
            'adm.trendVs': '% vs previous period',
            'adm.csvDate': 'Date', 'adm.csvRevenue': 'Revenue (VND)', 'adm.csvFile': 'revenue',
            'adm.donutOrders': 'orders',
            'adm.topEmpty': 'No sales data in this period',
            'adm.topErr': 'Could not load data.',
            'adm.topSold': 'sold',
            'adm.thOrderId': 'Order ID', 'adm.thCustomer': 'Customer', 'adm.thDate': 'Date',
            'adm.thOrderDate': 'Order date', 'adm.thStatus': 'Status', 'adm.thTotal': 'Total',
            'adm.thPayMethod': 'Payment method',
            'adm.thImage': 'Image', 'adm.thNameVi': 'Name (VI)', 'adm.thCategory': 'Category',
            'adm.thPrice': 'Price', 'adm.thSale': 'Sale', 'adm.thStock': 'Stock',
            'adm.thStockState': 'Inventory', 'adm.thActions': 'Actions',
            'adm.thProdName': 'Product name', 'adm.thQty': 'Quantity', 'adm.thRevenue': 'Revenue',
            'adm.thEmail': 'Email', 'adm.thName': 'Name', 'adm.thRole': 'Role',
            'adm.thCreated': 'Created', 'adm.thLastLogin': 'Last sign-in', 'adm.thBl': 'Blacklist',
            'adm.thUnitPrice': 'Unit price', 'adm.thQtyShort': 'Qty', 'adm.thLineTotal': 'Subtotal',
            'adm.stockFilterAria': 'Filter by inventory',
            'adm.fAll': 'All', 'adm.fLow': 'Low stock', 'adm.fOut': 'Out of stock', 'adm.fOk': 'In stock',
            'adm.addProd': 'Add product',
            'adm.errLoadProd': 'Could not load products.',
            'adm.pillOn': 'On sale', 'adm.pillOff': 'Hidden',
            'adm.emptyLow': 'No products are low on stock',
            'adm.emptyOut': 'No products are out of stock',
            'adm.emptyProd': 'No products yet',
            'adm.modalAdd': 'Add product', 'adm.modalEdit': 'Edit product #{id}',
            'adm.fSlug': 'Slug', 'adm.slugPh': 'e.g. ao-thun-gg-2024',
            'adm.slugHint': 'Letters/digits and . _ - only (no spaces). Must be unique.',
            'adm.fCategory': 'Category',
            'adm.fNameVi': 'Name (Vietnamese)', 'adm.fNameEn': 'Name (English)',
            'adm.fPrice': 'Price (VND)', 'adm.fSale': 'Sale price (VND)',
            'adm.salePh': 'leave empty for no discount', 'adm.fStock': 'Stock',
            'adm.fImages': 'Images (one path per line)',
            'adm.imgHint': 'Paths relative to client/, one image per line (or comma separated).',
            'adm.fDescVi': 'Description (Vietnamese)', 'adm.fDescEn': 'Description (English)',
            'adm.fActive': 'On sale (visible in the shop)',
            'adm.toastProdAdded': 'Product added', 'adm.toastProdUpdated': 'Product updated',
            'adm.errCode': 'Error {code}',
            'adm.confirmDelProd': 'Delete product "{name}"?\n(If it already has orders it will be hidden instead of deleted.)',
            'adm.delFail': 'Delete failed',
            'adm.softDeleted': 'Product has orders — hidden instead (soft delete)',
            'adm.prodDeleted': 'Product deleted',
            'adm.statusFilterAria': 'Filter by status', 'adm.allStatus': 'All statuses',
            'adm.errLoadOrders': 'Could not load orders.',
            'adm.voucherLine': 'Discount code:', 'adm.discountWord': 'Saved',
            'adm.btnInvoice': 'Print invoice', 'adm.btnDetail': 'Details',
            'adm.noLines': '(no line items)',
            'adm.emptyOrderSearch': 'No matching orders found.',
            'adm.emptyOrders': 'No orders yet.',
            'adm.pgPrev': '← Prev', 'adm.pgNext': 'Next →', 'adm.pgPage': 'Page',
            'adm.confirmDelOrder': 'Permanently delete this order?',
            'adm.delOrderFail': 'Delete failed', 'adm.orderDeleted': 'Order #{id} deleted',
            'adm.updFail': 'Update failed', 'adm.statusUpdated': 'Status updated for order #{id}',
            'adm.statTitle': 'Product sales statistics',
            'adm.totalRevenue': 'Total revenue',
            'adm.errLoadStats': 'Could not load statistics.',
            'adm.emptyStats': 'No data in this period',
            'adm.errLoadUsers': 'Could not load users.',
            'adm.roleAdmin': 'Admin', 'adm.roleCustomer': 'Customer',
            'adm.emptyUsers': 'No users yet.',
            'adm.inBlacklist': 'Blacklisted', 'adm.addBlacklist': 'Add to blacklist',
            'adm.confirmBl': 'Blacklist this account? They will not be able to add to cart or check out until released.',
            'adm.blFail': 'Failed to add', 'adm.blOk': 'Account blacklisted',
            'adm.errLoadBl': 'Could not load the blacklist.',
            'adm.emptyBl': 'The blacklist is empty.',
            'adm.noCancelled': 'No cancelled orders', 'adm.btnRelease': 'Release account',
            'adm.confirmRelease': 'Release this account from the blacklist? They will be able to add to cart and check out again.',
            'adm.relFail': 'Release failed', 'adm.relOk': 'Account released from the blacklist',
            'adm.authNotReady': 'AuthHelper is not ready'
        }
    });

    /* --- profile.html + payment-methods.js (pf.*) --------------------- */
    reg({
        vi: {
            'pf.docTitle': 'Cài Đặt Tài Khoản - BREEZE',
            'pf.title': 'Cài Đặt Tài Khoản',
            'pf.needLogin': 'Vui lòng đăng nhập để xem cài đặt tài khoản.',
            'pf.navAria': 'Điều hướng cài đặt tài khoản',
            // Sidebar
            'pf.navAccount': 'Chi tiết tài khoản',
            'pf.navAddresses': 'Địa chỉ giao hàng',
            'pf.navPayments': 'Phương thức thanh toán',
            'pf.navTheme': 'Giao diện',
            'pf.navPrivacy': 'Quyền riêng tư',
            // Chi tiết tài khoản
            'pf.acctInfo': 'Thông tin tài khoản',
            'pf.fullname': 'Họ tên',
            'pf.password': 'Mật khẩu',
            'pf.change': 'Đổi',
            'pf.createdAt': 'Ngày tạo tài khoản',
            'pf.lastLogin': 'Đăng nhập gần nhất',
            'pf.personalInfo': 'Thông tin cá nhân',
            'pf.phone': 'Số điện thoại',
            'pf.notSet': 'Chưa cập nhật',
            'pf.dob': 'Ngày sinh',
            'pf.gender': 'Giới tính',
            'pf.genderNone': 'Chưa chọn',
            'pf.genderMale': 'Nam',
            'pf.genderFemale': 'Nữ',
            'pf.genderOther': 'Khác',
            'pf.country': 'Quốc gia / Khu vực',
            'pf.countryNone': '— Chọn quốc gia —',
            'pf.cVN': 'Việt Nam', 'pf.cUS': 'Hoa Kỳ', 'pf.cJP': 'Nhật Bản',
            'pf.cKR': 'Hàn Quốc', 'pf.cSG': 'Singapore',
            'pf.saveChanges': 'Lưu thay đổi',
            'pf.saving': 'Đang lưu…',
            'pf.myCart': 'Giỏ hàng của tôi',
            'pf.myOrders': 'Đơn hàng của tôi',
            'pf.continueShopping': '← Tiếp tục mua sắm',
            'pf.errPhone': 'Số điện thoại không hợp lệ',
            'pf.errDob': 'Ngày sinh không hợp lệ',
            'pf.errDobFuture': 'Ngày sinh không thể ở tương lai',
            'pf.savedChanges': 'Đã lưu thay đổi',
            'pf.errSaveChanges': 'Không lưu được thay đổi',
            'pf.you': 'bạn',
            // Địa chỉ
            'pf.addrDesc': 'Quản lý các địa chỉ giao hàng đã lưu. Địa chỉ mặc định sẽ được điền sẵn khi thanh toán.',
            'pf.addAddress': 'Thêm địa chỉ',
            'pf.addrLoadErr': 'Không tải được danh sách địa chỉ. Vui lòng thử lại.',
            'pf.retry': 'Thử lại',
            'pf.addrEmptyTitle': 'Bạn chưa lưu địa chỉ giao hàng nào',
            'pf.addrEmptyDesc': 'Thêm địa chỉ để việc thanh toán ở lần mua kế tiếp nhanh hơn.',
            'pf.addrListAria': 'Địa chỉ đã lưu',
            'pf.addrLoading': 'Đang tải danh sách địa chỉ…',
            'pf.default': 'Mặc định',
            'pf.setDefault': 'Đặt làm mặc định',
            'pf.editAddress': 'Sửa địa chỉ',
            'pf.saveAddress': 'Lưu địa chỉ',
            'pf.recipient': 'Tên người nhận',
            'pf.line1': 'Địa chỉ (số nhà, tên đường)',
            'pf.line2': 'Căn hộ, toà nhà',
            'pf.optional': '(tuỳ chọn)',
            'pf.ward': 'Phường / Xã',
            'pf.district': 'Quận / Huyện',
            'pf.city': 'Tỉnh / Thành phố',
            'pf.postal': 'Mã bưu chính',
            'pf.setDefaultAddr': 'Đặt làm địa chỉ mặc định',
            'pf.isDefaultHint': 'Đây đang là địa chỉ mặc định của bạn.',
            'pf.errRecipient': 'Vui lòng nhập tên người nhận',
            'pf.errPhoneEmpty': 'Vui lòng nhập số điện thoại',
            'pf.errLine1': 'Vui lòng nhập địa chỉ',
            'pf.errCity': 'Vui lòng nhập tỉnh/thành phố',
            'pf.errPostal': 'Mã bưu chính không hợp lệ',
            'pf.errSaveAddr': 'Không lưu được địa chỉ',
            'pf.addrUpdated': 'Đã cập nhật địa chỉ',
            'pf.addrAdded': 'Đã thêm địa chỉ',
            'pf.defaultSet': 'Đã đặt làm mặc định',
            'pf.errSetDefault': 'Không đặt được mặc định',
            'pf.thisOne': 'này',
            'pf.confirmDelAddr': 'Xóa địa chỉ của "{who}"? Hành động này không thể hoàn tác.',
            'pf.addrDeleted': 'Đã xóa địa chỉ',
            'pf.errDelAddr': 'Không xóa được địa chỉ',
            // Thẻ thanh toán
            'pf.payDesc': 'Quản lý các thẻ đã lưu. Thẻ mặc định sẽ được chọn sẵn khi thanh toán.',
            'pf.addCard': 'Thêm thẻ',
            'pf.payLoadErr': 'Không tải được danh sách thẻ. Vui lòng thử lại.',
            'pf.payEmptyTitle': 'Bạn chưa lưu thẻ nào',
            'pf.payEmptyDesc': 'Thêm thẻ để việc thanh toán ở lần mua kế tiếp nhanh hơn.',
            'pf.payListAria': 'Thẻ đã lưu',
            'pf.payLoading': 'Đang tải danh sách thẻ…',
            'pf.payLoaded': 'Đã tải {n} thẻ.',
            'pf.cardNumber': 'Số thẻ',
            'pf.cardNumberHint': 'Chỉ 4 số cuối được lưu lại. Để trống khi sửa nếu không đổi số thẻ.',
            'pf.cardHolder': 'Tên chủ thẻ',
            'pf.cardExpiry': 'Hết hạn',
            'pf.expMonthAria': 'Tháng hết hạn (01–12)',
            'pf.expYearAria': 'Năm hết hạn',
            'pf.setDefaultPay': 'Đặt làm phương thức mặc định',
            'pf.saveCard': 'Lưu thẻ',
            'pf.editCard': 'Sửa thẻ',
            'pf.expiredOn': 'Đã hết hạn {mmyy}',
            'pf.errExpMonth': 'Tháng hết hạn không hợp lệ (01–12)',
            'pf.errExpYear': 'Năm hết hạn không hợp lệ',
            'pf.errCardExpired': 'Thẻ đã hết hạn',
            'pf.errCardNumber': 'Vui lòng nhập số thẻ',
            'pf.errCardNumberBad': 'Số thẻ không hợp lệ',
            'pf.errCardHolder': 'Vui lòng nhập tên chủ thẻ',
            'pf.errSaveCard': 'Không lưu được thẻ',
            'pf.cardUpdated': 'Đã cập nhật thẻ',
            'pf.cardAdded': 'Đã thêm thẻ',
            'pf.cardDefaultSet': 'Đã đặt thẻ mặc định',
            'pf.errCardDefault': 'Không đặt được mặc định',
            'pf.confirmDelCard': 'Xóa thẻ {label}? Hành động này không thể hoàn tác.',
            'pf.cardDeleted': 'Đã xóa thẻ',
            'pf.errDelCard': 'Không xóa được thẻ',
            'pf.noCards': 'Bạn chưa lưu thẻ nào.',
            // Giao diện
            'pf.themeDesc': 'Chọn giao diện cho Breeze. Lựa chọn được áp dụng trên tất cả các trang.',
            'pf.preview': 'Xem trước',
            'pf.mode': 'Chế độ',
            'pf.themeAria': 'Chọn giao diện',
            'pf.light': 'Sáng',
            'pf.dark': 'Tối',
            'pf.themeNow': 'Giao diện hiện tại: {mode}',
            // Quyền riêng tư
            'pf.avatarAlt': 'Ảnh đại diện của bạn',
            'pf.avatar': 'Ảnh đại diện',
            'pf.avatarDesc': 'Ảnh hiện cạnh biểu tượng tài khoản trên mọi trang.',
            'pf.pickImage': 'Chọn ảnh',
            'pf.pickImageAria': 'Chọn ảnh đại diện từ máy của bạn',
            'pf.publicProfile': 'Hồ sơ công khai',
            'pf.publicProfileDesc': 'Cho phép người dùng khác xem tên hiển thị và đánh giá của bạn.',
            'pf.marketing': 'Email tiếp thị',
            'pf.marketingDesc': 'Nhận email về bộ sưu tập mới, khuyến mãi và ưu đãi riêng.',
            'pf.avatarBadType': 'Ảnh không hợp lệ: chỉ nhận PNG, JPEG hoặc WEBP',
            'pf.avatarBadTypeShort': 'Chỉ nhận ảnh PNG, JPEG hoặc WEBP',
            'pf.avatarTooBig': 'Ảnh vượt quá 2MB, chưa tải lên',
            'pf.avatarTooBigShort': 'Ảnh vượt quá 2MB',
            'pf.avatarUploadErr': 'Không tải được ảnh lên',
            'pf.avatarUpdated': 'Đã cập nhật ảnh đại diện',
            'pf.privacyLoadErr': 'Không tải được tuỳ chọn quyền riêng tư',
            'pf.privacySaveErr': 'Không lưu được tuỳ chọn',
            'pf.privacySavedLive': 'Đã lưu tuỳ chọn quyền riêng tư',
            'pf.saved': 'Đã lưu',
            // Xoá tài khoản
            'pf.deleteAccount': 'Xoá tài khoản',
            'pf.deleteDesc': 'Xoá vĩnh viễn tài khoản và dữ liệu cá nhân của bạn. Hành động này không thể hoàn tác.',
            'pf.deleteIntro': 'Khi xoá tài khoản:',
            'pf.deleteLi1': 'Thông tin cá nhân, địa chỉ và phương thức thanh toán sẽ bị xoá vĩnh viễn.',
            'pf.deleteLi2': 'Lịch sử đơn hàng được giữ lại nhưng ẩn danh (không còn gắn với bạn).',
            'pf.deleteLi3': 'Bạn không thể đăng nhập lại bằng tài khoản này.',
            'pf.deletePwLabel': 'Nhập mật khẩu để xác nhận',
            'pf.deleteConfirm': 'Xoá vĩnh viễn',
            'pf.deleting': 'Đang xoá…',
            'pf.errPwEmpty': 'Vui lòng nhập mật khẩu',
            'pf.errDeleteAcct': 'Không xoá được tài khoản',
            'pf.acctDeleted': 'Tài khoản đã được xoá',
            'pf.netRetry': 'Lỗi kết nối máy chủ, vui lòng thử lại',
            'pf.sessionExpired': 'Phiên đăng nhập đã hết hạn — vui lòng đăng nhập lại.',
            'pf.closeAria': 'Đóng'
        },
        en: {
            'pf.docTitle': 'Account Settings - BREEZE',
            'pf.title': 'Account Settings',
            'pf.needLogin': 'Please sign in to view your account settings.',
            'pf.navAria': 'Account settings navigation',
            'pf.navAccount': 'Account details',
            'pf.navAddresses': 'Shipping addresses',
            'pf.navPayments': 'Payment methods',
            'pf.navTheme': 'Appearance',
            'pf.navPrivacy': 'Privacy',
            'pf.acctInfo': 'Account information',
            'pf.fullname': 'Full name',
            'pf.password': 'Password',
            'pf.change': 'Change',
            'pf.createdAt': 'Account created',
            'pf.lastLogin': 'Last sign-in',
            'pf.personalInfo': 'Personal information',
            'pf.phone': 'Phone number',
            'pf.notSet': 'Not set',
            'pf.dob': 'Date of birth',
            'pf.gender': 'Gender',
            'pf.genderNone': 'Not selected',
            'pf.genderMale': 'Male',
            'pf.genderFemale': 'Female',
            'pf.genderOther': 'Other',
            'pf.country': 'Country / Region',
            'pf.countryNone': '— Select a country —',
            'pf.cVN': 'Vietnam', 'pf.cUS': 'United States', 'pf.cJP': 'Japan',
            'pf.cKR': 'South Korea', 'pf.cSG': 'Singapore',
            'pf.saveChanges': 'Save changes',
            'pf.saving': 'Saving…',
            'pf.myCart': 'My cart',
            'pf.myOrders': 'My orders',
            'pf.continueShopping': '← Continue shopping',
            'pf.errPhone': 'Invalid phone number',
            'pf.errDob': 'Invalid date of birth',
            'pf.errDobFuture': 'Date of birth cannot be in the future',
            'pf.savedChanges': 'Changes saved',
            'pf.errSaveChanges': 'Could not save your changes',
            'pf.you': 'you',
            'pf.addrDesc': 'Manage your saved shipping addresses. The default one is pre-filled at checkout.',
            'pf.addAddress': 'Add address',
            'pf.addrLoadErr': 'Could not load your addresses. Please try again.',
            'pf.retry': 'Try again',
            'pf.addrEmptyTitle': 'You have no saved shipping addresses',
            'pf.addrEmptyDesc': 'Add an address to make your next checkout faster.',
            'pf.addrListAria': 'Saved addresses',
            'pf.addrLoading': 'Loading addresses…',
            'pf.default': 'Default',
            'pf.setDefault': 'Set as default',
            'pf.editAddress': 'Edit address',
            'pf.saveAddress': 'Save address',
            'pf.recipient': 'Recipient name',
            'pf.line1': 'Address (house number, street)',
            'pf.line2': 'Apartment, building',
            'pf.optional': '(optional)',
            'pf.ward': 'Ward',
            'pf.district': 'District',
            'pf.city': 'Province / City',
            'pf.postal': 'Postal code',
            'pf.setDefaultAddr': 'Set as default address',
            'pf.isDefaultHint': 'This is currently your default address.',
            'pf.errRecipient': 'Please enter the recipient name',
            'pf.errPhoneEmpty': 'Please enter a phone number',
            'pf.errLine1': 'Please enter an address',
            'pf.errCity': 'Please enter a province / city',
            'pf.errPostal': 'Invalid postal code',
            'pf.errSaveAddr': 'Could not save the address',
            'pf.addrUpdated': 'Address updated',
            'pf.addrAdded': 'Address added',
            'pf.defaultSet': 'Set as default',
            'pf.errSetDefault': 'Could not set the default',
            'pf.thisOne': 'this',
            'pf.confirmDelAddr': 'Delete the address for "{who}"? This cannot be undone.',
            'pf.addrDeleted': 'Address deleted',
            'pf.errDelAddr': 'Could not delete the address',
            'pf.payDesc': 'Manage your saved cards. The default one is pre-selected at checkout.',
            'pf.addCard': 'Add card',
            'pf.payLoadErr': 'Could not load your cards. Please try again.',
            'pf.payEmptyTitle': 'You have no saved cards',
            'pf.payEmptyDesc': 'Add a card to make your next checkout faster.',
            'pf.payListAria': 'Saved cards',
            'pf.payLoading': 'Loading cards…',
            'pf.payLoaded': 'Loaded {n} card(s).',
            'pf.cardNumber': 'Card number',
            'pf.cardNumberHint': 'Only the last 4 digits are stored. Leave empty when editing to keep the number.',
            'pf.cardHolder': 'Cardholder name',
            'pf.cardExpiry': 'Expires',
            'pf.expMonthAria': 'Expiry month (01–12)',
            'pf.expYearAria': 'Expiry year',
            'pf.setDefaultPay': 'Set as default payment method',
            'pf.saveCard': 'Save card',
            'pf.editCard': 'Edit card',
            'pf.expiredOn': 'Expired {mmyy}',
            'pf.errExpMonth': 'Invalid expiry month (01–12)',
            'pf.errExpYear': 'Invalid expiry year',
            'pf.errCardExpired': 'This card has expired',
            'pf.errCardNumber': 'Please enter the card number',
            'pf.errCardNumberBad': 'Invalid card number',
            'pf.errCardHolder': 'Please enter the cardholder name',
            'pf.errSaveCard': 'Could not save the card',
            'pf.cardUpdated': 'Card updated',
            'pf.cardAdded': 'Card added',
            'pf.cardDefaultSet': 'Default card set',
            'pf.errCardDefault': 'Could not set the default',
            'pf.confirmDelCard': 'Delete card {label}? This cannot be undone.',
            'pf.cardDeleted': 'Card deleted',
            'pf.errDelCard': 'Could not delete the card',
            'pf.noCards': 'You have no saved cards.',
            'pf.themeDesc': 'Choose an appearance for Breeze. It applies across every page.',
            'pf.preview': 'Preview',
            'pf.mode': 'Mode',
            'pf.themeAria': 'Choose appearance',
            'pf.light': 'Light',
            'pf.dark': 'Dark',
            'pf.themeNow': 'Current appearance: {mode}',
            'pf.avatarAlt': 'Your profile picture',
            'pf.avatar': 'Profile picture',
            'pf.avatarDesc': 'Shown next to the account icon on every page.',
            'pf.pickImage': 'Choose image',
            'pf.pickImageAria': 'Choose a profile picture from your device',
            'pf.publicProfile': 'Public profile',
            'pf.publicProfileDesc': 'Let other users see your display name and reviews.',
            'pf.marketing': 'Marketing emails',
            'pf.marketingDesc': 'Receive emails about new collections, sales and exclusive offers.',
            'pf.avatarBadType': 'Invalid image: only PNG, JPEG or WEBP are accepted',
            'pf.avatarBadTypeShort': 'Only PNG, JPEG or WEBP images are accepted',
            'pf.avatarTooBig': 'Image is larger than 2MB, not uploaded',
            'pf.avatarTooBigShort': 'Image is larger than 2MB',
            'pf.avatarUploadErr': 'Could not upload the image',
            'pf.avatarUpdated': 'Profile picture updated',
            'pf.privacyLoadErr': 'Could not load your privacy preferences',
            'pf.privacySaveErr': 'Could not save your preference',
            'pf.privacySavedLive': 'Privacy preference saved',
            'pf.saved': 'Saved',
            'pf.deleteAccount': 'Delete account',
            'pf.deleteDesc': 'Permanently delete your account and personal data. This cannot be undone.',
            'pf.deleteIntro': 'When you delete your account:',
            'pf.deleteLi1': 'Personal details, addresses and payment methods are permanently deleted.',
            'pf.deleteLi2': 'Order history is kept but anonymised (no longer linked to you).',
            'pf.deleteLi3': 'You will not be able to sign in with this account again.',
            'pf.deletePwLabel': 'Enter your password to confirm',
            'pf.deleteConfirm': 'Delete permanently',
            'pf.deleting': 'Deleting…',
            'pf.errPwEmpty': 'Please enter your password',
            'pf.errDeleteAcct': 'Could not delete the account',
            'pf.acctDeleted': 'Your account has been deleted',
            'pf.netRetry': 'Server connection error, please try again',
            'pf.sessionExpired': 'Your session has expired — please sign in again.',
            'pf.closeAria': 'Close'
        }
    });

    /* --- login / signup / forgot-password (au.*) ---------------------- */
    reg({
        vi: {
            'au.loginDocTitle': 'Đăng Nhập - BREEZE',
            'au.signupDocTitle': 'Tạo Tài Khoản - BREEZE',
            'au.forgotDocTitle': 'Quên Mật Khẩu - BREEZE',
            'au.tabSignin': 'Đăng nhập',
            'au.tabSignup': 'Tạo tài khoản',
            'au.phEmail': '* ĐỊA CHỈ EMAIL',
            'au.phPassword': '* MẬT KHẨU',
            'au.phPassword6': '* MẬT KHẨU (ít nhất 6 ký tự)',
            'au.phConfirm': '* XÁC NHẬN MẬT KHẨU',
            'au.phFullname': '* HỌ VÀ TÊN',
            'au.forgot': 'Quên mật khẩu?',
            'au.required': '* Bắt buộc',
            'au.remember': 'Ghi nhớ đăng nhập',
            'au.details': 'Chi tiết',
            'au.btnSignin': 'ĐĂNG NHẬP',
            'au.btnSignup': 'TẠO TÀI KHOẢN',
            'au.or': 'HOẶC',
            'au.forgotTitle': 'Bạn đã là thành viên Breeze Club tại cửa hàng?',
            'au.forgotDesc': 'Vui lòng nhập địa chỉ email của bạn.',
            'au.btnReset': 'GỬI LIÊN KẾT ĐẶT LẠI',
            'au.backSignin': '← Quay lại đăng nhập',
            // Thông báo (js/auth.js)
            'au.errFillAll': 'Vui lòng nhập đầy đủ thông tin.',
            'au.errConfirm': 'Mật khẩu xác nhận không khớp.',
            'au.errShortPw': 'Mật khẩu phải ít nhất 6 ký tự.',
            'au.signupOk': 'Đăng ký thành công! Đang chuyển trang...',
            'au.errNeedEmailPw': 'Vui lòng nhập email và mật khẩu.',
            'au.errBadAccount': 'Tài khoản không hợp lệ.',
            'au.notLoggedIn': 'Bạn chưa đăng nhập tài khoản',
            'au.eInUse': 'Email này đã được sử dụng.',
            'au.eBadEmail': 'Email không hợp lệ.',
            'au.eWeakPw': 'Mật khẩu phải ít nhất 6 ký tự.',
            'au.eNoUser': 'Tài khoản không tồn tại.',
            'au.eWrongPw': 'Mật khẩu không đúng.',
            'au.eBadCred': 'Email hoặc mật khẩu không chính xác.',
            'au.eTooMany': 'Quá nhiều lần thử. Vui lòng thử lại sau.'
        },
        en: {
            'au.loginDocTitle': 'Sign In - BREEZE',
            'au.signupDocTitle': 'Create Account - BREEZE',
            'au.forgotDocTitle': 'Forgot Password - BREEZE',
            'au.tabSignin': 'Sign in',
            'au.tabSignup': 'Create Account',
            'au.phEmail': '* EMAIL ADDRESS',
            'au.phPassword': '* PASSWORD',
            'au.phPassword6': '* PASSWORD (At least 6 characters)',
            'au.phConfirm': '* CONFIRM PASSWORD',
            'au.phFullname': '* FULL NAME',
            'au.forgot': 'Forgot Password?',
            'au.required': '* Required',
            'au.remember': 'Remember Me',
            'au.details': 'Details',
            'au.btnSignin': 'SIGN IN',
            'au.btnSignup': 'CREATE ACCOUNT',
            'au.or': 'OR',
            'au.forgotTitle': 'Are you already a Breeze Club member in store?',
            'au.forgotDesc': 'Please enter your email address.',
            'au.btnReset': 'SEND RESET LINK',
            'au.backSignin': '← Back to Sign in',
            'au.errFillAll': 'Please fill in every field.',
            'au.errConfirm': 'Passwords do not match.',
            'au.errShortPw': 'Password must be at least 6 characters.',
            'au.signupOk': 'Account created! Redirecting...',
            'au.errNeedEmailPw': 'Please enter your email and password.',
            'au.errBadAccount': 'Invalid account.',
            'au.notLoggedIn': 'You are not signed in',
            'au.eInUse': 'This email is already in use.',
            'au.eBadEmail': 'Invalid email address.',
            'au.eWeakPw': 'Password must be at least 6 characters.',
            'au.eNoUser': 'Account does not exist.',
            'au.eWrongPw': 'Incorrect password.',
            'au.eBadCred': 'Incorrect email or password.',
            'au.eTooMany': 'Too many attempts. Please try again later.'
        }
    });

    /* --- index.html (ix.*), search.html (sr.*), product.html (pd.*) --- */
    reg({
        vi: {
            'ix.docTitle': 'BREEZE',
            'ix.eyebrow': 'Bộ sưu tập 2026',
            'ix.shopNow': 'Mua ngay',
            'ix.scroll': 'Cuộn xuống',
            'ix.newArrivals': 'Hàng Mới Về',
            'ix.searchPh': 'Tìm sản phẩm...',
            'ix.searchAria': 'Tìm sản phẩm',
            'ix.searchBtnAria': 'Tìm kiếm',

            'sr.docTitle': 'Kết quả tìm kiếm - BREEZE',
            'sr.noResult': 'Không tìm thấy sản phẩm nào phù hợp với từ khóa.',
            'sr.backHome': 'Quay về trang chủ',
            'sr.enterKeyword': 'Nhập từ khoá để tìm sản phẩm.',
            'sr.searching': 'Đang tìm...',
            'sr.resultLine': 'Tìm kiếm: <span>"{q}"</span> — {n} kết quả',
            'sr.loadErr': 'Không tải được sản phẩm ({msg}). Kiểm tra server đã chạy chưa?',
            'sr.soldOut': 'Hết hàng',

            'pd.docTitle': 'Sản phẩm - BREEZE',
            'pd.fallbackName': 'Sản phẩm',
            'pd.chooseSize': 'Chọn size',
            'pd.sizeGuide': 'Bảng size',
            'pd.addToCart': 'Thêm vào giỏ',
            'pd.youMayLike': 'Có thể bạn thích',
            'pd.sizeSub': 'Số đo tham khảo (cm). Chọn size lớn hơn nếu bạn thích form rộng.',
            'pd.thSize': 'Size', 'pd.thChest': 'Ngực', 'pd.thLength': 'Dài áo', 'pd.thShoulder': 'Vai',
            'pd.notFound': 'Không tìm thấy sản phẩm'
        },
        en: {
            'ix.docTitle': 'BREEZE',
            'ix.eyebrow': '2026 Collection',
            'ix.shopNow': 'Shop Now',
            'ix.scroll': 'Scroll',
            'ix.newArrivals': 'New Arrivals',
            'ix.searchPh': 'Search products...',
            'ix.searchAria': 'Search products',
            'ix.searchBtnAria': 'Search',

            'sr.docTitle': 'Search results - BREEZE',
            'sr.noResult': 'No products matched your search.',
            'sr.backHome': 'Back to home',
            'sr.enterKeyword': 'Enter a keyword to search for products.',
            'sr.searching': 'Searching...',
            'sr.resultLine': 'Search: <span>"{q}"</span> — {n} result(s)',
            'sr.loadErr': 'Could not load products ({msg}). Is the server running?',
            'sr.soldOut': 'Sold out',

            'pd.docTitle': 'Product - BREEZE',
            'pd.fallbackName': 'Product',
            'pd.chooseSize': 'Choose size',
            'pd.sizeGuide': 'Size guide',
            'pd.addToCart': 'Add to cart',
            'pd.youMayLike': 'You may also like',
            'pd.sizeSub': 'Reference measurements (cm). Size up for a looser fit.',
            'pd.thSize': 'Size', 'pd.thChest': 'Chest', 'pd.thLength': 'Length', 'pd.thShoulder': 'Shoulder',
            'pd.notFound': 'Product not found'
        }
    });

    /* --- menu tài khoản + giỏ hàng dùng chung (acc.*) ------------------ */
    reg({
        vi: {
            'acc.helloName': 'Xin chào, {name}',
            'acc.you': 'bạn',
            'acc.profile': 'Thông tin tài khoản',
            'acc.cart': 'Giỏ hàng',
            'acc.orders': 'Đơn hàng',
            'acc.signedOut': 'Đã đăng xuất',
            'acc.avatarAlt': 'Ảnh đại diện',
            'acc.cartEmpty': 'Giỏ hàng của bạn đang trống.',
            'acc.adminBlocked': 'Tài Khoản Không Đúng — tài khoản admin không thể thanh toán đơn hàng.',
            'acc.blocked': 'Không Thể Thực Hiện Hành Động',
            'acc.errAddCart': 'Không thêm được vào giỏ',
            'acc.errUpdCart': 'Không cập nhật được giỏ',
            'acc.product': 'Sản phẩm'
        },
        en: {
            'acc.helloName': 'Hello, {name}',
            'acc.you': 'there',
            'acc.profile': 'Account details',
            'acc.cart': 'Cart',
            'acc.orders': 'Orders',
            'acc.signedOut': 'Signed out',
            'acc.avatarAlt': 'Profile picture',
            'acc.cartEmpty': 'Your cart is empty.',
            'acc.adminBlocked': 'Wrong Account — an admin account cannot place orders.',
            'acc.blocked': 'Action Not Allowed',
            'acc.errAddCart': 'Could not add to cart',
            'acc.errUpdCart': 'Could not update the cart',
            'acc.product': 'Product'
        }
    });

    /* --- Tiêu đề tab trình duyệt (title.*) ----------------------------- */
    reg({
        vi: {
            'title.index': 'BREEZE - Thời trang',
            'title.cart': 'Giỏ Hàng - BREEZE',
            'title.orders': 'Đơn Hàng Của Tôi - BREEZE',
            'title.privacy': 'Chính sách bảo mật - BREEZE',
            'title.returns': 'Chính sách đổi trả - BREEZE',
            'title.shipping': 'Chính sách giao hàng - BREEZE',
            'title.shirt': 'Áo - BREEZE',
            'title.pants': 'Quần - BREEZE',
            'title.shoes': 'Giày & Dép - BREEZE',
            'title.accessories': 'Phụ Kiện - BREEZE',
            'title.handbags': 'Túi Xách - BREEZE',
            'title.sale': 'Khuyến Mãi - BREEZE'
        },
        en: {
            'title.index': 'BREEZE - Fashion',
            'title.cart': 'Shopping Cart - BREEZE',
            'title.orders': 'My Orders - BREEZE',
            'title.privacy': 'Privacy Policy - BREEZE',
            'title.returns': 'Return Policy - BREEZE',
            'title.shipping': 'Shipping Policy - BREEZE',
            'title.shirt': 'Shirt - BREEZE',
            'title.pants': 'Pants - BREEZE',
            'title.shoes': 'Shoes & Sandals - BREEZE',
            'title.accessories': 'Accessories - BREEZE',
            'title.handbags': 'Handbags - BREEZE',
            'title.sale': 'Sale - BREEZE'
        }
    });

    /* --- checkout: thông báo sau khi đặt hàng (co.msg*) ---------------- */
    reg({
        vi: {
            'co.msgFixFields': 'Vui lòng kiểm tra lại các trường được đánh dấu.',
            'co.msgSessionExpired': 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
            'co.msgOk': 'Đặt hàng thành công! Mã đơn #{id}. Đang chuyển tới trang đơn hàng...',
            'co.msgOkVoucherDropped': 'Mã giảm giá đã hết hiệu lực, đơn hàng được tính theo giá gốc. Mã đơn #{id}. Đang chuyển tới trang đơn hàng...',
            'co.msgEmptyCart': 'Giỏ hàng trống, không thể đặt đơn',
            'co.msgStock': 'Một số sản phẩm không đủ tồn kho',
            'co.msgStockLine': '{name} (còn {stock}, cần {want})',
            'co.msgFailed': 'Không tạo được đơn hàng, vui lòng thử lại.',
            'co.msgNetErr': 'Lỗi kết nối, vui lòng thử lại.'
        },
        en: {
            'co.msgFixFields': 'Please check the highlighted fields.',
            'co.msgSessionExpired': 'Your session has expired, please sign in again.',
            'co.msgOk': 'Order placed! Order #{id}. Redirecting to your orders...',
            'co.msgOkVoucherDropped': 'The discount code is no longer valid, the order was charged at full price. Order #{id}. Redirecting to your orders...',
            'co.msgEmptyCart': 'Your cart is empty, cannot place the order',
            'co.msgStock': 'Some items are out of stock',
            'co.msgStockLine': '{name} ({stock} left, {want} requested)',
            'co.msgFailed': 'Could not place the order, please try again.',
            'co.msgNetErr': 'Connection error, please try again.'
        }
    });

    window.__i18n = {
        current: DEFAULT,
        T: T,                       // giữ nguyên cho filter.js / cart.js / orders.html
        UI: UI,
        /* t('co.total') hoặc t('inv.notFound', { id: 12 }) — {name} được thay thế. */
        t: function (key, params) {
            var d = UI[window.__i18n.current] || UI[DEFAULT] || {};
            var v = d[key];
            if (v == null) return key;
            if (!params) return v;
            return v.replace(/\{(\w+)\}/g, function (m, k) {
                return params[k] == null ? m : params[k];
            });
        },
        /* Cho phép file khác bổ sung khoá (không dùng hiện tại, để mở rộng). */
        extend: function (lang, obj) {
            if (!UI[lang]) UI[lang] = {};
            Object.keys(obj).forEach(function (k) { UI[lang][k] = obj[k]; });
        }
    };

    // Áp từ điển UI lên mọi phần tử có data-i18n*. Chạy trên MỌI trang.
    function applyUI(lang) {
        var d = UI[lang] || UI[DEFAULT] || {};
        var pairs = [
            ['data-i18n', function (el, v) { el.textContent = v; }],
            ['data-i18n-html', function (el, v) { el.innerHTML = v; }],
            ['data-i18n-ph', function (el, v) { el.setAttribute('placeholder', v); }],
            ['data-i18n-title', function (el, v) { el.setAttribute('title', v); }],
            ['data-i18n-aria', function (el, v) { el.setAttribute('aria-label', v); }],
            ['data-i18n-alt', function (el, v) { el.setAttribute('alt', v); }],
            ['data-i18n-value', function (el, v) { el.value = v; }]
        ];
        pairs.forEach(function (p) {
            document.querySelectorAll('[' + p[0] + ']').forEach(function (el) {
                var v = d[el.getAttribute(p[0])];
                if (v != null) p[1](el, v);
            });
        });
        // <option data-i18n> nằm trong <select> vẫn hoạt động qua textContent ở trên.
        var dt = document.body && document.body.getAttribute('data-i18n-doctitle');
        if (dt && d[dt] != null) document.title = d[dt];
        document.documentElement.setAttribute('lang', lang);
    }

    var EXCLUDED = ['index.html', ''];

    function currentPage() {
        var parts = location.pathname.split('/');
        return parts[parts.length - 1] || 'index.html';
    }

    function applyLang(lang) {
        window.__i18n.current = lang;
        updateSwitcherUI(lang);

        // Từ điển data-i18n: áp cho MỌI trang (kể cả trang trong EXCLUDED).
        applyUI(lang);

        var t = T[lang];

        // Nav (áp dụng cho MỌI trang)
        document.querySelectorAll('.menu li a').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === 'index.html') a.textContent = t.nav.home;
            else if (a.classList.contains('mega-trigger')) a.innerHTML = t.nav.cat + ' <span class="mega-arrow">&#9660;</span>';
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
            else if (txt === 'Accessories' || txt === 'Phụ Kiện') el.textContent = t.mega.gold;
            else if (txt === 'Handbags' || txt === 'Túi Xách') el.textContent = t.mega.handbags;
        });

        // Mega links (áp dụng cho MỌI trang)
        document.querySelectorAll('.mega-col ul li a').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === 'sanpham-ao.html') a.textContent = t.megaItems.shirt;
            else if (href === 'sanpham-quan.html') a.textContent = t.megaItems.pants;
            else if (href === 'sanpham-giay.html') a.textContent = t.megaItems.shoes;
            else if (href === 'gold-jewellery.html') a.textContent = t.megaItems.accessory;
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
        });
        var fEl;
        fEl = document.getElementById('footer-help-title'); if (fEl) fEl.textContent = t.footer.helpTitle;
        fEl = document.getElementById('footer-company-title'); if (fEl) fEl.textContent = t.footer.companyTitle;
        fEl = document.getElementById('footer-lang-title'); if (fEl) fEl.textContent = t.footer.langTitle;
        fEl = document.getElementById('footer-country-title'); if (fEl) fEl.textContent = t.footer.countryTitle;
        fEl = document.getElementById('footer-country-name'); if (fEl) fEl.textContent = t.footer.countryName;

        // Các trang exclude: chỉ dịch nav/header/mega-menu + data-i18n, bỏ phần
        // sidebar lọc / bảng giỏ hàng (không tồn tại trên các trang này).
        if (EXCLUDED.indexOf(currentPage()) !== -1) {
            document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } }));
            return;
        }

        // Sidebar title
        document.querySelectorAll('.sidebar-category-title').forEach(function (el) { el.textContent = t.sidebar.title; });

        // Sidebar links
        document.querySelectorAll('.sidebar-links a').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === 'sanpham-ao.html') a.textContent = t.sidebar.men;
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
            'Sản phẩm': t.mega.men, 'Products': t.mega.men,
            'Nam': t.mega.men, 'Men': t.mega.men,
            'Phụ Kiện': t.mega.gold, 'Accessories': t.mega.gold,
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
            if (href === 'sanpham-ao.html') a.textContent = t.megaItems.shirt;
            else if (href === 'sanpham-quan.html') a.textContent = t.megaItems.pants;
            else if (href === 'sanpham-giay.html') a.textContent = t.megaItems.shoes;
            else if (href === 'gold-jewellery.html') a.textContent = t.megaItems.accessory;
            else if (href === 'handbags.html') a.textContent = t.mega.handbags;
            else if (href === 'sale.html') a.textContent = t.mega.sale;
        });

        d.querySelectorAll('.drawer-links li a').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === 'login.html') a.textContent = t.drawer.signin;
            else if (href === 'orders.html') a.textContent = t.drawer.orders;
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
        var host = document.getElementById('lang-switcher-host')
            || document.querySelector('.ph-actions') || document.querySelector('.policy-header') || document.querySelector('header');
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
