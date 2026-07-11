CREATE TABLE IF NOT EXISTS `server_whitelist` (
  `minecraft_uuid` VARCHAR(255) NOT NULL,           -- 白名單玩家 UUID
  `server_id`      VARCHAR(36)  NOT NULL,           -- 對應伺服器（品牌層）
  PRIMARY KEY (`minecraft_uuid`, `server_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
