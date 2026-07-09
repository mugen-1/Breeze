/* Render sản phẩm động cho các trang danh mục.
   - Đọc slug từ <body data-category="...">.
   - Fetch /api/products?category=<slug>&min=&max=&sort= rồi dựng card ĐÚNG markup cũ
     (.product-item / .product-thumb / .product-name / .product-price / .price-sale)
     để không vỡ CSS sale.css.
   - Nút "Thêm vào giỏ" vẫn dùng addToCart() cũ (cart.js) — chưa đụng API giỏ hàng.
   - i18n: tên hiển thị theo ngôn ngữ hiện tại (name_vi/name_en), cập nhật khi 'langchange'.
   - Bộ lọc giá + sắp xếp nối vào drawer "Lọc & Sắp Xếp" (#fd-drawer do filter.js dựng):
     mỗi thay đổi -> gọi lại API với params (thay cho lọc tĩnh). */
(function () {
  var API_BASE = window.API_BASE || '';
  var listEl = null;
  var category = '';
  var currentProducts = [];

  // ---- helpers ----
  function currentLang() {
    return (window.__i18n && window.__i18n.current) ||
      localStorage.getItem('ql_lang') || 'en';
  }

  function productName(p) {
    if (currentLang() === 'en') return p.name_en || p.name_vi;
    return p.name_vi || p.name_en;
  }

  function formatPrice(n) {
    return Number(n).toLocaleString('vi-VN') + 'đ';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- dựng 1 card (markup khớp trang category cũ) ----
  function cardHTML(p) {
    var imgs = (p.images && p.images.length) ? p.images : ['img/gucci.png'];
    var imgDefault = imgs[0];
    var imgHover = imgs[1] || imgs[0];
    var name = productName(p);
    var nameEsc = esc(name);

    var priceHTML;
    if (p.sale_price != null) {
      priceHTML =
        '<div class="product-price">' +
          '<span class="price-default">' + formatPrice(p.price) + '</span> ' +
          '<span class="price-sale">' + formatPrice(p.sale_price) + '</span>' +
        '</div>';
    } else {
      priceHTML = '<div class="product-price">' + formatPrice(p.price) + '</div>';
    }

    return '' +
      '<li>' +
        '<div class="product-item reveal in" data-id="' + p.id + '">' +
          '<div class="product-top">' +
            '<a href="product.html?id=' + p.id + '" class="product-thumb">' +
              '<img class="thumb-default" src="' + esc(imgDefault) + '" alt="' + nameEsc + '">' +
              '<img class="thumb-hover thumb-fill" src="' + esc(imgHover) + '" alt="' + nameEsc + '">' +
            '</a>' +
          '</div>' +
          '<div class="product-info">' +
            '<a href="product.html?id=' + p.id + '" class="product-name">' + nameEsc + '</a>' +
            priceHTML +
          '</div>' +
        '</div>' +
      '</li>';
  }

  // ---- thông báo rỗng ----
  function emptyMsgEl() {
    var msg = document.getElementById('pr-empty');
    if (!msg) {
      msg = document.createElement('p');
      msg.id = 'pr-empty';
      msg.style.cssText = 'color:#888;text-align:center;padding:48px 0;width:100%;font-size:15px;';
      if (listEl && listEl.parentElement) listEl.parentElement.appendChild(msg);
    }
    return msg;
  }

  function showEmpty(on) {
    var msg = emptyMsgEl();
    var t = window.__i18n && window.__i18n.T[currentLang()] && window.__i18n.T[currentLang()].fd;
    msg.textContent = (t && t.noProduct) || 'Không tìm thấy sản phẩm';
    msg.style.display = on ? 'block' : 'none';
  }

  // ---- nhãn nút thêm giỏ theo ngôn ngữ ----
  function applyCartLabels() {
    var ct = window.__i18n && window.__i18n.T[currentLang()] && window.__i18n.T[currentLang()].cart;
    var label = ct ? ct.add : 'Thêm vào giỏ';
    listEl.querySelectorAll('.btn-add-cart:not(.added)').forEach(function (b) {
      b.textContent = label;
    });
  }

  // ---- render danh sách ----
  function render(data) {
    currentProducts = data || [];
    if (!currentProducts.length) {
      listEl.innerHTML = '';
      showEmpty(true);
      return;
    }
    showEmpty(false);
    listEl.innerHTML = currentProducts.map(cardHTML).join('');

    // cart.js chèn nút "Thêm vào giỏ" vào .product-info (hàm global, chống chèn trùng)
    if (typeof window._injectAddToCartButtons === 'function') {
      window._injectAddToCartButtons();
    }
    applyCartLabels();
  }

  // ---- cập nhật tên khi đổi ngôn ngữ (không dựng lại để giữ trạng thái nút) ----
  function updateNames() {
    if (!listEl || !currentProducts.length) return;
    currentProducts.forEach(function (p) {
      var el = listEl.querySelector('.product-item[data-id="' + p.id + '"] .product-name');
      if (el) el.textContent = productName(p);
    });
    var empty = document.getElementById('pr-empty');
    if (empty && empty.style.display === 'block') showEmpty(true);
  }

  // ---- gom params từ drawer lọc (#fd-drawer) ----
  function buildQuery() {
    var params = [];
    if (category) params.push('category=' + encodeURIComponent(category));

    // Giá là RADIO (chọn 1 khoảng). Radio "Tất cả" không có data-min/max -> bỏ qua
    // (trả toàn bộ). Chỉ push min/max khi parse ra số nguyên hợp lệ.
    var selected = document.querySelector('#fd-drawer .price-filter-cb:checked');
    if (selected) {
      var min = parseInt(selected.dataset.min, 10);
      var max = parseInt(selected.dataset.max, 10);
      if (Number.isInteger(min)) params.push('min=' + min);
      if (Number.isInteger(max)) params.push('max=' + max);
    }

    var sortRadios = document.querySelectorAll('#fd-drawer input[name="fd-sort"]');
    var sortVals = ['newest', 'price_asc', 'price_desc'];
    for (var i = 0; i < sortRadios.length; i++) {
      if (sortRadios[i].checked) { params.push('sort=' + sortVals[i]); break; }
    }
    return params.length ? ('?' + params.join('&')) : '';
  }

  // ---- fetch + render ----
  function load() {
    fetch(API_BASE + '/api/products' + buildQuery())
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(render)
      .catch(function (err) {
        console.error('[products-render] fetch lỗi:', err);
        listEl.innerHTML = '';
        var msg = emptyMsgEl();
        msg.textContent = 'Không tải được sản phẩm (' + err.message + '). Kiểm tra server đã chạy chưa?';
        msg.style.display = 'block';
      });
  }

  // ---- nối control lọc/sort của drawer vào API ----
  function wireControls() {
    document.querySelectorAll('#fd-drawer .price-filter-cb').forEach(function (cb) {
      cb.addEventListener('change', load);
    });
    document.querySelectorAll('#fd-drawer input[name="fd-sort"]').forEach(function (r) {
      r.addEventListener('change', load);
    });
    var clearBtn = document.getElementById('fd-clear-all');
    if (clearBtn) clearBtn.addEventListener('click', function () { setTimeout(load, 0); });
  }

  // ---- init ----
  document.addEventListener('DOMContentLoaded', function () {
    listEl = document.querySelector('ul.products');
    category = (document.body.getAttribute('data-category') || '').trim();
    if (!listEl || !category) return;
    wireControls();
    load();
  });

  // i18n phát 'langchange' khi đổi VI/EN
  document.addEventListener('langchange', updateNames);
})();
