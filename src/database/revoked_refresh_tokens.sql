CREATE TABLE IF NOT EXISTS `revoked_refresh_tokens` (
  `token_hash` char(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
