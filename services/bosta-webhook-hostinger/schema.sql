CREATE TABLE IF NOT EXISTS bosta_webhook_events (
  id CHAR(64) PRIMARY KEY,
  bosta_order_id VARCHAR(160) NULL,
  tracking_number VARCHAR(160) NULL,
  business_reference VARCHAR(160) NULL,
  state INT NOT NULL,
  event_timestamp BIGINT NOT NULL,
  payload JSON NOT NULL,
  received_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  INDEX idx_bosta_webhook_pending (consumed_at, event_timestamp),
  INDEX idx_bosta_webhook_tracking (tracking_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
