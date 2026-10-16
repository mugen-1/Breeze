-- Simulation only. Existing orders intentionally receive no fabricated payments.
IF OBJECT_ID('dbo.payment_transactions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.payment_transactions (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_payment_transactions PRIMARY KEY,
    order_id INT NOT NULL,
    transaction_code VARCHAR(40) NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL CONSTRAINT DF_payment_transactions_status DEFAULT 'pending',
    created_at DATETIME2 NOT NULL CONSTRAINT DF_payment_transactions_created DEFAULT SYSUTCDATETIME(),
    paid_at DATETIME2 NULL,
    CONSTRAINT FK_payment_transactions_order FOREIGN KEY(order_id) REFERENCES dbo.orders(id) ON DELETE CASCADE,
    CONSTRAINT UQ_payment_transactions_order UNIQUE(order_id),
    CONSTRAINT UQ_payment_transactions_code UNIQUE(transaction_code),
    CONSTRAINT CK_payment_transactions_method CHECK(payment_method IN ('cod','visa','mastercard','momo')),
    CONSTRAINT CK_payment_transactions_amount CHECK(amount >= 0),
    CONSTRAINT CK_payment_transactions_status CHECK(status IN ('pending','paid','failed','cancelled')),
    CONSTRAINT CK_payment_transactions_paid_at CHECK(
      (status = 'paid' AND paid_at IS NOT NULL) OR (status <> 'paid' AND paid_at IS NULL))
  );
END;
