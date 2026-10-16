'use strict';
const { sql } = require('../db');
const FIRST_CODE = 1001;
const LAST_CODE = 1100;

// The counter is transactional (unlike IDENTITY/SEQUENCE), and survives order deletion.
async function allocateOrderCode(tx) {
  const result = await new sql.Request(tx).input('lastCode', sql.Int, LAST_CODE).query(`
    UPDATE dbo.order_code_counter WITH (UPDLOCK, HOLDLOCK)
    SET last_code = last_code + 1
    OUTPUT INSERTED.last_code AS order_code
    WHERE id = 1 AND last_code < @lastCode;`);
  if (!result.recordset.length) {
    const error = new Error('lỗi lên đơn');
    error.code = 'ORDER_CODE_LIMIT';
    throw error;
  }
  return result.recordset[0].order_code;
}
module.exports = { FIRST_CODE, LAST_CODE, allocateOrderCode };
