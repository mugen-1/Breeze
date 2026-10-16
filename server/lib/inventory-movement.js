'use strict';

const { sql } = require('../db');

// Call only inside the same transaction that changes variant stock and its product aggregate.
async function recordInventoryMovement(tx, data) {
  return new sql.Request(tx)
    .input('pid', sql.Int, data.productId)
    .input('vid', sql.Int, data.variantId)
    .input('oid', sql.Int, data.orderId || null)
    .input('oref', sql.Int, data.orderId || null)
    .input('type', sql.VarChar(30), data.type)
    .input('delta', sql.Int, data.delta)
    .input('before', sql.Int, data.before)
    .input('after', sql.Int, data.after)
    .input('reason', sql.NVarChar(250), data.reason || null)
    .input('actor', sql.Int, data.actorUserId || null)
    .query(`INSERT INTO dbo.inventory_movements
      (product_id, variant_id, order_id, order_reference_id, movement_type, quantity_delta,
       stock_before, stock_after, reason, actor_user_id)
      VALUES (@pid, @vid, @oid, @oref, @type, @delta, @before, @after, @reason, @actor);`);
}

module.exports = { recordInventoryMovement };
