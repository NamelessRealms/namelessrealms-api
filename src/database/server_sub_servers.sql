CREATE TABLE IF NOT EXISTS `server_sub_servers` (
  `id`           VARCHAR(36)                      NOT NULL,
  `server_id`    VARCHAR(36)                      NOT NULL,           -- FK→servers（品牌）
  `name`         VARCHAR(100)                     NOT NULL,
  `icon_url`     TEXT                             NULL,
  `host`         VARCHAR(255)                     NOT NULL,           -- 連線位址
  `port`         INT                              NOT NULL DEFAULT 25565,
  `sync_mode`    ENUM('strict','additive')        NOT NULL DEFAULT 'strict',
  `is_online`    TINYINT(1)                       NOT NULL DEFAULT 0, -- 需 heartbeat 或 Server List Ping 餵
  `player_count` INT                              NOT NULL DEFAULT 0, -- 熱門排序用
  `position`     INT                              NOT NULL DEFAULT 0,
  `created_at`   TIMESTAMP                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_server_id` (`server_id`),
  FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
