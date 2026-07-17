-- ============================================================
-- mod_metadata — 池物件（sha256）→ jar 內解析出的顯示用 metadata
-- ============================================================
-- 於位元組已在手時（匯入下載後 / 手動上傳時）順路解析 jar，以 sha256 為鍵落庫；
-- 絕不為 metadata 另起下載。metadata 獨立於任何 version/refs 存在，故無 FK。
-- 解析失敗也落一列（全 NULL + parsed_at），語意＝「已嘗試、不可解析」，
-- 避免 backfill 與掛鉤重複嘗試；前端 fallback 顯示檔名。
CREATE TABLE IF NOT EXISTS `mod_metadata` (
  `sha256`      VARCHAR(64)  NOT NULL PRIMARY KEY,   -- 池物件內容雜湊（身分）
  `mod_id`      VARCHAR(128) NULL,                   -- jar metadata 的 mod id
  `mod_name`    VARCHAR(255) NULL,                   -- 顯示名稱（缺省時同 mod_id）
  `mod_version` VARCHAR(64)  NULL,                   -- 版本（Gradle 佔位符殘留視為 NULL）
  `loader_hint` VARCHAR(16)  NULL,                   -- 'fabric'|'quilt'|'neoforge'|'forge'|'legacy'|NULL
  `icon_url`    VARCHAR(512) NULL,                   -- S3 mods/icons/{sha256}.png；無 icon 為 NULL
  `parsed_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP  -- 解析嘗試時間
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;