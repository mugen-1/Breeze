// Orders API (yêu cầu Firebase ID token — mọi route bọc verifyFirebaseToken).
//   POST /api/orders        — tạo đơn từ giỏ hiện tại (TRANSACTION). Body:
//                             { shipping_name, shipping_phone, shipping_address, shipping_ward,
//                               shipping_district, shipping_city, delivery_note?, shipping_method, voucherCode,
//                               paymentMethod (BẮT BUỘC — visa|mastercard|cod|momo) }.
//                             discount/total tính LẠI ở server; discountAmount/total client gửi bị bỏ qua.
//   GET  /api/orders        — danh sách đơn của user (kèm items).
//   GET  /api/orders/:id    — chi tiết 1 đơn (CHỈ chủ đơn; đơn người khác trả 404).
//
// Nguyên tắc: TIN server, KHÔNG tin client. Giá + tổng tiền tính lại từ DB; tên + giá
// được SNAPSHOT vào order_items để đơn cũ không đổi khi giá/tên sản phẩm thay đổi.
const express = require('express');
const { allocateOrderCode } = require('../lib/order-code');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { canCustomerCancel } = require('../lib/order-state');
const { cancelOrder, CancelError } = require('../lib/cancel-order');
const { createPayment, fetchPayments, COLUMNS } = require('../lib/order-payment');
const { recordInventoryMovement } = require('../lib/inventory-movement');
const { METHODS, validateShipping, grandTotal } = require('../config/shipping');
const { sellableVariant, SIZE_CONFIGURED_SQL, COLOR_CONFIGURED_SQL } = require('../lib/size-variants');
const {
  getVoucher, calcDiscount, isFirstTimeCustomer, needsCustomerHistory, checkEligibility,
} = require('../config/vouchers');

const EFFECTIVE_PRICE =
  '(CASE WHEN p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END)';

// Hình thức thanh toán hợp lệ — KHÔNG xử lý thanh toán thật, chỉ lưu lựa chọn của
// khách để tham khảo/thống kê. Whitelist bắt buộc: input người dùng, sai phải báo
// rõ (400), không được âm thầm suy đoán/gán mặc định thay khách.
const PAYMENT_METHODS = ['visa', 'mastercard', 'cod', 'momo'];
const CANCEL_REASONS = Object.freeze({
  wrong_item: 'Đặt nhầm sản phẩm',
  change_item: 'Muốn thay đổi size/sản phẩm',
  change_address: 'Muốn thay đổi địa chỉ giao hàng',
  no_longer_needed: 'Không còn nhu cầu',
  other: 'Khác',
});

router.use(verifyFirebaseToken);
router.get('/shipping-methods', (req, res) => res.json(METHODS));

