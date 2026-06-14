CREATE TABLE IF NOT EXISTS `sub_server_media` (
  `id`            VARCHAR(36)   NOT NULL,
  `sub_server_id` VARCHAR(36)   NOT NULL,                          -- FK→server_sub_servers
  `url`           VARCHAR(1024) NOT NULL,                          -- S3/MinIO 圖片 URL
  `position`      INT           NOT NULL DEFAULT 0,                -- 展示順序（第一張為主圖）
  `created_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_sub_server_id` (`sub_server_id`),
  FOREIGN KEY (`sub_server_id`) REFERENCES `server_sub_servers`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
