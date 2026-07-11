CREATE TABLE IF NOT EXISTS `tpme_verify_whitelist` (
  `minecraft_name`    VARCHAR(255) NOT NULL,        -- Minecraft 名稱
  `minecraft_uuid`    VARCHAR(255) NOT NULL,        -- Minecraft UUID
  `discord_user_name` VARCHAR(255) NULL,            -- Discord 使用者名稱
  `discord_user_id`   VARCHAR(255) NOT NULL,        -- Discord 使用者 ID
  `server_Id`         VARCHAR(36)  NOT NULL,        -- 對應伺服器
  PRIMARY KEY (`discord_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
