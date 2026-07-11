CREATE TABLE IF NOT EXISTS `manualVerify_whitelist` (
  `minecraft_uuid`    VARCHAR(255) NOT NULL,        -- Minecraft UUID
  `minecraft_id`      VARCHAR(255) NOT NULL,        -- Minecraft 名稱
  `discord_user_name` VARCHAR(255) NULL,            -- Discord 使用者名稱
  `discord_user_id`   VARCHAR(255) NOT NULL,        -- Discord 使用者 ID
  `channel_id`        VARCHAR(255) NULL,            -- 人工驗證訊息的頻道 ID
  `message_id`        VARCHAR(255) NULL,            -- 人工驗證訊息 ID
  `server_id`         VARCHAR(36)  NOT NULL,        -- 申請加入的伺服器
  PRIMARY KEY (`discord_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
