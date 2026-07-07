// Orders API (yêu cầu Firebase ID token — mọi route bọc verifyFirebaseToken).
//   POST /api/orders        — tạo đơn từ giỏ hiện tại (TRANSACTION). Body (tuỳ chọn):
//                             { shipping_name, shipping_phone, shipping_address }.
//   GET  /api/orders        — danh sách đơn của user (kèm items).
//   GET  /api/orders/:id    — chi tiết 1 đơn (CHỈ chủ đơn; đơn người khác trả 404).
//
// Nguyên tắc: TIN server, KHÔNG tin client. Giá + tổng tiền tính lại từ DB; tên + giá
// được SNAPSHOT vào order_items để đơn cũ không đổi khi giá/tên sản phẩm thay đổi.
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');

const EFFECTIVE_PRICE =
  '(CASE WHEN p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END)';

router.use(verifyFirebaseToken);

function str(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// ---- POST /api/orders ----  tạo đơn từ giỏ (transaction; rollback nếu thiếu stock) ----
router.post('/', async (req, res) => {
  const shippingName = str(req.body && req.body.shipping_name, 150);
  const shippingPhone = str(req.body && req.body.shipping_phone, 30);
  const shippingAddress = str(req.body && req.body.shipping_address, 400);

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

    // 1) Đọc giỏ + khoá dòng products (UPDLOCK) để tránh 2 đơn cùng trừ 1 kho.
    const cartRes = await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .query(`
        SELECT ci.product_id, ci.quantity,
               p.name_vi, p.stock,
               ${EFFECTIVE_PRICE} AS unit_price
        FROM dbo.cart_items ci
        JOIN dbo.products p WITH (UPDLOCK, HOLDLOCK) ON p.id = ci.product_id
        WHERE ci.user_id = @uid;`);

    const rows = cartRes.recordset;
    if (rows.length === 0) {
      await tx.rollback();
      return res.status(400).json({ status: 'error', message: 'Giỏ hàng trống, không thể đặt đơn' });
    }

    // 2) Kiểm tra tồn kho TRƯỚC khi ghi gì cả.
    const insufficient = rows
      .filter((r) => r.quantity > r.stock)
      .map((r) => ({ product_id: r.product_id, name: r.name_vi, requested: r.quantity, stock: r.stock }));
    if (insufficient.length > 0) {
      await tx.rollback();
      return res.status(409).json({
        status: 'error',
        message: 'Một số sản phẩm không đủ tồn kho',
        items: insufficient,
      });
    }

    // 3) Tổng tiền tính ở server.
    const totalAmount = rows.reduce((s, r) => s + r.unit_price * r.quantity, 0);

    // 4) Tạo orders, lấy id.
    const orderRes = await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .input('total', sql.Decimal(12, 2), totalAmount)
      .input('sname', sql.NVarChar(150), shippingName)
      .input('sphone', sql.VarChar(30), shippingPhone)
      .input('saddr', sql.NVarChar(400), shippingAddress)
      .query(`
        INSERT INTO dbo.orders (user_id, status, total_amount, shipping_name, shipping_phone, shipping_address)
        OUTPUT INSERTED.id, INSERTED.status, INSERTED.total_amount, INSERTED.created_at
        VALUES (@uid, 'pending', @total, @sname, @sphone, @saddr);`);
    const order = orderRes.recordset[0];

    // 5) order_items (snapshot tên + giá) + trừ stock, từng dòng trong cùng transaction.
    for (const r of rows) {
      await new sql.Request(tx)
        .input('oid', sql.Int, order.id)
        .input('pid', sql.Int, r.product_id)
        .input('pname', sql.NVarChar(200), r.name_vi)
        .input('uprice', sql.Decimal(12, 2), r.unit_price)
        .input('qty', sql.Int, r.quantity)
        .input('ltotal', sql.Decimal(12, 2), r.unit_price * r.quantity)
        .query(`
          INSERT INTO dbo.order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
          VALUES (@oid, @pid, @pname, @uprice, @qty, @ltotal);`);

      // Trừ stock có điều kiện: nếu ai đó vừa mua hết (dù đã UPDLOCK) thì rowsAffected=0 -> rollback.
      const upd = await new sql.Request(tx)
        .input('pid', sql.Int, r.product_id)
        .input('qty', sql.Int, r.quantity)
        .query('UPDATE dbo.products SET stock = stock - @qty, updated_at = SYSUTCDATETIME() WHERE id = @pid AND stock >= @qty;');
      if (!upd.rowsAffected[0]) {
        throw new Error('STOCK_RACE:' + r.product_id);
      }
    }

    // 6) Xoá giỏ của user.
    await new sql.Request(tx)
      .input('uid', sql.Int, req.user.id)
      .query('DELETE FROM dbo.cart_items WHERE user_id = @uid;');

    await tx.commit();

    res.status(201).json({
      status: 'ok',
      order: {
        id: order.id,
        status: order.status,
        total_amount: order.total_amount,
        created_at: order.created_at,
        item_count: rows.length,
      },
    });
  } catch (err) {
    try { await tx.rollback(); } catch (e) { /* đã rollback hoặc chưa begin */ }
    if (String(err.message).startsWith('STOCK_RACE:')) {
      return res.status(409).json({ status: 'error', message: 'Sản phẩm vừa hết hàng, vui lòng thử lại' });
    }
    console.error('[orders] create error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tạo được đơn hàng' });
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
    SELECT order_id, product_id, product_name, unit_price, quantity, line_total
    FROM dbo.order_items
    WHERE order_id IN (${params.join(', ')})
    ORDER BY id;`);

  const map = {};
  for (const it of result.recordset) {
    (map[it.order_id] = map[it.order_id] || []).push({
      product_id: it.product_id,
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
        SELECT id, status, total_amount, currency, shipping_name, shipping_phone, shipping_address, created_at
        FROM dbo.orders
        WHERE user_id = @uid
        ORDER BY created_at DESC, id DESC;`);

    const orders = ordersRes.recordset;
    const itemsMap = await fetchItemsByOrderIds(pool, orders.map((o) => o.id));
    res.json(orders.map((o) => ({ ...o, items: itemsMap[o.id] || [] })));
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
        SELECT id, status, total_amount, currency, shipping_name, shipping_phone, shipping_address, created_at
        FROM dbo.orders
        WHERE id = @id AND user_id = @uid;`);

    if (orderRes.recordset.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy đơn hàng' });
    }

    const order = orderRes.recordset[0];
    const itemsMap = await fetchItemsByOrderIds(pool, [order.id]);
    res.json({ ...order, items: itemsMap[order.id] || [] });
  } catch (err) {
    console.error('[orders] detail error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được đơn hàng' });
  }
});

module.exports = router;
