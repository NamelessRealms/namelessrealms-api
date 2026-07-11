CREATE TABLE IF NOT EXISTS `user_link` (
  `minecraft_uuid` VARCHAR(255) NOT NULL,           -- Minecraft 帳號 UUID
  `discord_id`     VARCHAR(255) NOT NULL,           -- 連結的 Discord ID
  PRIMARY KEY (`minecraft_uuid`, `discord_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
