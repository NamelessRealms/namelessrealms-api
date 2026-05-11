CREATE TABLE IF NOT EXISTS minecraft_accounts (
  user_id VARCHAR(255) PRIMARY KEY,
  minecraft_uuid VARCHAR(255) NOT NULL,
  minecraft_username VARCHAR(255) NOT NULL,
  linked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
