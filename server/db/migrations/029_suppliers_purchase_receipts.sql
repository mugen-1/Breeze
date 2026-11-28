/* Nhà cung cấp và phiếu nhập kho. Code: lib/suppliers.js, lib/purchase-receipt.js.
   - suppliers: không xoá cứng; ngừng hợp tác = is_active 0 (phiếu cũ vẫn tham chiếu được).
     code: chữ HOA, số, dấu gạch ngang (vd NCC-001), duy nhất.
   - purchase_receipts: code sinh từ id (PN-000001) bằng cột tính PERSISTED + UNIQUE.
     status: draft -> pending (gửi duyệt) -> approved (admin duyệt) -> received (nhận hàng, cộng kho).
       Từ chối: pending -> draft, lưu lý do ở reject_reason + rejected_by/rejected_at (lần từ chối gần nhất).
       Huỷ: draft | pending | approved -> cancelled (bắt buộc cancel_reason).
     CK_purchase_receipts_state buộc các cột mốc (người + thời điểm) khớp trạng thái.
     created_by / submitted_by / approved_by / rejected_by / received_by / cancelled_by: id của dbo.users
       KHÔNG có FOREIGN KEY, để xoá tài khoản nhân viên không bị chặn; giao diện hiện "Tài khoản đã xóa"
       khi không còn user (cùng cách audit log).
   - purchase_receipt_items: mỗi dòng 1 biến thể; FK (product_id, variant_id) như order_items;
     snapshot tên/SKU/size/màu lúc lập phiếu; unit_cost là giá nhập (VND), chỉ hiển thị, không đổi giá bán.
   - inventory_movements: thêm receipt_id + loại PURCHASE_RECEIPT (giữ nguyên 9 loại của 024).
     CK_inventory_movements_receipt: PURCHASE_RECEIPT phải có receipt_id, variant_id và cộng dương;
     loại khác không được có receipt_id.
     UX_inventory_movements_receipt_variant: mỗi (phiếu, biến thể) chỉ cộng kho một lần — chặn ở tầng DB
     cả khi hai yêu cầu nhận hàng chạy song song.
   Mọi điều kiện trong CHECK viết rõ IS NOT NULL: CHECK cho qua khi biểu thức ra UNKNOWN (NULL).
   Idempotent: phần nào đã có thì bỏ qua; không sửa/xoá dữ liệu sẵn có. */
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.inventory_movements', 'U') IS NULL
        THROW 51290, 'Run 011_inventory_movements.sql before 029_suppliers_purchase_receipts.sql', 1;
    IF OBJECT_ID('dbo.product_variants', 'U') IS NULL
        THROW 51291, 'Run 012_product_variants.sql before 029_suppliers_purchase_receipts.sql', 1;

    /* ---- suppliers ---- */
    IF OBJECT_ID('dbo.suppliers', 'U') IS NULL
        CREATE TABLE dbo.suppliers (
            id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_suppliers PRIMARY KEY,
            code          VARCHAR(20)    NOT NULL,
            name          NVARCHAR(200)  NOT NULL,
            contact_name  NVARCHAR(120)  NULL,
            phone         VARCHAR(20)    NULL,
            email         VARCHAR(255)   NULL,
            address       NVARCHAR(300)  NULL,
            tax_code      VARCHAR(20)    NULL,
            note          NVARCHAR(500)  NULL,
            is_active     BIT            NOT NULL CONSTRAINT DF_suppliers_is_active DEFAULT 1,
            created_at    DATETIME2(3)   NOT NULL CONSTRAINT DF_suppliers_created_at DEFAULT SYSUTCDATETIME(),
            updated_at    DATETIME2(3)   NOT NULL CONSTRAINT DF_suppliers_updated_at DEFAULT SYSUTCDATETIME(),
            CONSTRAINT UQ_suppliers_code UNIQUE (code)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_suppliers_code' AND parent_object_id = OBJECT_ID('dbo.suppliers'))
        ALTER TABLE dbo.suppliers WITH CHECK ADD CONSTRAINT CK_suppliers_code
            CHECK (LEN(code) >= 2 AND DATALENGTH(code) = LEN(code)
                   AND code COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^A-Z0-9-]%');
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_suppliers_name' AND parent_object_id = OBJECT_ID('dbo.suppliers'))
        ALTER TABLE dbo.suppliers WITH CHECK ADD CONSTRAINT CK_suppliers_name CHECK (LEN(name) > 0);
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_suppliers_phone' AND parent_object_id = OBJECT_ID('dbo.suppliers'))
        ALTER TABLE dbo.suppliers WITH CHECK ADD CONSTRAINT CK_suppliers_phone
            CHECK (phone IS NULL OR (LEN(phone) BETWEEN 8 AND 20
                   AND phone COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9+]%'));
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_suppliers_tax_code' AND parent_object_id = OBJECT_ID('dbo.suppliers'))
        ALTER TABLE dbo.suppliers WITH CHECK ADD CONSTRAINT CK_suppliers_tax_code
            CHECK (tax_code IS NULL OR (LEN(tax_code) BETWEEN 10 AND 14
                   AND tax_code COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9-]%'));
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_suppliers_email' AND parent_object_id = OBJECT_ID('dbo.suppliers'))
        ALTER TABLE dbo.suppliers WITH CHECK ADD CONSTRAINT CK_suppliers_email
            CHECK (email IS NULL OR email LIKE '_%@_%._%');

    /* ---- purchase_receipts ---- */
    IF OBJECT_ID('dbo.purchase_receipts', 'U') IS NULL
        CREATE TABLE dbo.purchase_receipts (
            id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_purchase_receipts PRIMARY KEY,
            code           AS CONVERT(VARCHAR(16), 'PN-' + CASE WHEN id < 1000000
                               THEN RIGHT('000000' + CONVERT(VARCHAR(11), id), 6)
                               ELSE CONVERT(VARCHAR(11), id) END) PERSISTED,
            supplier_id    INT            NOT NULL,
            status         VARCHAR(12)    NOT NULL CONSTRAINT DF_purchase_receipts_status DEFAULT 'draft',
            note           NVARCHAR(500)  NULL,
            expected_date  DATE           NULL,
            created_by     INT            NOT NULL,
            created_at     DATETIME2(3)   NOT NULL CONSTRAINT DF_purchase_receipts_created_at DEFAULT SYSUTCDATETIME(),
            updated_at     DATETIME2(3)   NOT NULL CONSTRAINT DF_purchase_receipts_updated_at DEFAULT SYSUTCDATETIME(),
            submitted_by   INT            NULL,
            submitted_at   DATETIME2(3)   NULL,
            approved_by    INT            NULL,
            approved_at    DATETIME2(3)   NULL,
            rejected_by    INT            NULL,
            rejected_at    DATETIME2(3)   NULL,
            reject_reason  NVARCHAR(250)  NULL,
            received_by    INT            NULL,
            received_at    DATETIME2(3)   NULL,
            cancelled_by   INT            NULL,
            cancelled_at   DATETIME2(3)   NULL,
            cancel_reason  NVARCHAR(250)  NULL,
            CONSTRAINT FK_purchase_receipts_supplier FOREIGN KEY (supplier_id)
                REFERENCES dbo.suppliers(id) ON DELETE NO ACTION
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'UX_purchase_receipts_code' AND object_id = OBJECT_ID('dbo.purchase_receipts'))
        CREATE UNIQUE INDEX UX_purchase_receipts_code ON dbo.purchase_receipts(code);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'IX_purchase_receipts_status_time' AND object_id = OBJECT_ID('dbo.purchase_receipts'))
        CREATE INDEX IX_purchase_receipts_status_time ON dbo.purchase_receipts(status, created_at DESC, id DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'IX_purchase_receipts_supplier' AND object_id = OBJECT_ID('dbo.purchase_receipts'))
        CREATE INDEX IX_purchase_receipts_supplier ON dbo.purchase_receipts(supplier_id, created_at DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_purchase_receipts_status' AND parent_object_id = OBJECT_ID('dbo.purchase_receipts'))
        ALTER TABLE dbo.purchase_receipts WITH CHECK ADD CONSTRAINT CK_purchase_receipts_status
            CHECK (status COLLATE Latin1_General_CS_AS IN ('draft', 'pending', 'approved', 'received', 'cancelled')
                   AND DATALENGTH(status) = LEN(status));
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_purchase_receipts_state' AND parent_object_id = OBJECT_ID('dbo.purchase_receipts'))
        ALTER TABLE dbo.purchase_receipts WITH CHECK ADD CONSTRAINT CK_purchase_receipts_state CHECK (
            ((submitted_by IS NULL AND submitted_at IS NULL) OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL))
            AND ((approved_by IS NULL AND approved_at IS NULL) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
            AND ((received_by IS NULL AND received_at IS NULL) OR (received_by IS NOT NULL AND received_at IS NOT NULL))
            AND ((rejected_by IS NULL AND rejected_at IS NULL AND reject_reason IS NULL)
              OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL
                  AND reject_reason IS NOT NULL AND LEN(reject_reason) > 0))
            AND ((cancelled_by IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
              OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
                  AND cancel_reason IS NOT NULL AND LEN(cancel_reason) > 0))
            AND (
                 (status = 'draft'     AND approved_at IS NULL AND received_at IS NULL AND cancelled_at IS NULL)
              OR (status = 'pending'   AND submitted_at IS NOT NULL AND approved_at IS NULL
                                       AND received_at IS NULL AND cancelled_at IS NULL)
              OR (status = 'approved'  AND submitted_at IS NOT NULL AND approved_at IS NOT NULL
                                       AND received_at IS NULL AND cancelled_at IS NULL)
              OR (status = 'received'  AND submitted_at IS NOT NULL AND approved_at IS NOT NULL
                                       AND received_at IS NOT NULL AND cancelled_at IS NULL)
              OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND received_at IS NULL)
            ));

    /* ---- purchase_receipt_items ---- */
    IF OBJECT_ID('dbo.purchase_receipt_items', 'U') IS NULL
        CREATE TABLE dbo.purchase_receipt_items (
            id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_purchase_receipt_items PRIMARY KEY,
            receipt_id     INT            NOT NULL,
            product_id     INT            NOT NULL,
            variant_id     INT            NOT NULL,
            quantity       INT            NOT NULL,
            unit_cost      INT            NOT NULL,
            name_snapshot  NVARCHAR(200)  NOT NULL,
            sku_snapshot   VARCHAR(80)    NOT NULL,
            size_snapshot  NVARCHAR(40)   NULL,
            color_snapshot NVARCHAR(80)   NULL,
            CONSTRAINT FK_purchase_receipt_items_receipt FOREIGN KEY (receipt_id)
                REFERENCES dbo.purchase_receipts(id) ON DELETE NO ACTION,
            CONSTRAINT FK_purchase_receipt_items_variant_product FOREIGN KEY (product_id, variant_id)
                REFERENCES dbo.product_variants(product_id, id),
            CONSTRAINT UQ_purchase_receipt_items_variant UNIQUE (receipt_id, variant_id),
            CONSTRAINT CK_purchase_receipt_items_quantity CHECK (quantity BETWEEN 1 AND 100000),
            CONSTRAINT CK_purchase_receipt_items_unit_cost CHECK (unit_cost BETWEEN 0 AND 1000000000)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'IX_purchase_receipt_items_variant' AND object_id = OBJECT_ID('dbo.purchase_receipt_items'))
        CREATE INDEX IX_purchase_receipt_items_variant ON dbo.purchase_receipt_items(variant_id);

    /* ---- inventory_movements: receipt_id + loại PURCHASE_RECEIPT ---- */
    IF COL_LENGTH('dbo.inventory_movements', 'receipt_id') IS NULL
        ALTER TABLE dbo.inventory_movements ADD receipt_id INT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
                   WHERE name = 'FK_inventory_movements_receipt' AND parent_object_id = OBJECT_ID('dbo.inventory_movements'))
        EXEC(N'ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT FK_inventory_movements_receipt
            FOREIGN KEY (receipt_id) REFERENCES dbo.purchase_receipts(id) ON DELETE NO ACTION;');

    IF EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE parent_object_id = OBJECT_ID('dbo.inventory_movements')
                 AND name = 'CK_inventory_movements_type'
                 AND (definition NOT LIKE '%OPENING_BALANCE%'
                   OR definition NOT LIKE '%VARIANT_OPENING%'
                   OR definition NOT LIKE '%ORDER_CHECKOUT%'
                   OR definition NOT LIKE '%ORDER_CANCEL%'
                   OR definition NOT LIKE '%ADMIN_ADJUSTMENT%'
                   OR definition NOT LIKE '%PRODUCT_CREATE%'
                   OR definition NOT LIKE '%VARIANT_TRANSFER_OUT%'
                   OR definition NOT LIKE '%VARIANT_TRANSFER_IN%'
                   OR definition NOT LIKE '%ORDER_DELETE%'
                   OR definition NOT LIKE '%PURCHASE_RECEIPT%'))
        ALTER TABLE dbo.inventory_movements DROP CONSTRAINT CK_inventory_movements_type;
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE parent_object_id = OBJECT_ID('dbo.inventory_movements')
                     AND name = 'CK_inventory_movements_type')
        ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT CK_inventory_movements_type CHECK
          (movement_type IN ('OPENING_BALANCE','VARIANT_OPENING','ORDER_CHECKOUT','ORDER_CANCEL',
                            'ADMIN_ADJUSTMENT','PRODUCT_CREATE','VARIANT_TRANSFER_OUT','VARIANT_TRANSFER_IN',
                            'ORDER_DELETE','PURCHASE_RECEIPT'));
    ALTER TABLE dbo.inventory_movements WITH CHECK CHECK CONSTRAINT CK_inventory_movements_type;

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_inventory_movements_receipt' AND parent_object_id = OBJECT_ID('dbo.inventory_movements'))
        EXEC(N'ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT CK_inventory_movements_receipt CHECK (
            (movement_type = ''PURCHASE_RECEIPT'' AND receipt_id IS NOT NULL AND variant_id IS NOT NULL AND quantity_delta > 0)
            OR (movement_type <> ''PURCHASE_RECEIPT'' AND receipt_id IS NULL));');
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'UX_inventory_movements_receipt_variant' AND object_id = OBJECT_ID('dbo.inventory_movements'))
        EXEC(N'CREATE UNIQUE INDEX UX_inventory_movements_receipt_variant
            ON dbo.inventory_movements(receipt_id, variant_id) WHERE receipt_id IS NOT NULL;');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