// ---- POST /api/orders ----  tạo đơn từ giỏ (transaction; rollback nếu thiếu stock) ----
router.post('/', async (req, res) => {
  // Cùng quy tắc đã có ở checkout/cart UI, bắt buộc kiểm tra lại tại API.
  if (req.user.role === 'admin') {
    return res.status(403).json({ status: 'error', message: 'Tài khoản quản trị không được đặt hàng' });
  }
  // User bị blacklist (từng huỷ đơn, admin chưa gỡ): chặn đặt hàng ở BACKEND —
  // không được chỉ ẩn nút frontend (bỏ qua bằng DevTools nếu chỉ chặn UI).
  if (req.user.is_blacklisted) {
    return res.status(403).json({
      status: 'error', error: 'BLACKLISTED', message: 'Không Thể Thực Hiện Hành Động',
    });
  }

  const shipping = validateShipping(req.body);
  if (shipping.error) return res.status(400).json({ status: 'error', ...shipping });
  const snapshot = shipping.value;
  const rawVoucher = req.body && req.body.voucherCode; // tuỳ chọn — discount/total client gửi lên bị BỎ QUA

  // paymentMethod BẮT BUỘC + whitelist: giá trị lạ/rỗng -> 400 rõ ràng, KHÔNG tạo đơn,
  // KHÔNG âm thầm gán mặc định (đây là lựa chọn của khách, sai thì phải báo).
  const paymentMethod = req.body && req.body.paymentMethod;
  if (typeof paymentMethod !== 'string' || !PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({
      status: 'error',
      message: 'paymentMethod không hợp lệ. Chọn 1 trong: ' + PAYMENT_METHODS.join(', '),
    });
  }

  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('[orders] pool error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Lỗi kết nối cơ sở dữ liệu' });
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    // 1) Khoá các dòng/range giỏ của user tới COMMIT. Hai lần checkout cùng
    // user không thể cùng dùng một giỏ; sửa/ thêm giỏ cũng phải đợi.
    const cartRes = await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .query(`
        SELECT ci.product_id, ci.variant_id, ci.quantity
        FROM dbo.cart_items ci WITH (UPDLOCK, HOLDLOCK, INDEX(IX_cart_items_user))
        WHERE ci.user_id = @uid
        ORDER BY ci.product_id, ci.variant_id;`);

    if (cartRes.recordset.length === 0) {
      await tx.rollback();
      return res.status(400).json({ status: 'error', message: 'Giỏ hàng trống, không thể đặt đơn' });
    }

    // Allocate before product locks; counter and checkout commit/rollback together.
    const orderCode = await allocateOrderCode(tx);
    const method = METHODS.find(m => m.key === snapshot.shipping_method);
    snapshot.shipping_tracking_code = method.tracking_prefix + '-' + orderCode;
    snapshot.shipping_status = 'pending_pickup';

    // 2) Khoá sản phẩm theo id tăng dần ở MỌI checkout để giảm deadlock khi
    // hai giỏ có nhiều sản phẩm giao nhau. Giá/tồn kho lấy lại từ SQL Server.
    const rows = [];
    const unavailable = [];
    for (const item of cartRes.recordset.sort((a, b) => a.product_id - b.product_id || a.variant_id - b.variant_id)) {
      const productRes = await new sql.Request(tx)
        .input('pid', sql.Int, item.product_id)
        .query(`
          SELECT p.name_vi, p.is_active, p.slug,
                 (SELECT slug FROM dbo.categories WHERE id = p.category_id) AS category_slug,
                 ${SIZE_CONFIGURED_SQL} AS size_configured,
                 ${COLOR_CONFIGURED_SQL} AS color_configured,
                 ${EFFECTIVE_PRICE} AS unit_price
          FROM dbo.products p WITH (UPDLOCK, HOLDLOCK)
          WHERE p.id = @pid;`);
      const product = productRes.recordset[0];
      const variantRes = product && await new sql.Request(tx)
        .input('pid', sql.Int, item.product_id)
        .input('vid', sql.Int, item.variant_id)
        .query(`SELECT v.stock, v.is_active, v.is_base, v.size, v.color,
                  pc.label AS color_label, pc.is_active AS color_active
                FROM dbo.product_variants v WITH (UPDLOCK, HOLDLOCK)
                LEFT JOIN dbo.product_colors pc ON pc.product_id=v.product_id AND pc.color_key=v.color
                WHERE v.id = @vid AND v.product_id = @pid;`);
      const variant = variantRes && variantRes.recordset[0];
      if (!sellableVariant(product, variant)) {
        unavailable.push({ product_id: item.product_id, name: product && product.name_vi });
      } else {
        rows.push({ ...item, ...product, stock: variant.stock,
          size_snapshot: variant.size || null, color_snapshot: variant.color_label || null });
      }
    }
    if (unavailable.length) {
      await tx.rollback();
      return res.status(409).json({
        status: 'error', error: 'PRODUCT_UNAVAILABLE',
        message: 'Một số sản phẩm đã ngừng bán. Vui lòng cập nhật giỏ hàng.',
        items: unavailable,
      });
    }

    // 3) Kiểm tra tồn kho TRƯỚC khi ghi gì cả.
    const insufficient = rows
      .filter((r) => r.quantity > r.stock)
      .map((r) => ({ product_id: r.product_id, variant_id: r.variant_id, size: r.size_snapshot,
        name: r.name_vi, requested: r.quantity, stock: r.stock }));
    if (insufficient.length > 0) {
      await tx.rollback();
      return res.status(409).json({
        status: 'error', error: 'INSUFFICIENT_STOCK',
        message: 'Một số sản phẩm không đủ tồn kho',
        items: insufficient,
      });
    }

    // 4) Tổng tiền hàng (subtotal) tính ở server — totalAmount = subtotal.
    const totalAmount = rows.reduce((s, r) => s + r.unit_price * r.quantity, 0);

    // Voucher (tuỳ chọn). BẢO MẬT: server TỰ tính lại discount từ subtotal ở trên
    //     (giá DB), BỎ QUA hoàn toàn discountAmount/total client gửi. Mã không hợp lệ tại
    //     thời điểm đặt hàng -> KHÔNG fail đơn, chỉ bỏ voucher và báo voucherDropped.
    let voucherCode = null;
    let discountAmount = 0;
    let voucherDropped = false;
    if (rawVoucher != null && String(rawVoucher).trim() !== '') {
      const voucher = getVoucher(rawVoucher);
      // KIỂM TRA LẠI điều kiện tại thời điểm đặt — KHÔNG tin kết quả validate trước đó.
      // Giữa lúc khách bấm "Áp dụng" và lúc bấm "Đặt hàng" có thể trôi qua vài phút,
      // trong khoảng đó điều kiện có thể đã đổi (vd: khách vừa hoàn tất 1 đơn ở tab khác
      // -> không còn là khách mua lần đầu; hoặc giỏ đổi số lượng -> lệch khoảng mã).
      // Dùng CHUNG checkEligibility với routes/vouchers.js để 2 nơi không lệch luật.
      const itemCount = rows.reduce((s, r) => s + r.quantity, 0);
      const isFirstTime = needsCustomerHistory(voucher)
        ? await isFirstTimeCustomer(req.user.id, tx)
        : false;
      const check = checkEligibility(voucher, { subtotal: totalAmount, itemCount, isFirstTime });
      if (check.ok) {
        voucherCode = voucher.code;
        discountAmount = calcDiscount(voucher, totalAmount);
      } else {
        voucherDropped = true; // mã sai / điều kiện không thoả lúc đặt -> bỏ voucher, báo frontend
        console.warn('[orders] voucher DROPPED %s uid=%s code=%j items=%s',
          check.reason, req.user.id, rawVoucher, itemCount);
      }
    }
    const finalTotal = grandTotal(totalAmount, discountAmount, snapshot.shipping_fee);

    // 5) Trừ stock có điều kiện trong cùng transaction. UPDATE tự khoá dòng và
    // tái kiểm tra stock; mọi thay đổi dưới đây rollback nếu một dòng thất bại.
    const stockChanges = [];
    for (const r of rows) {
      const aggregate = await new sql.Request(tx)
        .input('pid', sql.Int, r.product_id)
        .input('qty', sql.Int, r.quantity)
        .query(`UPDATE dbo.products SET stock = stock - @qty, updated_at = SYSUTCDATETIME()
          WHERE id = @pid AND is_active = 1 AND stock >= @qty;`);
      if (aggregate.rowsAffected[0] !== 1) {
        const error = new Error('Product aggregate changed during checkout');
        error.code = 'INSUFFICIENT_STOCK';
        throw error;
      }
      const upd = await new sql.Request(tx)
        .input('vid', sql.Int, r.variant_id)
        .input('pid', sql.Int, r.product_id)
        .input('qty', sql.Int, r.quantity)
        .query(`UPDATE dbo.product_variants SET stock = stock - @qty, updated_at = SYSUTCDATETIME()
          OUTPUT DELETED.stock AS stock_before, INSERTED.stock AS stock_after
          WHERE id = @vid AND product_id = @pid AND is_active = 1 AND stock >= @qty;`);
      if (upd.rowsAffected[0] !== 1) {
        const error = new Error('Stock changed during checkout');
        error.code = 'INSUFFICIENT_STOCK';
        throw error;
      }
      stockChanges.push({ productId: r.product_id, variantId: r.variant_id, delta: -r.quantity,
        before: upd.recordset[0].stock_before, after: upd.recordset[0].stock_after });
    }

    // 6) Tạo orders, lấy id. total_amount = TỔNG ĐÃ TRỪ giảm giá; lưu kèm VoucherCode/DiscountAmount/PaymentMethod.
    const orderRes = await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .input('total', sql.Decimal(12, 2), finalTotal)
      .input('sname', sql.NVarChar(150), snapshot.shipping_name)
      .input('sphone', sql.VarChar(30), snapshot.shipping_phone)
      .input('saddr', sql.NVarChar(400), snapshot.shipping_address)
      .input('sward', sql.NVarChar(120), snapshot.shipping_ward)
      .input('sdistrict', sql.NVarChar(120), snapshot.shipping_district)
      .input('scity', sql.NVarChar(120), snapshot.shipping_city)
      .input('snote', sql.NVarChar(500), snapshot.delivery_note || null)
      .input('ocode', sql.Int, orderCode)
      .input('sprovider', sql.NVarChar(80), snapshot.shipping_provider)
      .input('sservice', sql.NVarChar(120), snapshot.shipping_service)
      .input('seta', sql.NVarChar(80), snapshot.shipping_eta)
      .input('stracking', sql.VarChar(64), snapshot.shipping_tracking_code)
      .input('smethod', sql.VarChar(20), snapshot.shipping_method)
      .input('sfee', sql.Decimal(12, 2), snapshot.shipping_fee)
      .input('vcode', sql.NVarChar(50), voucherCode)
      .input('discount', sql.Decimal(18, 2), discountAmount)
      .input('pmethod', sql.NVarChar(20), paymentMethod)
      .query(`
        INSERT INTO dbo.orders (user_id, status, total_amount, shipping_name, shipping_phone, shipping_address, VoucherCode, DiscountAmount, PaymentMethod,
          shipping_version, shipping_ward, shipping_district, shipping_city, delivery_note, shipping_method, shipping_fee,
          order_code, shipping_provider, shipping_service, shipping_eta, shipping_tracking_code, shipping_status)
        OUTPUT INSERTED.id, INSERTED.status, INSERTED.total_amount, INSERTED.created_at,
               INSERTED.VoucherCode, INSERTED.DiscountAmount, INSERTED.PaymentMethod
        VALUES (@uid, 'pending', @total, @sname, @sphone, @saddr, @vcode, @discount, @pmethod,
          2, @sward, @sdistrict, @scity, @snote, @smethod, @sfee,
          @ocode, @sprovider, @sservice, @seta, @stracking, 'pending_pickup');`);
    const order = orderRes.recordset[0];

    // 7) order_items giữ snapshot tên và giá SQL tại thời điểm đặt.
    for (const r of rows) {
      await new sql.Request(tx)
        .input('oid', sql.Int, order.id)
        .input('pid', sql.Int, r.product_id)
        .input('vid', sql.Int, r.variant_id)
        .input('pname', sql.NVarChar(200), r.name_vi)
        .input('size', sql.NVarChar(40), r.size_snapshot)
        .input('color', sql.NVarChar(80), r.color_snapshot)
        .input('uprice', sql.Decimal(12, 2), r.unit_price)
        .input('qty', sql.Int, r.quantity)
        .input('ltotal', sql.Decimal(12, 2), r.unit_price * r.quantity)
        .query(`
          INSERT INTO dbo.order_items (order_id, product_id, variant_id, product_name, size_snapshot, color_snapshot, unit_price, quantity, line_total)
          VALUES (@oid, @pid, @vid, @pname, @size, @color, @uprice, @qty, @ltotal);`);
    }

    // Order ID now exists; ledger rows share this transaction with stock and items.
    for (const change of stockChanges) {
      await recordInventoryMovement(tx, { ...change, type: 'ORDER_CHECKOUT',
        orderId: order.id, actorUserId: req.user.id });
    }

    const payment = await createPayment(tx, order.id);

    // 8) Xoá giỏ của user trong transaction; lỗi ở đây cũng phục hồi stock/order.
    await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .query('DELETE FROM dbo.cart_items WHERE user_id = @uid;');

    await tx.commit();

    res.status(201).json({
      status: 'ok',
      voucherDropped, // true nếu client gửi mã nhưng mã hết hiệu lực -> frontend báo & tính theo giá gốc
      order: {
        id: order.id,
        status: order.status,
        total_amount: order.total_amount,
        subtotal: totalAmount,
        ...snapshot,
        shipping_version: 2,
        order_code: orderCode,
        voucher_code: order.VoucherCode,
        discount_amount: order.DiscountAmount,
        payment_method: order.PaymentMethod,
        created_at: order.created_at,
        payment_transaction: payment,
        item_count: rows.length,
      },
    });
  } catch (err) {
    try { await tx.rollback(); } catch (e) { /* đã rollback hoặc chưa begin */ }
    if (err.code === 'ORDER_CODE_LIMIT') {
      return res.status(409).json({ status: 'error', error: 'ORDER_CODE_LIMIT', message: 'lỗi lên đơn' });
    }
    if (err.code === 'INSUFFICIENT_STOCK') {
      return res.status(409).json({ status: 'error', error: 'INSUFFICIENT_STOCK', message: 'Sản phẩm vừa hết hàng, vui lòng thử lại' });
    }
    console.error('[orders] create error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tạo được đơn hàng' });
  }
});

