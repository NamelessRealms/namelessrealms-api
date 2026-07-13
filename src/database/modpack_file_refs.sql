-- ============================================================
-- modpack_file_refs — mod 檔全域共用池的引用計數（事實表）
-- ============================================================
-- 一行 =「該 version 的 published manifest 引用該 sha256」。
-- 引用數 = COUNT(*)，可隨時從事實重算、不漂移。
-- 只有 published 版本會寫入（draft 不算）；overrides/自訂 zip 不進池、不記引用。
-- 回收由獨立手動 script（recycle_orphan_mods.ts）執行，業務路徑不直接刪池物件。
CREATE TABLE IF NOT EXISTS `modpack_file_refs` (
  `sha256`     VARCHAR(64) NOT NULL,                        -- 池物件內容雜湊（mods/files/{sha256}{ext}）
  `version_id` VARCHAR(36) NOT NULL,                        -- FK→server_modpack_versions
  PRIMARY KEY (`sha256`, `version_id`),
  INDEX `idx_version_id` (`version_id`),
  FOREIGN KEY (`version_id`) REFERENCES `server_modpack_versions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
