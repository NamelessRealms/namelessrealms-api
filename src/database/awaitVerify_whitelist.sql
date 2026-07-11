CREATE TABLE IF NOT EXISTS `awaitVerify_whitelist` (
  `timestamp`     VARCHAR(255) NULL,                -- 送出驗證的時間戳
  `server_id`     VARCHAR(36)  NOT NULL,            -- 申請加入的伺服器
  `minecraft_id`  VARCHAR(255) NOT NULL,            -- Minecraft 名稱
  `discord_id`    VARCHAR(255) NOT NULL,            -- 申請者 Discord ID
  `consent_rules` TINYINT(1)   NOT NULL DEFAULT 0,  -- 是否同意規則
  PRIMARY KEY (`discord_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
