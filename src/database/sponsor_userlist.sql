CREATE TABLE IF NOT EXISTS `sponsor_userlist` (
  `minecraft_uuid` VARCHAR(255) NOT NULL,           -- 贊助者 Minecraft UUID
  `money`          VARCHAR(255) NOT NULL DEFAULT '0', -- 贊助累計金額（service 以字串存取）
  PRIMARY KEY (`minecraft_uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