// A simulation action, never a client supplied payment status or amount.
router.post('/:id/payment-simulation', async (req, res) => {
  const id = Number(req.params.id), body = req.body;
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647 || !body || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !['success', 'failure'].includes(body.outcome)) {
    return res.status(400).json({ status: 'error', message: 'Kết quả mô phỏng không hợp lệ' });
  }
  if (req.user.role === 'admin') {
    return res.status(403).json({ status: 'error', message: 'Chỉ chủ đơn hàng được mô phỏng thanh toán' });
  }
  let tx;
  try {
    tx = new sql.Transaction(await getPool());
    await tx.begin();
    // Same lock order as cancellation and completion: order first, payment second.
    const order = (await new sql.Request(tx).input('id', sql.Int, id).input('uid', sql.Int, req.user.id)
      .query(`SELECT id, status, total_amount, PaymentMethod AS payment_method
        FROM dbo.orders WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND user_id = @uid;`)).recordset[0];
    if (!order) {
      await tx.rollback();
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    }
    const payment = (await new sql.Request(tx).input('oid', sql.Int, id)
      .query(`SELECT ${COLUMNS} FROM dbo.payment_transactions WITH (UPDLOCK, HOLDLOCK)
        WHERE order_id = @oid;`)).recordset[0];
    if (!payment || payment.status !== 'pending' ||
        !['visa', 'mastercard', 'momo'].includes(payment.payment_method) ||
        payment.payment_method !== order.payment_method || Number(payment.amount) !== Number(order.total_amount) ||
        !['pending', 'confirmed', 'processing', 'shipping', 'shipped', 'paid'].includes(order.status)) {
      await tx.rollback();
      return res.status(409).json({ status: 'error', message: 'Giao dịch không còn cho phép mô phỏng thanh toán' });
    }
    const updated = (await new sql.Request(tx).input('oid', sql.Int, id)
      .input('outcome', sql.VarChar(10), body.outcome).query(`
        UPDATE dbo.payment_transactions
        SET status = CASE WHEN @outcome = 'success' THEN 'paid' ELSE 'failed' END,
            paid_at = CASE WHEN @outcome = 'success' THEN SYSUTCDATETIME() ELSE NULL END
        OUTPUT ${COLUMNS.split(', ').map(c => 'INSERTED.' + c).join(', ')}
        WHERE order_id = @oid AND status = 'pending';`)).recordset[0];
    if (!updated) throw new Error('PAYMENT_STATE_CHANGED');
    await tx.commit();
    return res.json({ status: 'ok', payment_transaction: updated });
  } catch (error) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* already rolled back */ } }
    console.error('[orders] payment simulation error:', error.code || 'database-error');
    return res.status(500).json({ status: 'error', message: 'Không cập nhật được thanh toán mô phỏng' });
  }
});

