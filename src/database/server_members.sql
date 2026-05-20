CREATE TABLE IF NOT EXISTS `server_members` (
  `server_id`  VARCHAR(36) NOT NULL,
  `user_id`    VARCHAR(36) NOT NULL,
  `role_id`    VARCHAR(36) NOT NULL,
  `joined_at`  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`server_id`, `user_id`),
  FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`role_id`) REFERENCES `server_roles`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
