CREATE TABLE IF NOT EXISTS `server_media` (
  `server_id` VARCHAR(36) NOT NULL,
  `media_type` ENUM('icon', 'background') NOT NULL,
  `url` VARCHAR(1024) NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`server_id`, `media_type`),
  FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;