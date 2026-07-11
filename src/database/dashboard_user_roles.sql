CREATE TABLE IF NOT EXISTS `dashboard_user_roles` (
  `id`                VARCHAR(255) NOT NULL,         -- 面板使用者 ID
  `github_user_name`  VARCHAR(255) NULL,            -- GitHub 使用者名稱
  `github_user_email` VARCHAR(255) NULL,            -- GitHub Email
  `github_user_id`    VARCHAR(255) NOT NULL,        -- GitHub 使用者 ID（查詢鍵）
  `roles`             JSON         DEFAULT NULL,     -- 面板角色清單
  PRIMARY KEY (`id`),
  UNIQUE KEY `github_user_id` (`github_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