// ---- POST /api/orders/:id/cancel — customer self-cancellation -------------
router.post('/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ status: 'error', message: 'id phải là số nguyên dương' });
  }
  if (req.user.role === 'admin') {
    return res.status(403).json({ status: 'error', message: 'Tài khoản quản trị không thể dùng chức năng hủy đơn của khách' });
  }
  const reasonCode = req.body && req.body.reason;
  const details = req.body && req.body.details;
  if (typeof reasonCode !== 'string' || !Object.hasOwn(CANCEL_REASONS, reasonCode)) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng chọn lý do hủy hợp lệ' });
  }
  if (details != null && typeof details !== 'string') {
    return res.status(400).json({ status: 'error', message: 'Chi tiết lý do phải là chuỗi' });
  }
  const shortDetails = details == null ? '' : details.trim();
  if (shortDetails.length > 180 || (reasonCode === 'other' && !shortDetails) ||
      (reasonCode !== 'other' && shortDetails)) {
    return res.status(400).json({ status: 'error', message: 'Chi tiết lý do hủy không hợp lệ (tối đa 180 ký tự)' });
  }
  const reason = reasonCode === 'other' ? `Khác: ${shortDetails}` : CANCEL_REASONS[reasonCode];
  try {
    const pool = await getPool();
    const order = await cancelOrder(pool, { orderId: id, ownerId: req.user.id,
      reason, actorUserId: req.user.id });
    return res.json({ status: 'ok', order: { ...order, can_cancel: false } });
  } catch (error) {
    if (error instanceof CancelError && error.status < 500) {
      return res.status(error.status).json({ status: 'error', error: error.code, message: error.message });
    }
    console.error('[orders] cancel error:', error.code || error.message);
    return res.status(500).json({ status: 'error', message: 'Không thể hủy đơn hàng' });
  }
});

