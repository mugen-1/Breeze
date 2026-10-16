'use strict';
const { sql } = require('../db');

// Reusable purchase relation for future review creation and Admin verified purchase.
// Identity and labels come from order_items, never today's product variant/color metadata.
// Repeated purchases of an identity use its latest completed-order snapshot.
const PURCHASED_VARIANTS_SQL = `
    WITH purchased AS (
        SELECT oi.id AS order_item_id, oi.variant_id, oi.size_snapshot, oi.color_snapshot,
            ROW_NUMBER() OVER (PARTITION BY oi.variant_id
                ORDER BY o.created_at DESC, o.id DESC, oi.id DESC) AS purchase_rank
        FROM dbo.orders o JOIN dbo.order_items oi ON oi.order_id = o.id
        WHERE o.user_id = @uid AND o.status = 'completed' AND oi.product_id = @pid
    )
    SELECT order_item_id, variant_id, size_snapshot, color_snapshot
    FROM purchased WHERE purchase_rank = 1 ORDER BY variant_id;`;

function purchaseRequest(pool, userId, productId) {
    return pool.request().input('uid', sql.Int, userId).input('pid', sql.Int, productId);
}
async function getPurchasedProductVariants(pool, userId, productId, lock = false) {
    // Creation keeps the qualifying order/items stable until its transaction commits.
    const query = lock ? PURCHASED_VARIANTS_SQL.replace('dbo.orders o JOIN dbo.order_items oi',
        'dbo.orders o WITH (HOLDLOCK) JOIN dbo.order_items oi WITH (HOLDLOCK)') : PURCHASED_VARIANTS_SQL;
    return (await purchaseRequest(pool, userId, productId).query(query)).recordset;
}
async function getReviewEligibility(pool, userId, productId) {
    const result = await purchaseRequest(pool, userId, productId).query(PURCHASED_VARIANTS_SQL + `
        SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.reviews
            WHERE user_id = @uid AND product_id = @pid) THEN 1 ELSE 0 END AS BIT) AS hasReviewed;`);
    const purchasedVariants = result.recordsets[0];
    return { canReview: purchasedVariants.length > 0, hasReviewed: !!result.recordsets[1][0].hasReviewed, purchasedVariants };
}
module.exports = { getPurchasedProductVariants, getReviewEligibility };
