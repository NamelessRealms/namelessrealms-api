CREATE TABLE IF NOT EXISTS `server_roles` (
  `id`          VARCHAR(36)  NOT NULL,
  `server_id`   VARCHAR(36)  NOT NULL,
  `name`        VARCHAR(64)  NOT NULL,
  `color`       VARCHAR(7)   NOT NULL DEFAULT '#99aab5',
  `permissions` BIGINT       NOT NULL DEFAULT 0,
  `position`    INT          NOT NULL DEFAULT 0,
  `created_at`  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