// Gắn items vào từng order (1 truy vấn cho nhiều order). Trả map orderId -> items[].
async function fetchItemsByOrderIds(pool, orderIds) {
  if (orderIds.length === 0) return {};
  const request = pool.request();
  const params = orderIds.map((id, i) => {
    request.input('o' + i, sql.Int, id);
    return '@o' + i;
  });
  const result = await request.query(`
    SELECT order_id, product_id, variant_id, product_name, size_snapshot, color_snapshot, unit_price, quantity, line_total
    FROM dbo.order_items
    WHERE order_id IN (${params.join(', ')})
    ORDER BY id;`);

  const map = {};
  for (const it of result.recordset) {
    (map[it.order_id] = map[it.order_id] || []).push({
      product_id: it.product_id,
      variant_id: it.variant_id,
      size_snapshot: it.size_snapshot,
      color_snapshot: it.color_snapshot,
      product_name: it.product_name,
      unit_price: it.unit_price,
      quantity: it.quantity,
      line_total: it.line_total,
    });
  }
  return map;
}

// ---- GET /api/orders ----  danh sách đơn của user (kèm items) ----
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const ordersRes = await pool
      .request()
      .input('uid', sql.Int, req.user.id)
      .query(`
        SELECT id, status, total_amount, currency, shipping_name, shipping_phone, shipping_address,
               created_at, cancel_reason, cancelled_at,
               VoucherCode AS voucher_code, DiscountAmount AS discount_amount, PaymentMethod AS payment_method,
               shipping_version, shipping_ward, shipping_district, shipping_city, delivery_note, shipping_method, shipping_fee,
               order_code, shipping_provider, shipping_service, shipping_eta, shipping_tracking_code, shipping_status
        FROM dbo.orders
        WHERE user_id = @uid
        ORDER BY created_at DESC, id DESC;`);

    const orders = ordersRes.recordset;
    const itemsMap = await fetchItemsByOrderIds(pool, orders.map((o) => o.id));
    const payments = await fetchPayments(pool, orders.map(o => o.id));
    res.json(orders.map((o) => ({ ...o, payment_transaction: payments[o.id] || null, can_cancel: canCustomerCancel(o.status), items: itemsMap[o.id] || [] })));
  } catch (err) {
    console.error('[orders] list error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được đơn hàng' });
  }
});

