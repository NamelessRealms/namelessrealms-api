CREATE TABLE IF NOT EXISTS `violationlist` (
  `minecraft_uuid` VARCHAR(255) NULL,               -- 違規者 Minecraft UUID
  `discord_id`     VARCHAR(255) NULL                -- 違規者 Discord ID
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