// ---- GET /api/orders/:id ----  chi tiết 1 đơn (chỉ chủ đơn) ----
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ status: 'error', message: 'id phải là số nguyên dương' });
  }

  try {
    const pool = await getPool();
    // Ràng buộc user_id = chủ đơn ngay trong WHERE => đơn người khác trả 404 (không lộ tồn tại).
    const orderRes = await pool
      .request()
      .input('id', sql.Int, id)
      .input('uid', sql.Int, req.user.id)
      .query(`
        SELECT id, status, total_amount, currency, shipping_name, shipping_phone, shipping_address,
               created_at, cancel_reason, cancelled_at,
               VoucherCode AS voucher_code, DiscountAmount AS discount_amount, PaymentMethod AS payment_method,
               shipping_version, shipping_ward, shipping_district, shipping_city, delivery_note, shipping_method, shipping_fee,
               order_code, shipping_provider, shipping_service, shipping_eta, shipping_tracking_code, shipping_status
        FROM dbo.orders
        WHERE id = @id AND user_id = @uid;`);

    if (orderRes.recordset.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    }

    const order = orderRes.recordset[0];
    const itemsMap = await fetchItemsByOrderIds(pool, [order.id]);
    const payments = await fetchPayments(pool, [order.id]);
    res.json({ ...order, payment_transaction: payments[order.id] || null, can_cancel: canCustomerCancel(order.status), items: itemsMap[order.id] || [] });
  } catch (err) {
    console.error('[orders] detail error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được đơn hàng' });
  }
});

module.exports = router;
